/**
 * NimeStream API — v12
 *
 * Fixes & Upgrades:
 *  - In-memory cache dengan TTL (cegah rate-limit, hemat proxy)
 *  - Jadwal timezone fix: AniList timestamp → WIB (UTC+7)
 *  - POST nonce-retry logic diperbaiki
 *  - Input validation di semua route
 *  - Endpoint baru: /api/random, /api/genres
 *  - Error response selalu JSON terstruktur
 *  - Request logging untuk debugging
 */

'use strict';

const express = require('express');
const axios   = require('axios');
const cheerio = require('cheerio');
const cors    = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

// ── LOGGING ──────────────────────────────────────────────────
const log = {
  info:  (...a) => console.log(`[INFO]  ${new Date().toISOString()}`, ...a),
  warn:  (...a) => console.warn(`[WARN]  ${new Date().toISOString()}`, ...a),
  error: (...a) => console.error(`[ERROR] ${new Date().toISOString()}`, ...a),
};

// ── IN-MEMORY CACHE (simple TTL cache) ───────────────────────
const _cache = new Map();
function cacheGet(key) {
  const hit = _cache.get(key);
  if (!hit) return null;
  if (Date.now() > hit.exp) { _cache.delete(key); return null; }
  return hit.val;
}
function cacheSet(key, val, ttlMs = 5 * 60 * 1000) {
  _cache.set(key, { val, exp: Date.now() + ttlMs });
}
// Periodic cache cleanup
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of _cache) { if (now > v.exp) _cache.delete(k); }
}, 10 * 60 * 1000);

// ── CONSTANTS ────────────────────────────────────────────────
const BASE_URL = 'https://v2.samehadaku.how';

const GET_PROXIES = [
  (url) => `https://cors.caliph.my.id/${url}`,
  (url) => `https://corsproxy.io/?${url}`,
];
const POST_PROXIES = [
  (url) => `https://cors.caliph.my.id/${url}`,
  (url) => `https://corsproxy.io/?${url}`,
];

const BASE_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
  'Accept-Language': 'id-ID,id;q=0.9,en-US;q=0.8',
  'Cache-Control': 'no-cache',
};
const AJAX_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
  'Accept': '*/*',
  'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
  'X-Requested-With': 'XMLHttpRequest',
};

// ── PROXY FETCH HELPERS ───────────────────────────────────────
async function fetchWithFallback(targetUrl, extraHeaders = {}) {
  const url = targetUrl.startsWith('http') ? targetUrl : `${BASE_URL}${targetUrl}`;
  let lastErr;
  for (const fn of GET_PROXIES) {
    const proxyUrl = fn(url);
    try {
      log.info(`[GET] ${proxyUrl.substring(0, 80)}...`);
      const res = await axios.get(proxyUrl, {
        headers: { ...BASE_HEADERS, ...extraHeaders },
        timeout: 22000,
        maxRedirects: 5,
      });
      const html = typeof res.data === 'string' ? res.data : JSON.stringify(res.data);
      if (res.status === 200 && html.length > 300) {
        log.info(`[GET] ✅ OK (${html.length} chars)`);
        return res;
      }
      log.warn(`[GET] ⚠️ Response too short (${html.length} chars), skip`);
    } catch (e) {
      log.warn(`[GET] ❌ ${e.message}`);
      lastErr = e;
    }
  }
  throw lastErr || new Error('All GET proxies failed');
}

async function postWithFallback(targetUrl, body, extraHeaders = {}) {
  const url = targetUrl.startsWith('http') ? targetUrl : `${BASE_URL}${targetUrl}`;
  let lastErr;
  for (const fn of POST_PROXIES) {
    try {
      const res = await axios.post(fn(url), body, {
        headers: { ...AJAX_HEADERS, ...extraHeaders },
        timeout: 22000,
      });
      if (res.data !== undefined) return res;
    } catch (e) {
      log.warn(`[POST] ❌ ${e.message}`);
      lastErr = e;
    }
  }
  throw lastErr || new Error('All POST proxies failed');
}

