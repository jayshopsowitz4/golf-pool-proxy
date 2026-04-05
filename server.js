/**
 * Major Pool — Proxy Server
 *
 * Fetches live golf leaderboard data from ESPN's public (unofficial) API
 * and serves it with CORS headers so the browser-based pool app can use it.
 *
 * Deploy free on: Railway (railway.app) · Render (render.com) · Fly.io
 *
 * ENV VARS:
 *   ESPN_ID_MASTERS / ESPN_ID_PGA / ESPN_ID_USOPEN / ESPN_ID_OPEN  — update each year
 *   NOTIFY_EMAIL     — address to receive signup/picks notifications (e.g. jay@gmail.com)
 *   SMTP_HOST        — SMTP server (e.g. smtp.gmail.com)
 *   SMTP_PORT        — usually 587
 *   SMTP_USER        — your email login
 *   SMTP_PASS        — your email password or app password
 *   ADMIN_KEY        — optional key to protect config endpoints
 *   NAME_OVERRIDES   — JSON string of ESPN→pool name overrides
 */

const express    = require('express');
const fetch      = require('node-fetch');
const cors       = require('cors');
const nodemailer = require('nodemailer');

const app  = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());


// ═══════════════════════════════════════════════════════════════════
//  EMAIL NOTIFICATIONS
// ═══════════════════════════════════════════════════════════════════
let mailer = null;
if (process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS) {
  mailer = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: parseInt(process.env.SMTP_PORT || '587'),
    secure: process.env.SMTP_PORT === '465',
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
  });
  console.log('Email notifications enabled → ' + (process.env.NOTIFY_EMAIL || process.env.SMTP_USER));
} else {
  console.log('Email notifications disabled (set SMTP_HOST, SMTP_USER, SMTP_PASS to enable)');
}

async function sendNotification(subject, body) {
  if (!mailer) return;
  const to = process.env.NOTIFY_EMAIL || process.env.SMTP_USER;
  try {
    await mailer.sendMail({
      from: `"Major Pool" <${process.env.SMTP_USER}>`,
      to,
      subject,
      text: body,
      html: `<pre style="font-family:sans-serif;font-size:14px">${body}</pre>`,
    });
    console.log(`Notification sent: ${subject}`);
  } catch (e) {
    console.warn('Email send failed:', e.message);
  }
}

// ═══════════════════════════════════════════════════════════════════
//  EMAIL HELPERS
// ═══════════════════════════════════════════════════════════════════
function fmtMoney(n) {
  if (!n) return '$0';
  if (n >= 1_000_000) return '$' + (n/1_000_000).toFixed(2) + 'M';
  if (n >= 1_000)     return '$' + Math.round(n/1_000) + 'K';
  return '$' + n;
}

function buildStandingsEmailHTML(poolName, majorName, roundNum, standings, isAfterCut) {
  const roundLabel = roundNum === 4 ? 'Final' : `After Round ${roundNum}`;
  const rows = standings.map((p, i) => {
    const rankBadge = p.rank === 1 ? '🥇' : p.rank === 2 ? '🥈' : p.rank === 3 ? '🥉' : `#${p.rank}`;
    const elimBadge = p.eliminated ? ' <span style="color:#e53e3e;font-size:11px">✂ Eliminated</span>' : '';
    return `<tr style="border-bottom:1px solid #eee">
      <td style="padding:8px 12px;font-weight:${p.rank<=3?'700':'400'}">${rankBadge}</td>
      <td style="padding:8px 12px">${p.name}${elimBadge}</td>
      <td style="padding:8px 12px;font-family:monospace;color:#2d7a47;font-weight:700">${fmtMoney(p.total)}</td>
      <td style="padding:8px 12px;font-size:11px;color:#666">${p.majorEarnings || '—'}</td>
    </tr>`;
  }).join('');

  return `<!DOCTYPE html><html><body style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:20px;background:#f9f7f2">
  <div style="background:#1a1a2e;padding:20px 24px;border-radius:10px 10px 0 0;text-align:center">
    <h1 style="color:#e8c547;font-size:22px;margin:0">⛳ Jay's 8th Annual Majors Pool</h1>
    <p style="color:#ccc;font-size:13px;margin:6px 0 0">${majorName} · ${roundLabel}</p>
  </div>
  <div style="background:#fff;border:1px solid #e8e0d0;border-top:none;border-radius:0 0 10px 10px;padding:20px 24px">
    <table style="width:100%;border-collapse:collapse;font-size:14px">
      <thead>
        <tr style="background:#f5f0e8">
          <th style="padding:8px 12px;text-align:left;font-size:11px;letter-spacing:.5px;text-transform:uppercase;color:#666">#</th>
          <th style="padding:8px 12px;text-align:left;font-size:11px;letter-spacing:.5px;text-transform:uppercase;color:#666">Player</th>
          <th style="padding:8px 12px;text-align:left;font-size:11px;letter-spacing:.5px;text-transform:uppercase;color:#666">Earnings</th>
          <th style="padding:8px 12px;text-align:left;font-size:11px;letter-spacing:.5px;text-transform:uppercase;color:#666">Breakdown</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
    ${isAfterCut ? '<p style="margin-top:16px;font-size:12px;color:#e53e3e;border-top:1px solid #eee;padding-top:12px">✂ US Open cut applied — eliminated players will not score in The Open Championship.</p>' : ''}
    <p style="margin-top:20px;font-size:12px;color:#999;text-align:center">Pool: ${poolName} · Prizes normalized to $20M · Captain earns 1.5× (2× at The Open)</p>
  </div>
</body></html>`;
}

