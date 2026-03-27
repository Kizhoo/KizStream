const express = require('express');
const axios   = require('axios');
const cheerio = require('cheerio');
const cors    = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

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

async function fetchWithFallback(targetUrl, extraHeaders = {}) {
  const url = targetUrl.startsWith('http') ? targetUrl : `${BASE_URL}${targetUrl}`;
  let lastErr;
  for (const fn of GET_PROXIES) {
    try {
      const res = await axios.get(fn(url), { headers: { ...BASE_HEADERS, ...extraHeaders }, timeout: 22000, maxRedirects: 5 });
      const html = typeof res.data === 'string' ? res.data : JSON.stringify(res.data);
      if (res.status === 200 && html.length > 300) return res;
    } catch (e) { lastErr = e; }
  }
  throw lastErr || new Error('All proxies failed');
}

async function postWithFallback(targetUrl, body, extraHeaders = {}) {
  const url = targetUrl.startsWith('http') ? targetUrl : `${BASE_URL}${targetUrl}`;
  let lastErr;
  for (const fn of POST_PROXIES) {
    try {
      const res = await axios.post(fn(url), body, { headers: { ...AJAX_HEADERS, ...extraHeaders }, timeout: 22000 });
      if (res.data) return res;
    } catch (e) { lastErr = e; }
  }
  throw lastErr || new Error('All POST proxies failed');
}