// ── IFRAME URL EXTRACTOR ──────────────────────────────────────
function extractIframeUrl(html) {
  if (!html || typeof html !== 'string') return null;
  const $ = cheerio.load(html);
  const src = $('iframe').attr('src') || $('iframe').attr('data-src')
           || $('source').attr('src') || $('video').attr('src');
  if (src && src.length > 5) return src.startsWith('//') ? 'https:' + src : src;
  const patterns = [
    /src=["'](https?:\/\/[^"']+)["']/i,
    /(?:file|url)["']?\s*:\s*["'](https?:\/\/[^"']+)["']/i,
    /(https?:\/\/(?:streamtape|doodstream|dood\.|filelions|pixeldrain|streamlare|mp4upload|blogger\.com\/video)[^\s"'<>]+)/i,
  ];
  for (const p of patterns) { const m = p.exec(html); if (m) return m[1]; }
  return null;
}

// ── SCRAPER: LATEST ──────────────────────────────────────────
async function animeterbaru(page = 1) {
  const cacheKey = `latest_${page}`;
  const cached = cacheGet(cacheKey);
  if (cached) { log.info(`[CACHE] HIT latest_${page}`); return cached; }

  const res = await fetchWithFallback(`${BASE_URL}/anime-terbaru/page/${page}/`);
  const $ = cheerio.load(res.data);
  const data = [];
  $('.post-show ul li').each((_, e) => {
    const a = $(e).find('.dtla h2 a');
    const url = a.attr('href');
    if (!url) return;
    data.push({
      title:   a.text().trim(),
      url,
      image:   $(e).find('.thumb img').attr('src') || $(e).find('.thumb img').attr('data-src') || '',
      episode: $(e).find('.dtla span').filter((_, s) => $(s).text().includes('Episode'))
                   .text().replace('Episode', '').trim(),
    });
  });
  cacheSet(cacheKey, data, 3 * 60 * 1000); // 3 menit
  return data;
}

// ── SCRAPER: SEARCH ──────────────────────────────────────────
async function search(query) {
  const cacheKey = `search_${query.toLowerCase()}`;
  const cached = cacheGet(cacheKey);
  if (cached) { log.info(`[CACHE] HIT search_${query}`); return cached; }

  const res = await fetchWithFallback(`${BASE_URL}/?s=${encodeURIComponent(query)}`);
  const $ = cheerio.load(res.data);
  const data = [];
  $('.animpost').each((_, e) => {
    const url = $(e).find('a').attr('href');
    if (!url) return;
    data.push({
      title: $(e).find('.data .title h2').text().trim() || $(e).find('h2').text().trim(),
      image: $(e).find('img').attr('src') || $(e).find('img').attr('data-src') || '',
      type:  $(e).find('.type').text().trim(),
      score: $(e).find('.score').text().trim(),
      url,
    });
  });
  cacheSet(cacheKey, data, 10 * 60 * 1000); // 10 menit
  return data;
}

// ── SCRAPER: DETAIL ──────────────────────────────────────────
async function detail(link) {
  const cacheKey = `detail_${link}`;
  const cached = cacheGet(cacheKey);
  if (cached) { log.info(`[CACHE] HIT detail`); return cached; }

  let targetUrl = link.startsWith('http') ? link : `${BASE_URL}${link}`;
  targetUrl = targetUrl.replace('v1.samehadaku.how', 'v2.samehadaku.how');
  const res = await fetchWithFallback(targetUrl);
  const $ = cheerio.load(res.data);

  // Episodes
  const epSelectors = ['.lstepsiode ul li','.epsiode ul li','#episodelist ul li','.eps-list ul li','.bxcl ul li'];
  let epEl = $([]);
  for (const sel of epSelectors) { epEl = $(sel); if (epEl.length) break; }
  const episodes = [];
  epEl.each((_, e) => {
    const url = $(e).find('a').attr('href');
    if (!url) return;
    episodes.push({
      title: $(e).find('.lchx a').text().trim() || $(e).find('a').text().trim(),
      url:   url.replace('v1.samehadaku.how', 'v2.samehadaku.how'),
      date:  $(e).find('.date').text().trim(),
    });
  });

  // Info metadata
  const info = {};
  const infoSelectors = ['.spe span','.anim-senct .right-senc .spe span','.infox .spe span','.infoanime .spe span'];
  for (const sel of infoSelectors) {
    $(sel).each((_, e) => {
      const t = $(e).text();
      if (!t.includes(':')) return;
      const ci = t.indexOf(':');
      const k  = t.substring(0, ci).trim().toLowerCase().replace(/\s+/g, '_');
      const v  = t.substring(ci + 1).trim();
      if (k && v) info[k] = v;
    });
    if (Object.keys(info).length > 0) break;
  }

  // Score (multi-selector fallback)
  let score = info.skor || info.score || info.rating || info.nilai || '';
  if (!score) {
    for (const sel of ['.score b','.score','[itemprop="ratingValue"]','.num','.rating-val']) {
      const t = $(sel).first().text().trim();
      if (t && /\d/.test(t)) { const m = t.match(/(\d+\.?\d*)/); if (m) { score = m[1]; break; } }
    }
  }
  if (score) { const m = String(score).match(/(\d+\.?\d*)/); score = m ? m[1] : score; }

  // Description: prefer meta, fallback to first paragraph
  const description = $('.entry-content p').first().text().trim()
    || $('meta[name="description"]').attr('content')
    || '';

  const result = {
    title: $('h1.entry-title, h1[itemprop="name"]').first().text().trim()
      || $('title').text().replace(/\s*[-–]\s*Samehadaku/i, '').trim(),
    image: $('meta[property="og:image"]').attr('content') || $('.infoanime img').attr('src') || '',
    description,
    score,
    episodes,
    info,
  };

  cacheSet(cacheKey, result, 15 * 60 * 1000); // 15 menit
  return result;
}

// ── SCRAPER: WATCH ───────────────────────────────────────────
async function download(link) {
  // Note: watch responses tidak di-cache karena stream URL bisa expire
  let targetUrl = link.startsWith('http') ? link : `${BASE_URL}${link}`;
  targetUrl = targetUrl.replace('v1.samehadaku.how', 'v2.samehadaku.how');
  const res = await fetchWithFallback(targetUrl);
  const $ = cheerio.load(res.data);
  const title = $('h1[itemprop="name"], h1.entry-title').first().text().trim();
  const streams = [];
  const cookieStr = (res.headers['set-cookie'] || []).map(c => c.split(';')[0]).join('; ');

  const pageHtml = typeof res.data === 'string' ? res.data : '';
  let nonce = null;
  const noncePatterns = [
    /["']nonce["']\s*:\s*["']([a-f0-9]{8,12})["']/i,
    /nonce\s*=\s*["']([a-f0-9]{8,12})["']/i,
    /"nonce"\s*:\s*"([^"]+)"/i,
  ];
  for (const pat of noncePatterns) { const m = pat.exec(pageHtml); if (m) { nonce = m[1]; log.info(`[Watch] Nonce: ${nonce}`); break; } }

  const serverSelectors = ['div#server > ul > li','#server ul li','.mirror > ul > li','.server-list li','[id*="server"] ul li'];
  let serverEl = $([]);
  for (const sel of serverSelectors) { serverEl = $(sel); if (serverEl.length) break; }
  if (!serverEl.length) { log.warn('[Watch] No server elements found'); return { title, streams: [] }; }

  const ajaxDomain = new URL(targetUrl).origin;
  const ajaxUrl    = `${ajaxDomain}/wp-admin/admin-ajax.php`;
  log.info(`[Watch] AJAX: ${ajaxUrl}, servers: ${serverEl.length}`);

  for (const li of serverEl.toArray()) {
    const div  = $(li).find('div[data-post]');
    const post = div.attr('data-post');
    const nume = div.attr('data-nume');
    const type = div.attr('data-type') || 'streaming';
    const name = $(li).find('span').first().text().trim() || `Server-${streams.length + 1}`;
    if (!post || !nume) continue;

    try {
      // FIX: Coba tanpa nonce dulu (lebih sering berhasil), fallback dengan nonce
      const paramsBase = { action: 'player_ajax', post, nume, type };
      const paramsNonce = nonce ? { ...paramsBase, nonce } : null;

      let r = await postWithFallback(ajaxUrl, new URLSearchParams(paramsBase).toString(), {
        Referer: targetUrl, Origin: ajaxDomain, Cookie: cookieStr,
      });

      // Jika response "0" dan ada nonce, coba dengan nonce
      if (String(r.data).trim() === '0' && paramsNonce) {
        log.warn(`[Watch] Got "0" for ${name}, retrying with nonce`);
        r = await postWithFallback(ajaxUrl, new URLSearchParams(paramsNonce).toString(), {
          Referer: targetUrl, Origin: ajaxDomain, Cookie: cookieStr,
        });
      }

      const raw = r.data;
      log.info(`[Watch] ${name} raw type: ${typeof raw}, preview: ${String(raw).substring(0, 100)}`);

      let url = null;
      if (typeof raw === 'object' && raw !== null) {
        const chunk = raw.data || raw.embed || raw.html || raw.content || '';
        url = extractIframeUrl(chunk) || raw.url || raw.file || null;
      }
      if (!url && typeof raw === 'string') {
        if (raw.trim().startsWith('{') || raw.trim().startsWith('[')) {
          try { const p = JSON.parse(raw); url = extractIframeUrl(p.data || p.embed || p.html || '') || p.url; } catch(_) {}
        }
        if (!url) url = extractIframeUrl(raw);
      }
      if (url && url.startsWith('//')) url = 'https:' + url;
      if (url && url.startsWith('http') && !streams.find(s => s.url === url)) {
        streams.push({ server: name, url });
        log.info(`[Watch] ✅ ${name} → ${url.substring(0, 60)}...`);
      } else {
        log.warn(`[Watch] ⚠️ ${name}: no URL extracted`);
      }
    } catch(e) {
      log.error(`[Watch] ${name}: ${e.message}`);
    }
  }

  log.info(`[Watch] Total streams: ${streams.length}`);
  return { title, streams };
}

// ── API: JADWAL (AniList GraphQL) ────────────────────────────
async function jadwal() {
  const cacheKey = `jadwal_${new Date().toDateString()}`;
  const cached = cacheGet(cacheKey);
  if (cached) { log.info('[CACHE] HIT jadwal'); return cached; }

  const days  = ['minggu','senin','selasa','rabu','kamis','jumat','sabtu'];
  const result = { senin:[], selasa:[], rabu:[], kamis:[], jumat:[], sabtu:[], minggu:[] };

  const now  = new Date();
  const weekStart = new Date(now);
  weekStart.setDate(now.getDate() - now.getDay());
  weekStart.setHours(0, 0, 0, 0);
  const weekEnd = new Date(weekStart);
  weekEnd.setDate(weekStart.getDate() + 7);

  const query = `query {
    Page(page:1,perPage:100) {
      airingSchedules(
        airingAt_greater:${Math.floor(weekStart.getTime() / 1000)}
        airingAt_lesser:${Math.floor(weekEnd.getTime() / 1000)}
        sort:TIME
      ) {
        airingAt episode
        media {
          id
          title { romaji english native }
          coverImage { medium large }
          averageScore genres status
          siteUrl episodes duration
        }
      }
    }
  }`;

  try {
    const res = await axios.post('https://graphql.anilist.co', { query }, {
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      timeout: 20000,
    });
    const schedules = res.data?.data?.Page?.airingSchedules || [];

    schedules.forEach(item => {
      const utcMs = item.airingAt * 1000;
      // FIX: Konversi ke WIB (UTC+7) untuk tampilan jam yang benar
      const wibMs   = utcMs + (7 * 60 * 60 * 1000);
      const wibDate = new Date(wibMs);
      // Day of week juga harus berdasarkan WIB, bukan UTC
      const wibDow  = wibDate.getUTCDay();
      const dayKey  = days[wibDow];
      const h = String(wibDate.getUTCHours()).padStart(2, '0');
      const m = String(wibDate.getUTCMinutes()).padStart(2, '0');
      const title = item.media.title.romaji || item.media.title.english || '';

      result[dayKey].push({
        title,
        // Tidak pakai AniList URL — doSearchByTitle akan cari di samehadaku
        url:       '',
        image:     item.media.coverImage.large || item.media.coverImage.medium || '',
        time:      `${h}:${m}`,   // Jam WIB
        episode:   String(item.episode),
        score:     item.media.averageScore ? (item.media.averageScore / 10).toFixed(1) : '',
        genres:    item.media.genres || [],
        status:    item.media.status || '',
        anilistId: item.media.id,
      });
    });

    cacheSet(cacheKey, result, 60 * 60 * 1000); // 1 jam
    return result;
  } catch(e) {
    log.error(`[Jadwal] AniList error: ${e.message}`);
    // Fallback ke cache lama kalau ada
    const old = _cache.get(cacheKey);
    if (old) return old.val;
    return result;
  }
}

// ── API: RANDOM ANIME ────────────────────────────────────────
async function randomAnime() {
  // Ambil dari latest dan pilih random
  const latest = await animeterbaru(1);
  if (!latest.length) throw new Error('No anime available');
  const pick = latest[Math.floor(Math.random() * latest.length)];
  return pick;
}

// ── API: GENRES LIST ─────────────────────────────────────────
async function genresList() {
  return [
    'Action','Adventure','Comedy','Drama','Fantasy',
    'Horror','Isekai','Magic','Mecha','Mystery',
    'Psychological','Romance','Sci-Fi','School','Shounen',
    'Slice of Life','Sports','Supernatural','Thriller',
  ];
}

// ── MIDDLEWARE: validate url param ────────────────────────────
function requireUrl(req, res, next) {
  const url = req.query.url;
  if (!url) return res.status(400).json({ error: 'Parameter ?url diperlukan' });
  if (!url.startsWith('http')) return res.status(400).json({ error: 'URL harus dimulai dengan http/https' });
  next();
}

// ── ROUTES ───────────────────────────────────────────────────
app.get('/api/latest', async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    res.json(await animeterbaru(page));
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/search', async (req, res) => {
  const q = (req.query.q || '').trim();
  if (!q) return res.status(400).json({ error: 'Parameter ?q diperlukan' });
  try { res.json(await search(q)); }
  catch(e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/detail', requireUrl, async (req, res) => {
  try { res.json(await detail(req.query.url)); }
  catch(e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/watch', requireUrl, async (req, res) => {
  try { res.json(await download(req.query.url)); }
  catch(e) { res.status(500).json({ error: e.message, streams: [] }); }
});

app.get('/api/jadwal', async (req, res) => {
  try { res.json(await jadwal()); }
  catch(e) { res.status(500).json({ error: e.message }); }
});

// NEW: Random anime
app.get('/api/random', async (req, res) => {
  try { res.json(await randomAnime()); }
  catch(e) { res.status(500).json({ error: e.message }); }
});

// NEW: Genre list
app.get('/api/genres', async (req, res) => {
  try { res.json(await genresList()); }
  catch(e) { res.status(500).json({ error: e.message }); }
});

// NEW: Cache stats (untuk debugging)
app.get('/api/cache-stats', (req, res) => {
  const stats = [];
  const now = Date.now();
  for (const [k, v] of _cache) {
    stats.push({ key: k, expiresIn: Math.round((v.exp - now) / 1000) + 's' });
  }
  res.json({ count: _cache.size, entries: stats });
});

// Debug endpoint
app.get('/api/debug', async (req, res) => {
  if (req.query.url) {
    try {
      const r = await fetchWithFallback(req.query.url);
      const $ = cheerio.load(r.data);
      const servers = [];
      $('div#server > ul > li, #server ul li').each((_, el) => {
        const div = $(el).find('div[data-post]');
        servers.push({ name: $(el).find('span').first().text().trim(), post: div.attr('data-post'), nume: div.attr('data-nume'), type: div.attr('data-type') });
      });
      let nonce = null;
      for (const pat of [/["']nonce["']\s*:\s*["']([a-f0-9]{8,12})["']/i, /"nonce"\s*:\s*"([^"]+)"/i]) {
        const m = pat.exec(r.data); if (m) { nonce = m[1]; break; }
      }
      // Test AJAX untuk server pertama
      let ajaxTest = null;
      if (servers.length > 0 && servers[0].post) {
        const { post, nume, type } = servers[0];
        try {
          const ajaxDomain = new URL(req.query.url).origin;
          const ajaxR = await postWithFallback(
            `${ajaxDomain}/wp-admin/admin-ajax.php`,
            new URLSearchParams({ action: 'player_ajax', post, nume: nume || '1', type: type || 'streaming' }).toString(),
            { Referer: req.query.url, Origin: ajaxDomain }
          );
          ajaxTest = { status: 'OK', type: typeof ajaxR.data, preview: String(ajaxR.data).substring(0, 300) };
        } catch(e) { ajaxTest = { status: 'FAIL', error: e.message }; }
      }
      res.json({ servers, nonce, ajaxTest, chars: r.data.length, snippet: r.data.substring(0, 500) });
    } catch(e) { res.status(500).json({ error: e.message }); }
  } else {
    res.json({ status: 'ok', base: BASE_URL, time: new Date().toISOString(), cacheSize: _cache.size });
  }
});

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', version: '12', uptime: process.uptime().toFixed(0) + 's', memory: Math.round(process.memoryUsage().heapUsed / 1024 / 1024) + 'MB' });
});

// ── START ─────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => log.info(`NimeStream API v12 running on :${PORT}`));
module.exports = app;