function buildStandingsEmailText(poolName, majorName, roundNum, standings) {
  const roundLabel = roundNum === 4 ? 'Final' : `After Round ${roundNum}`;
  const rows = standings.map(p =>
    `${p.rank}. ${p.name.padEnd(20)} ${fmtMoney(p.total).padStart(10)}  ${p.eliminated ? '[Eliminated]' : ''}  ${p.majorEarnings || ''}`
  ).join('\n');
  const sep = '\u2500'.repeat(60);
  return `Jay's 8th Annual Majors Pool\n${majorName} - ${roundLabel}\n${sep}\n\n${rows}\n\n${sep}\nPool: ${poolName} - Prizes normalized to $20M`;
}


// POST /notify — called by the pool app on signup or picks submission
app.post('/notify', async (req, res) => {
  const { type, poolName, poolCode, participantName, major, picks } = req.body;
  if (!type) return res.status(400).json({ error: 'type required' });

  let subject, body;
  if (type === 'signup') {
    subject = `⛳ New signup: ${participantName} joined ${poolName}`;
    body = `New participant joined your pool!\n\nPool: ${poolName} (${poolCode})\nName: ${participantName}\nTime: ${new Date().toLocaleString('en-US', {timeZone:'America/Los_Angeles'})} PT`;
  } else if (type === 'picks') {
    const pickList = picks ? Object.entries(picks).map(([maj, p]) => {
      const slots = p.slots || p.players || [];
      return `  ${maj.toUpperCase()}: ${slots.filter(Boolean).join(', ')} (captain: ${p.captain || slots[0] || '—'})`;
    }).join('\n') : '  (no picks data)';
    subject = `🏌️ Picks submitted: ${participantName} — ${poolName}`;
    body = `${participantName} just submitted picks!\n\nPool: ${poolName} (${poolCode})\nTime: ${new Date().toLocaleString('en-US', {timeZone:'America/Los_Angeles'})} PT\n\nPicks:\n${pickList}`;
  } else {
    return res.status(400).json({ error: 'type must be signup or picks' });
  }

  await sendNotification(subject, body);
  res.json({ sent: !!mailer, subject });
});


// ═══════════════════════════════════════════════════════════════════
//  TOURNAMENT IDS
// ═══════════════════════════════════════════════════════════════════
// ESPN IDs (fallback if Slash Golf not configured)
// 2026 confirmed: Masters=401811941, Texas Open=401811940
const TOURNAMENT_IDS = {
  masters: process.env.ESPN_ID_MASTERS || '401811941',
  pga:     process.env.ESPN_ID_PGA     || '401703505',
  usopen:  process.env.ESPN_ID_USOPEN  || '401703506',
  open:    process.env.ESPN_ID_OPEN    || '401703507',
};

// Slash Golf (RapidAPI) tournament IDs — set via Railway env vars
// To find: call /schedules endpoint after signing up, find tournId for each major
// Texas Open 2026: check /schedules response for "Valero Texas Open"
// Masters 2026:    check /schedules response for "Masters Tournament"
const SLASH_IDS = {
  masters: process.env.SLASH_ID_MASTERS || '',
  pga:     process.env.SLASH_ID_PGA     || '',
  usopen:  process.env.SLASH_ID_USOPEN  || '',
  open:    process.env.SLASH_ID_OPEN    || '',
};

const RAPIDAPI_KEY = process.env.RAPIDAPI_KEY || '';


// ═══════════════════════════════════════════════════════════════════
//  MANUAL NAME OVERRIDES
//  Format: { "ESPN Name": "Pool Name" }
//  Set via POST /config/names from the admin panel, or via NAME_OVERRIDES env var.
//  Example env var: {"R. McIlroy":"Rory McIlroy","Ludvig Aberg":"Ludvig Åberg"}
// ═══════════════════════════════════════════════════════════════════
let nameOverrides = {};
try {
  if (process.env.NAME_OVERRIDES) {
    nameOverrides = JSON.parse(process.env.NAME_OVERRIDES);
    console.log(`Loaded ${Object.keys(nameOverrides).length} name overrides from env`);
  }
} catch (e) {
  console.warn('Could not parse NAME_OVERRIDES env var:', e.message);
}