function extractIframeUrl(html) {
  if (!html || typeof html !== 'string') return null;
  const $ = cheerio.load(html);
  const src = $('iframe').attr('src') || $('iframe').attr('data-src')
           || $('source').attr('src') || $('video').attr('src');
  if (src && src.length > 5) return src.startsWith('//') ? 'https:' + src : src;
  const patterns = [
    /src=["'](https?:\/\/[^"']+)["']/i,
    /(?:file|url)["']?\s*:\s*["'](https?:\/\/[^"']+)["']/i,
    /(https?:\/\/(?:streamtape|doodstream|dood\.|filelions|pixeldrain|streamlare|mp4upload)[^\s"'<>]+)/i,
  ];
  for (const p of patterns) { const m = p.exec(html); if (m) return m[1]; }
  return null;
}

// ── LATEST ──────────────────────────────────────────────────
async function animeterbaru(page = 1) {
  const res = await fetchWithFallback(`${BASE_URL}/anime-terbaru/page/${page}/`);
  const $ = cheerio.load(res.data);
  const data = [];
  $('.post-show ul li').each((_, e) => {
    const a = $(e).find('.dtla h2 a');
    const url = a.attr('href');
    if (!url) return;
    data.push({ title: a.text().trim(), url, image: $(e).find('.thumb img').attr('src') || $(e).find('.thumb img').attr('data-src') || '', episode: $(e).find('.dtla span').filter((_,s)=>$(s).text().includes('Episode')).text().replace('Episode','').trim() });
  });
  return data;
}

// ── SEARCH ──────────────────────────────────────────────────
async function search(query) {
  const res = await fetchWithFallback(`${BASE_URL}/?s=${encodeURIComponent(query)}`);
  const $ = cheerio.load(res.data);
  const data = [];
  $('.animpost').each((_, e) => {
    const url = $(e).find('a').attr('href');
    if (!url) return;
    data.push({ title: $(e).find('.data .title h2').text().trim() || $(e).find('h2').text().trim(), image: $(e).find('img').attr('src') || $(e).find('img').attr('data-src') || '', type: $(e).find('.type').text().trim(), score: $(e).find('.score').text().trim(), url });
  });
  return data;
}

// ── DETAIL ──────────────────────────────────────────────────
async function detail(link) {
  let targetUrl = link.startsWith('http') ? link : `${BASE_URL}${link}`;
  targetUrl = targetUrl.replace('v1.samehadaku.how', 'v2.samehadaku.how');
  const res = await fetchWithFallback(targetUrl);
  const $ = cheerio.load(res.data);

  const epSelectors = ['.lstepsiode ul li', '.epsiode ul li', '#episodelist ul li', '.eps-list ul li', '.bxcl ul li'];
  let epEl = $([]);
  for (const sel of epSelectors) { epEl = $(sel); if (epEl.length) break; }
  const episodes = [];
  epEl.each((_, e) => {
    const url = $(e).find('a').attr('href');
    if (!url) return;
    episodes.push({ title: $(e).find('.lchx a').text().trim() || $(e).find('a').text().trim(), url: url.replace('v1.samehadaku.how','v2.samehadaku.how'), date: $(e).find('.date').text().trim() });
  });

  // Extract info with multiple key names
  const info = {};
  const infoSelectors = ['.spe span', '.anim-senct .right-senc .spe span', '.infox .spe span', '.infoanime .spe span'];
  for (const sel of infoSelectors) {
    $(sel).each((_, e) => {
      const t = $(e).text();
      if (!t.includes(':')) return;
      const ci = t.indexOf(':');
      const k = t.substring(0,ci).trim().toLowerCase().replace(/\s+/g,'_');
      const v = t.substring(ci+1).trim();
      if (k && v) info[k] = v;
    });
    if (Object.keys(info).length > 0) break;
  }

  // Robust score extraction
  let score = info.skor || info.score || info.rating || info.nilai || info.rate || '';
  if (!score) {
    const scoreEls = ['.score b', '.score', '[itemprop="ratingValue"]', '.num', '.rating-val', 'span.num'];
    for (const sel of scoreEls) { const t = $(sel).first().text().trim(); if (t && /\d/.test(t)) { const m = t.match(/(\d+\.?\d*)/); if (m) { score = m[1]; break; } } }
  }
  if (score) { const m = String(score).match(/(\d+\.?\d*)/); score = m ? m[1] : score; }

  return {
    title: $('h1.entry-title, h1[itemprop="name"]').first().text().trim() || $('title').text().replace(/\s*[-–]\s*Samehadaku/i,'').trim(),
    image: $('meta[property="og:image"]').attr('content') || $('.infoanime img').attr('src') || '',
    description: $('.entry-content p').first().text().trim() || $('meta[name="description"]').attr('content') || '',
    score,
    episodes,
    info,
  };
}

// ── WATCH ────────────────────────────────────────────────────
async function download(link) {
  let targetUrl = link.startsWith('http') ? link : `${BASE_URL}${link}`;
  targetUrl = targetUrl.replace('v1.samehadaku.how','v2.samehadaku.how');
  const res = await fetchWithFallback(targetUrl);
  const $ = cheerio.load(res.data);
  const title = $('h1[itemprop="name"], h1.entry-title').first().text().trim();
  const streams = [];
  const cookieStr = (res.headers['set-cookie']||[]).map(c=>c.split(';')[0]).join('; ');

  const pageHtml = typeof res.data === 'string' ? res.data : '';
  let nonce = null;
  for (const pat of [/["']nonce["']\s*:\s*["']([a-f0-9]{8,12})["']/i, /nonce\s*=\s*["']([a-f0-9]{8,12})["']/i, /"nonce"\s*:\s*"([^"]+)"/i]) {
    const m = pat.exec(pageHtml); if (m) { nonce = m[1]; break; }
  }

  const serverSelectors = ['div#server > ul > li','#server ul li','.mirror > ul > li','.server-list li','[id*="server"] ul li'];
  let serverEl = $([]);
  for (const sel of serverSelectors) { serverEl = $(sel); if (serverEl.length) break; }
  if (!serverEl.length) return { title, streams: [] };

  const ajaxDomain = new URL(targetUrl).origin;
  const ajaxUrl = `${ajaxDomain}/wp-admin/admin-ajax.php`;

  for (const li of serverEl.toArray()) {
    const div = $(li).find('div[data-post]');
    const post = div.attr('data-post'), nume = div.attr('data-nume'), type = div.attr('data-type')||'streaming';
    const name = $(li).find('span').first().text().trim() || `Server-${streams.length+1}`;
    if (!post || !nume) continue;
    const params = { action:'player_ajax', post, nume, type };
    if (nonce) params.nonce = nonce;
    try {
      let r = await postWithFallback(ajaxUrl, new URLSearchParams(params).toString(), { Referer: targetUrl, Origin: ajaxDomain, Cookie: cookieStr });
      let raw = r.data;
      if (String(raw).trim() === '0' && nonce) { const p2 = {...params}; delete p2.nonce; r = await postWithFallback(ajaxUrl, new URLSearchParams(p2).toString(), { Referer: targetUrl, Origin: ajaxDomain, Cookie: cookieStr }); raw = r.data; }
      let url = null;
      if (typeof raw === 'object') { const chunk = raw.data||raw.embed||raw.html||''; url = extractIframeUrl(chunk) || raw.url || raw.file; }
      if (!url && typeof raw === 'string') { if (raw.trim().startsWith('{')) { try { const p = JSON.parse(raw); url = extractIframeUrl(p.data||p.embed||p.html||'') || p.url; } catch(_){} } if (!url) url = extractIframeUrl(raw); }
      if (url) { if (url.startsWith('//')) url = 'https:'+url; if (url.startsWith('http') && !streams.find(s=>s.url===url)) streams.push({ server: name, url }); }
    } catch(e) { console.error(`[Stream] ${name}: ${e.message}`); }
  }
  return { title, streams };
}

// ── JADWAL (AniList GraphQL — reliable, no scraping needed) ─
async function jadwal() {
  const days = ['minggu','senin','selasa','rabu','kamis','jumat','sabtu'];
  const result = { senin:[], selasa:[], rabu:[], kamis:[], jumat:[], sabtu:[], minggu:[] };

  // Get current week timestamps
  const now = new Date();
  const weekStart = new Date(now); weekStart.setDate(now.getDate() - now.getDay()); weekStart.setHours(0,0,0,0);
  const weekEnd = new Date(weekStart); weekEnd.setDate(weekStart.getDate() + 7);

  const query = `query {
    Page(page:1,perPage:100) {
      airingSchedules(
        airingAt_greater:${Math.floor(weekStart.getTime()/1000)}
        airingAt_lesser:${Math.floor(weekEnd.getTime()/1000)}
        sort:TIME
      ) {
        airingAt episode
        media {
          id
          title { romaji english native }
          coverImage { medium large }
          averageScore genres status
          siteUrl
          episodes
          duration
        }
      }
    }
  }`;

  try {
    const res = await axios.post('https://graphql.anilist.co', { query }, { headers: { 'Content-Type':'application/json', 'Accept':'application/json' }, timeout: 20000 });
    const schedules = res.data?.data?.Page?.airingSchedules || [];
    schedules.forEach(item => {
      const d = new Date(item.airingAt * 1000);
      const dayKey = days[d.getDay()];
      const title = item.media.title.romaji || item.media.title.english || '';
      const h = String(d.getHours()).padStart(2,'0'), m = String(d.getMinutes()).padStart(2,'0');
      result[dayKey].push({
        title,
        url: item.media.siteUrl || `https://myanimelist.net/search/all?q=${encodeURIComponent(title)}`,
        image: item.media.coverImage.large || item.media.coverImage.medium || '',
        time: `${h}:${m}`,
        episode: String(item.episode),
        score: item.media.averageScore ? (item.media.averageScore/10).toFixed(1) : '',
        genres: item.media.genres || [],
        status: item.media.status || '',
        anilistId: item.media.id,
      });
    });
    return result;
  } catch(e) {
    // Fallback: scrape samehadaku jadwal
    try {
      const r = await fetchWithFallback(`${BASE_URL}/jadwal-rilis/`);
      const $ = cheerio.load(r.data);
      const dayMap = { senin:'senin',selasa:'selasa',rabu:'rabu',kamis:'kamis',jumat:'jumat',sabtu:'sabtu',minggu:'minggu',monday:'senin',tuesday:'selasa',wednesday:'rabu',thursday:'kamis',friday:'jumat',saturday:'sabtu',sunday:'minggu' };
      let curDay = null;
      $('[class*="day"], [id*="day"], h2, h3, .kl-title, .schedule-title').each((_,el) => {
        const txt = $(el).text().trim().toLowerCase();
        if (dayMap[txt]) curDay = dayMap[txt];
      });
      // Simple fallback: return empty with message
      return result;
    } catch(_) { return result; }
  }
}

// ── ROUTES ───────────────────────────────────────────────────
app.get('/api/latest', async (req,res) => { try { res.json(await animeterbaru(req.query.page||1)); } catch(e) { res.status(500).json({error:e.message}); } });
app.get('/api/search', async (req,res) => { try { res.json(await search(req.query.q)); } catch(e) { res.status(500).json({error:e.message}); } });
app.get('/api/detail', async (req,res) => { try { res.json(await detail(req.query.url)); } catch(e) { res.status(500).json({error:e.message}); } });
app.get('/api/watch',  async (req,res) => { try { res.json(await download(req.query.url)); } catch(e) { res.status(500).json({error:e.message,streams:[]}); } });
app.get('/api/jadwal', async (req,res) => { try { res.json(await jadwal()); } catch(e) { res.status(500).json({error:e.message}); } });

app.get('/api/debug', async (req,res) => {
  if (req.query.url) {
    try {
      const r = await fetchWithFallback(req.query.url);
      const $ = cheerio.load(r.data);
      const servers = [];
      $('div#server > ul > li, #server ul li').each((_,el) => {
        const div=$(el).find('div[data-post]');
        servers.push({name:$(el).find('span').first().text().trim(), post:div.attr('data-post'), nume:div.attr('data-nume'), type:div.attr('data-type')});
      });
      let nonce=null;
      for(const pat of [/["']nonce["']\s*:\s*["']([a-f0-9]{8,12})["']/i,/"nonce"\s*:\s*"([^"]+)"/i]){const m=pat.exec(r.data);if(m){nonce=m[1];break;}}
      res.json({servers,nonce,chars:r.data.length,snippet:r.data.substring(0,500)});
    } catch(e) { res.status(500).json({error:e.message}); }
  } else {
    res.json({status:'ok',base:BASE_URL,time:new Date().toISOString()});
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`NimeStream API running on :${PORT}`));
module.exports = app;

// ── ALL ANIME LIST (paginated scraping of daftar-anime) ──────
async function animelist(page = 1, letter = '') {
  // Samehadaku has /daftar-anime/ with full alphabetical list
  let url;
  if (letter) {
    url = `${BASE_URL}/daftar-anime/?title=${encodeURIComponent(letter)}&status=&type=&order=title`;
  } else {
    url = `${BASE_URL}/daftar-anime/page/${page}/?status=&type=&order=update`;
  }
  const res = await fetchWithFallback(url);
  const $ = cheerio.load(res.data);
  const data = [];

  // Primary selector for anime list page
  const selectors = [
    '.animposterfull', '.animpost', '.listupd .bs', 
    '.soralist li', '.anime-list li', '.listupd article'
  ];
  
  let found = false;
  for (const sel of selectors) {
    const els = $(sel);
    if (!els.length) continue;
    found = true;
    els.each((_, e) => {
      const a = $(e).find('a').first();
      const url = a.attr('href');
      if (!url) return;
      const title = $(e).find('.tt, h2, .title, .data h3').first().text().trim() || a.attr('title') || '';
      const image = $(e).find('img').attr('src') || $(e).find('img').attr('data-src') || '';
      const score = $(e).find('.rating, .score, .num').text().trim();
      const type  = $(e).find('.typez, .type').text().trim();
      const status= $(e).find('.status').text().trim();
      if (title) data.push({ title, url, image, score, type, status });
    });
    break;
  }

  // Get total pages
  let totalPages = 1;
  const lastPageEl = $('a.last, .pagination a:last-child, .nav-links a:last-child').attr('href') || '';
  const pageMatch = lastPageEl.match(/page\/(\d+)/);
  if (pageMatch) totalPages = parseInt(pageMatch[1]);

  return { data, page: parseInt(page), totalPages, total: data.length };
}

app.get('/api/animelist', async (req, res) => {
  try { res.json(await animelist(req.query.page || 1, req.query.letter || '')); }
  catch (e) { console.error(e.message); res.status(500).json({ error: e.message }); }
});