// ═══════════════════════════════════════════════════════════════════
//  FUZZY NAME MATCHING
// ═══════════════════════════════════════════════════════════════════

/**
 * Normalize: lowercase, strip accents, remove punctuation, collapse spaces.
 * "Ludvig Åberg" → "ludvig aberg"
 * "R. McIlroy"   → "r mcilroy"
 */
function normalize(name) {
  return name
    .toLowerCase()
    // Explicit replacements for chars that don't decompose via NFD
    .replace(/ø/g, 'o').replace(/æ/g, 'ae').replace(/ß/g, 'ss')
    .replace(/þ/g, 'th').replace(/ð/g, 'd').replace(/ł/g, 'l')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')  // strip diacritics
    .replace(/[^a-z\s]/g, '')         // remove punctuation (dots, hyphens, etc.)
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Try to match an ESPN name to a pool name.
 * Handles:
 *  1. Exact match after normalization     "Ludvig Åberg" ↔ "Ludvig Aberg"
 *  2. Initial match                       "R. McIlroy"   ↔ "Rory McIlroy"
 *  3. Reversed word order                 "McIlroy Rory" ↔ "Rory McIlroy"
 *  4. Subset (ESPN middle names)          "Jon Michael Rahm" ↔ "Jon Rahm"
 *  5. Suffix stripping                    "Tiger Woods Jr" ↔ "Tiger Woods"
 */
function namesMatch(espnName, poolName) {
  const SUFFIXES = /\b(jr|sr|ii|iii|iv)\b/g;
  const e = normalize(espnName).replace(SUFFIXES, '').replace(/\s+/g,' ').trim();
  const p = normalize(poolName).replace(SUFFIXES, '').replace(/\s+/g,' ').trim();

  if (e === p) return true;

  const eParts = e.split(' ').filter(Boolean);
  const pParts = p.split(' ').filter(Boolean);

  // Initial match: "r mcilroy" vs "rory mcilroy"
  if (eParts.length >= 2 && eParts[0].length === 1) {
    const eLast = eParts.slice(1).join(' ');
    const pLast = pParts.slice(1).join(' ');
    if (eParts[0] === pParts[0]?.[0] && eLast === pLast) return true;
  }
  // Reverse initial: "rory mcilroy" vs "r mcilroy"
  if (pParts.length >= 2 && pParts[0].length === 1) {
    const pLast = pParts.slice(1).join(' ');
    const eLast = eParts.slice(1).join(' ');
    if (pParts[0] === eParts[0]?.[0] && pLast === eLast) return true;
  }

  // Reversed word order
  if ([...eParts].reverse().join(' ') === p) return true;

  // Subset match — all parts of the shorter name appear in the longer
  const shorter = eParts.length <= pParts.length ? eParts : pParts;
  const longer  = eParts.length <= pParts.length ? pParts : eParts;
  if (shorter.length >= 2 && shorter.every(part => longer.includes(part))) return true;

  return false;
}

/**
 * Given a pool player name, find the matching ESPN key in espnMap.
 * Priority: manual override → exact (normalized) → fuzzy
 */
function resolvePlayerName(poolName, espnMap) {
  // 1. Manual override (keyed ESPN→pool, so find espn key whose value = poolName)
  for (const [espnKey, mappedPool] of Object.entries(nameOverrides)) {
    if (normalize(mappedPool) === normalize(poolName) && espnMap[espnKey] !== undefined) {
      return { espnKey, how: 'override' };
    }
  }
  // 2. Exact normalized
  for (const espnKey of Object.keys(espnMap)) {
    if (normalize(espnKey) === normalize(poolName)) return { espnKey, how: 'exact' };
  }
  // 3. Fuzzy
  for (const espnKey of Object.keys(espnMap)) {
    if (namesMatch(espnKey, poolName)) return { espnKey, how: 'fuzzy' };
  }
  return null;
}

function isInMissedCut(poolName, espnMCList) {
  for (const [espnKey, mappedPool] of Object.entries(nameOverrides)) {
    if (normalize(mappedPool) === normalize(poolName) && espnMCList.includes(espnKey)) return true;
  }
  if (espnMCList.some(n => normalize(n) === normalize(poolName))) return true;
  if (espnMCList.some(n => namesMatch(n, poolName))) return true;
  return false;
}


// ═══════════════════════════════════════════════════════════════════
//  CACHE
// ═══════════════════════════════════════════════════════════════════
const cache = {};
const CACHE_TTL_MS = 3 * 60 * 1000;

function getCached(key) {
  const e = cache[key];
  return (e && Date.now() - e.ts < CACHE_TTL_MS) ? e.data : null;
}
function setCache(key, data) { cache[key] = { data, ts: Date.now() }; }


// ═══════════════════════════════════════════════════════════════════
//  SLASH GOLF FETCH  (primary source when RAPIDAPI_KEY is set)
// ═══════════════════════════════════════════════════════════════════
async function fetchSlashGolf(tournId) {
  const url = `https://live-golf-data.p.rapidapi.com/leaderboard?tournId=${tournId}&year=2026`;
  const res = await fetch(url, {
    headers: {
      'x-rapidapi-key': RAPIDAPI_KEY,
      'x-rapidapi-host': 'live-golf-data.p.rapidapi.com',
    },
    timeout: 10000,
  });
  if (!res.ok) throw new Error(`Slash Golf returned ${res.status}`);
  const data = await res.json();

  const espnPlayers = {};
  const espnMissedCut = [];
  const espnRankings = {};
  let tournamentName = '', status = 'scheduled', currentRound = null;

  // Slash Golf leaderboard structure:
  // { leaderboard: [ { playerName, position, status, roundScore, ... } ] }
  const lb = data.leaderboard || data.players || [];
  tournamentName = data.tournamentName || data.name || '';
  currentRound   = parseInt(data.currentRound || data.roundId) || null;
  const state    = (data.status || data.roundStatus || '').toLowerCase();
  if (state.includes('progress') || state.includes('active')) status = 'in_progress';
  else if (state.includes('complete') || state.includes('final')) status = 'complete';

  lb.forEach(p => {
    const name = p.playerName || (p.firstName && p.lastName ? p.firstName + ' ' + p.lastName : null);
    if (!name) return;
    const pStatus = (p.status || p.playerStatus || '').toLowerCase();
    if (pStatus === 'cut' || pStatus === 'wd' || pStatus === 'dq') {
      espnMissedCut.push(name); return;
    }
    const pos = parseInt(String(p.position || p.currentPosition || '').replace(/^T/,''));
    if (!isNaN(pos) && pos > 0) espnPlayers[name] = pos;
    if (p.owgrRank || p.worldRanking) espnRankings[name] = parseInt(p.owgrRank || p.worldRanking);
  });

  console.log(`Slash Golf: ${Object.keys(espnPlayers).length} players, ${espnMissedCut.length} MC`);
  return { espnPlayers, espnMissedCut, espnRankings, tournamentName, status, currentRound, updatedAt: new Date().toISOString() };
}

// GET /slash/schedules — fetch current season schedule to find tournIds
app.get('/slash/schedules', async (req, res) => {
  if (!RAPIDAPI_KEY) return res.status(400).json({ error: 'RAPIDAPI_KEY not configured in Railway env vars' });
  try {
    const r = await fetch('https://live-golf-data.p.rapidapi.com/schedule?year=2026', {
      headers: { 'x-rapidapi-key': RAPIDAPI_KEY, 'x-rapidapi-host': 'live-golf-data.p.rapidapi.com' },
    });
    const data = await r.json();
    // Return simplified list of tournament name + tournId
    const schedule = (data.schedule || data.tournaments || data || []).map(t => ({
      tournId: t.tournId || t.id,
      name: t.tournamentName || t.name,
      date: t.date || t.startDate,
    }));
    res.json({ count: schedule.length, schedule });
  } catch(e) { res.status(502).json({ error: e.message }); }
});


async function fetchESPN(majorId) {
  const tournamentId = TOURNAMENT_IDS[majorId];
  if (!tournamentId) throw new Error('Unknown major: ' + majorId);

  // 1. Try Slash Golf first if API key + tournId configured
  const slashId = SLASH_IDS[majorId];
  if (RAPIDAPI_KEY && slashId) {
    try {
      const result = await fetchSlashGolf(slashId);
      if (Object.keys(result.espnPlayers).length > 0 || result.espnMissedCut.length > 0) {
        return result;
      }
      console.warn('Slash Golf returned empty data, falling back to ESPN');
    } catch(e) {
      console.warn('Slash Golf failed:', e.message, '— falling back to ESPN');
    }
  }

  // 2. Try PGA Tour statdata + ESPN URL formats as fallback
  const urls = [
    `https://statdata.pgatour.com/r/current/leaderboard-v2.json`,
    `https://site.api.espn.com/apis/site/v2/sports/golf/pga/leaderboard?tournamentId=${tournamentId}`,
    `https://site.api.espn.com/apis/site/v2/sports/golf/pga-tour/leaderboard?tournamentId=${tournamentId}`,
    `https://site.web.api.espn.com/apis/site/v2/sports/golf/pga/leaderboard?tournamentId=${tournamentId}`,
    `https://cdn.espn.com/core/golf/leaderboard?tournamentId=${tournamentId}&xhr=1`,
  ];

  let res, lastErr;
  const errors = [];
  for (const url of urls) {
    try {
      res = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
          'Accept': 'application/json, text/plain, */*',
          'Accept-Language': 'en-US,en;q=0.9',
          'Accept-Encoding': 'gzip, deflate, br',
          'Origin': 'https://www.espn.com',
          'Referer': 'https://www.espn.com/golf/leaderboard',
          'sec-fetch-dest': 'empty',
          'sec-fetch-mode': 'cors',
          'sec-fetch-site': 'same-site',
        },
        timeout: 10000,
      });
      if (res.ok) { console.log('Success from:', url); break; }
      const err = `${res.status} from ${url}`;
      errors.push(err);
      console.warn('Failed:', err);
      res = null;
    } catch(e) { errors.push(e.message + ' from ' + url); console.warn('Error:', e.message, url); }
  }
  if (!res) throw new Error('All sources failed: ' + errors.join(' | '));
  let raw = await res.json();

  const espnPlayers = {};
  const espnMissedCut = [];
  let tournamentName = '', status = 'scheduled', currentRound = null;
  const espnRankings = {}; // name -> OWGR rank

  // ── PGA Tour statdata format ──────────────────────────────────────────────
  // statdata.pgatour.com returns { leaderboard: { tournament, players: [...] } }
  if (raw.leaderboard?.players) {
    const lb = raw.leaderboard;
    tournamentName = lb.tournament?.tournament_name || '';
    currentRound = parseInt(lb.tournament?.current_round) || null;
    const roundState = lb.tournament?.round_state || '';
    if (roundState === 'Complete' && currentRound === 4) status = 'complete';
    else if (roundState === 'In Progress' || currentRound > 0) status = 'in_progress';

    lb.players.forEach(p => {
      const name = (p.player_bio?.first_name + ' ' + p.player_bio?.last_name).trim();
      if (!name || name === ' ') return;
      const cut = p.status === 'cut' || p.status === 'wd' || p.status === 'dq';
      if (cut) { espnMissedCut.push(name); return; }
      const pos = parseInt(String(p.current_position).replace(/^T/,''));
      if (!isNaN(pos) && pos > 0) espnPlayers[name] = pos;
      if (p.player_bio?.owgr_rank) espnRankings[name] = parseInt(p.player_bio.owgr_rank);
    });

    console.log(`PGA statdata: ${Object.keys(espnPlayers).length} players, ${espnMissedCut.length} MC`);
    return { espnPlayers, espnMissedCut, espnRankings, tournamentName, status, currentRound, updatedAt: new Date().toISOString() };
  }

  // ── ESPN format ───────────────────────────────────────────────────────────
  // cdn.espn.com wraps data in gamepackageJSON
  if (raw.gamepackageJSON) raw = raw.gamepackageJSON;

  try {
    const t = raw.tournaments?.[0] || raw.events?.[0];
    if (!t) throw new Error('No tournament data');
    tournamentName = t.name || t.shortName || '';
    const st = t.status?.type?.name || t.competitions?.[0]?.status?.type?.name || '';
    if (st === 'STATUS_IN_PROGRESS') status = 'in_progress';
    else if (st === 'STATUS_FINAL' || st === 'STATUS_PLAY_COMPLETE') status = 'complete';

    const period = t.status?.period || t.competitions?.[0]?.status?.period;
    if (period) currentRound = parseInt(period);

    const competitors = t.competitors || t.competitions?.[0]?.competitors || [];
    competitors.forEach(c => {
      const name = c.athlete?.displayName || c.athlete?.shortName || '';
      if (!name) return;
      const sd = c.status?.type?.name || '';
      const owgr = c.athlete?.rank || c.athlete?.rankings?.worldRanking || null;
      if (owgr) espnRankings[name] = parseInt(owgr);
      if (['STATUS_MISSED_CUT','STATUS_WD','STATUS_DQ'].includes(sd)) {
        espnMissedCut.push(name); return;
      }
      const posStr = String(c.status?.position?.displayName || c.linescores?.[0]?.position || '').replace(/^T/,'').trim();
      const pos = parseInt(posStr);
      if (!isNaN(pos)) espnPlayers[name] = pos;
    });
  } catch (e) { console.error('Parse error:', e.message); }

  return { espnPlayers, espnMissedCut, espnRankings, tournamentName, status, currentRound, updatedAt: new Date().toISOString() };
}

// Resolve a list of pool player names against raw ESPN data
function resolveNames(poolNames, rawData) {
  const resolved  = {};  // poolName → position
  const missedCut = [];
  const unmatched = [];
  const matchLog  = [];

  poolNames.forEach(poolName => {
    if (!poolName) return;
    if (isInMissedCut(poolName, rawData.espnMissedCut)) {
      missedCut.push(poolName);
      matchLog.push({ pool: poolName, espn: '(missed cut)', how: 'mc' });
      return;
    }
    const match = resolvePlayerName(poolName, rawData.espnPlayers);
    if (match) {
      resolved[poolName] = rawData.espnPlayers[match.espnKey];
      matchLog.push({ pool: poolName, espn: match.espnKey, pos: resolved[poolName], how: match.how });
    } else {
      unmatched.push(poolName);
      matchLog.push({ pool: poolName, espn: null, how: 'none' });
    }
  });

  // Build tie groups: position -> count of ALL players at that position in the full ESPN field
  // This lets the client know a T5 with 3 players means split of pos5+6+7 / 3
  const tieGroups = {}; // position -> number of players at that position (full field)
  Object.values(rawData.espnPlayers).forEach(pos => {
    tieGroups[pos] = (tieGroups[pos] || 0) + 1;
  });

  return { resolved, missedCut, unmatched, matchLog, tieGroups };
}


// ═══════════════════════════════════════════════════════════════════
//  ROUTES
// ═══════════════════════════════════════════════════════════════════

app.get('/', (req, res) => res.json({
  service: 'Major Pool Proxy',
  status: 'ok',
  nameOverrideCount: Object.keys(nameOverrides).length,
  endpoints: [
    'GET  /leaderboard/:majorId?players=Name1,Name2',
    'GET  /leaderboard/:majorId/raw',
    'GET  /health',
    'GET  /config/names',
    'POST /config/names  { overrides: {"ESPN Name": "Pool Name"} }',
    'POST /config/ids    { masters, pga, usopen, open }',
  ],
}));

app.get('/health', (req, res) => res.json({ ok: true, uptime: process.uptime() }));

// Main leaderboard route
app.get('/leaderboard/:majorId', async (req, res) => {
  const { majorId } = req.params;
  if (!['masters','pga','usopen','open'].includes(majorId)) {
    return res.status(400).json({ error: 'Invalid majorId' });
  }

  let rawData = getCached(majorId);
  let fromCache = !!rawData;
  if (!rawData) {
    try {
      rawData = await fetchESPN(majorId);
      setCache(majorId, rawData);
    } catch (err) {
      console.error(err.message);
      const stale = cache[majorId]?.data;
      if (stale) return res.json({ ...buildFullResponse(stale), cached: true, stale: true });
      return res.status(502).json({ error: err.message, players: {}, missedCut: [], unmatched: [] });
    }
  }

  // If pool player names provided, do targeted resolution
  const playersParam = req.query.players;
  if (playersParam) {
    const names = playersParam.split(',').map(n => n.trim()).filter(Boolean);
    const resolution = resolveNames(names, rawData);
    return res.json({
      tournamentName: rawData.tournamentName,
      status: rawData.status,
      updatedAt: rawData.updatedAt,
      currentRound: rawData.currentRound,
      cached: fromCache,
      ...resolution,
    });
  }

  // Full raw response
  res.json({
    tournamentName: rawData.tournamentName,
    status: rawData.status,
    updatedAt: rawData.updatedAt,
    cached: fromCache,
    players: rawData.espnPlayers,
    missedCut: rawData.espnMissedCut,
  });
});

// Raw ESPN names — for building override mappings in the admin panel
app.get('/leaderboard/:majorId/raw', async (req, res) => {
  const { majorId } = req.params;
  if (!['masters','pga','usopen','open'].includes(majorId)) {
    return res.status(400).json({ error: 'Invalid majorId' });
  }
  try {
    let raw = getCached(majorId);
    if (!raw) { raw = await fetchESPN(majorId); setCache(majorId, raw); }
    res.json({
      espnNames: Object.keys(raw.espnPlayers).sort(),
      missedCut: raw.espnMissedCut.sort(),
      tournamentName: raw.tournamentName,
      updatedAt: raw.updatedAt,
    });
  } catch (e) { res.status(502).json({ error: e.message }); }
});

// Clean sorted field list — used by pick dropdowns in the app
app.get('/field/:majorId', async (req, res) => {
  const { majorId } = req.params;
  if (!['masters','pga','usopen','open'].includes(majorId)) {
    return res.status(400).json({ error: 'Invalid majorId', field: [] });
  }
  try {
    let raw = getCached(majorId);
    if (!raw) { raw = await fetchESPN(majorId); setCache(majorId, raw); }
    const allESPN = [...Object.keys(raw.espnPlayers), ...raw.espnMissedCut];

    // Build field with OWGR ranks, sorted by rank (unranked at bottom alphabetically)
    const rankings = raw.espnRankings || {};
    const fieldWithRanks = allESPN.map(espnName => {
      const poolName = nameOverrides[espnName] || espnName;
      const rank = rankings[espnName] || null;
      return { name: poolName, rank };
    });

    // Sort: ranked players by OWGR ascending, then unranked alphabetically
    fieldWithRanks.sort((a, b) => {
      if (a.rank && b.rank) return a.rank - b.rank;
      if (a.rank) return -1;
      if (b.rank) return 1;
      return a.name.localeCompare(b.name);
    });

    // field array for backward compat (name strings only)
    const field = fieldWithRanks.map(p => p.name);
    // fieldRanked includes rank info for display
    const fieldRanked = fieldWithRanks;

    res.json({ field, fieldRanked, tournamentName: raw.tournamentName, status: raw.status, updatedAt: raw.updatedAt, count: field.length });
  } catch (e) { res.status(502).json({ error: e.message, field: [] }); }
});

// View overrides
app.get('/config/names', (req, res) => {
  res.json({ overrides: nameOverrides, count: Object.keys(nameOverrides).length });
});

// Set/update overrides (called from admin panel)
app.post('/config/names', (req, res) => {
  const key = req.headers['x-admin-key'];
  if (process.env.ADMIN_KEY && key !== process.env.ADMIN_KEY) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  const { overrides } = req.body;
  if (!overrides || typeof overrides !== 'object') {
    return res.status(400).json({ error: 'Body must be { overrides: { "ESPN Name": "Pool Name" } }' });
  }
  nameOverrides = { ...nameOverrides, ...overrides };
  console.log('Overrides updated:', nameOverrides);
  res.json({ updated: nameOverrides, count: Object.keys(nameOverrides).length });
});

// POST /notify/reset — send password reset email
app.post('/notify/reset', async (req, res) => {
  const { email, name, resetUrl, poolName } = req.body;
  if (!email || !resetUrl) return res.status(400).json({ error: 'email and resetUrl required' });
  if (!mailer) return res.json({ sent: false, reason: 'email not configured' });

  const subject = `Reset your password — ${poolName}`;
  const html = `<!DOCTYPE html><html><body style="font-family:Arial,sans-serif;max-width:500px;margin:0 auto;padding:20px;background:#f9f7f2">
  <div style="background:#1a1a2e;padding:20px 24px;border-radius:10px 10px 0 0;text-align:center">
    <h1 style="color:#e8c547;font-size:20px;margin:0">⛳ Jay's 8th Annual Majors Pool</h1>
  </div>
  <div style="background:#fff;border:1px solid #e8e0d0;border-top:none;border-radius:0 0 10px 10px;padding:24px">
    <p style="font-size:15px;margin-bottom:16px">Hi ${name},</p>
    <p style="font-size:14px;color:#444;margin-bottom:24px">Someone requested a password reset for your account in <strong>${poolName}</strong>. Click the button below to choose a new password. This link expires in 1 hour.</p>
    <div style="text-align:center;margin-bottom:24px">
      <a href="${resetUrl}" style="background:#e8c547;color:#111;font-weight:700;padding:12px 28px;border-radius:6px;text-decoration:none;font-size:15px;display:inline-block">Reset My Password →</a>
    </div>
    <p style="font-size:12px;color:#999">If you didn't request this, ignore this email — your password won't change.</p>
    <p style="font-size:11px;color:#bbb;margin-top:16px;word-break:break-all">Or copy this link: ${resetUrl}</p>
  </div>
</body></html>`;
  const text = `Hi ${name},

Reset your password for ${poolName} by visiting this link (expires in 1 hour):

${resetUrl}

If you didn't request this, ignore this email.`;

  try {
    await mailer.sendMail({
      from: `"Jay's Majors Pool" <${process.env.SMTP_USER}>`,
      to: email,
      subject,
      text,
      html,
    });
    res.json({ sent: true });
  } catch(e) {
    console.error('Reset email error:', e.message);
    res.status(500).json({ error: e.message });
  }
});


// POST /notify/standings — send standings email to all participants after a round
app.post('/notify/standings', async (req, res) => {
  const { poolName, poolCode, majorName, roundNum, standings, participants } = req.body;
  if (!standings || !participants) return res.status(400).json({ error: 'standings and participants required' });

  const recipients = participants.filter(p => p.email && p.email.includes('@'));
  const adminEmail = process.env.NOTIFY_EMAIL;

  // Always include admin in the to list
  const allEmails = [...new Set([
    ...recipients.map(p => p.email),
    ...(adminEmail ? [adminEmail] : [])
  ])];

  if (!allEmails.length) return res.json({ sent: false, reason: 'no email addresses' });
  if (!mailer)         return res.json({ sent: false, reason: 'email not configured' });

  const isAfterCut = majorName?.toLowerCase().includes('open') && roundNum === 4 && standings.some(p => p.eliminated);
  const roundLabel = roundNum === 4 ? 'Final Results' : `Round ${roundNum} Complete`;
  const subject = `⛳ ${poolName} — ${majorName} ${roundLabel}`;
  const html = buildStandingsEmailHTML(poolName, majorName, roundNum, standings, isAfterCut);
  const text = buildStandingsEmailText(poolName, majorName, roundNum, standings);

  try {
    // Send one email per recipient (so each gets a personalised "To" header)
    let sent = 0;
    for (const email of allEmails) {
      await mailer.sendMail({
        from: `"Jay's Majors Pool" <${process.env.SMTP_USER}>`,
        to: email,
        subject,
        text,
        html,
      });
      sent++;
    }
    console.log(`Standings email sent to ${sent} recipients for ${majorName} R${roundNum}`);
    res.json({ sent: true, recipients: sent, subject });
  } catch(e) {
    console.error('Standings email error:', e.message);
    res.status(500).json({ error: e.message });
  }
});


// Delete one override
app.delete('/config/names/:espnName', (req, res) => {
  const key = req.headers['x-admin-key'];
  if (process.env.ADMIN_KEY && key !== process.env.ADMIN_KEY) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  delete nameOverrides[decodeURIComponent(req.params.espnName)];
  res.json({ remaining: nameOverrides });
});

// Update tournament IDs
app.post('/config/ids', (req, res) => {
  const key = req.headers['x-admin-key'];
  if (process.env.ADMIN_KEY && key !== process.env.ADMIN_KEY) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  const { masters, pga, usopen, open } = req.body;
  if (masters) TOURNAMENT_IDS.masters = masters;
  if (pga)     TOURNAMENT_IDS.pga     = pga;
  if (usopen)  TOURNAMENT_IDS.usopen  = usopen;
  if (open)    TOURNAMENT_IDS.open    = open;
  Object.keys(cache).forEach(k => delete cache[k]);
  res.json({ updated: TOURNAMENT_IDS });
});


// ═══════════════════════════════════════════════════════════════════
//  TEST ENDPOINT — fetch any tournament by ESPN ID
//  GET /leaderboard/test?id=401811940
// ═══════════════════════════════════════════════════════════════════
app.get('/leaderboard/test', async (req, res) => {
  const tourneyId = req.query.id;
  if (!tourneyId) return res.status(400).json({ error: 'id query param required' });
  try {
    const urls = [
      `https://site.api.espn.com/apis/site/v2/sports/golf/pga/leaderboard?tournamentId=${tourneyId}`,
      `https://site.api.espn.com/apis/site/v2/sports/golf/pga-tour/leaderboard?tournamentId=${tourneyId}`,
      `https://site.api.espn.com/apis/site/v2/sports/golf/leaderboard?tournamentId=${tourneyId}`,
    ];
    let espnRes, lastErr;
    for (const url of urls) {
      try {
        espnRes = await fetch(url, { timeout: 10000 });
        if (espnRes.ok) break;
        lastErr = `ESPN ${espnRes.status} from ${url}`;
      } catch(e) { lastErr = e.message; }
    }
    if (!espnRes || !espnRes.ok) throw new Error(lastErr || 'ESPN unreachable');
    const data = await espnRes.json();

    const comp = data.events?.[0]?.competitions?.[0];
    if (!comp) return res.json({ players: [], round: 'No data', tourneyId });

    const round = comp.status?.type?.description || '';
    const players = (comp.competitors || []).map(c => {
      const score = c.score || {};
      const toParStr = score.displayValue || 'E';
      const toPar = toParStr === 'E' ? 0 : parseInt(toParStr.replace('+','')) || 0;
      return {
        name: c.athlete?.displayName || '?',
        position: parseInt(c.status?.position?.id || 999),
        posDisplay: c.status?.position?.displayValue || c.status?.displayValue || '—',
        toPar, toParStr,
        isMC: c.status?.type?.id === '2',
      };
    }).sort((a,b) => a.position - b.position);

    res.json({ players, round, tourneyId, count: players.length });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});


// ═══════════════════════════════════════════════════════════════════
//  START
// ═══════════════════════════════════════════════════════════════════
app.listen(PORT, () => {
  console.log(`\n⛳  Major Pool Proxy running on port ${PORT}`);
  console.log(`   Health:    http://localhost:${PORT}/health`);
  console.log(`   Leaderboard: http://localhost:${PORT}/leaderboard/masters`);
  console.log(`   Raw names: http://localhost:${PORT}/leaderboard/masters/raw`);
  console.log(`   Overrides: http://localhost:${PORT}/config/names\n`);
});
