const express = require('express');
const axios = require('axios');
const cheerio = require('cheerio');
const cors = require('cors');

const app = express();
app.use(cors());

const BASE_URL = 'https://v1.samehadaku.how';

// ==========================================
// PROXIES - hanya untuk GET requests
// allorigins TIDAK masuk sini karena hanya support GET simple
// ==========================================
const GET_PROXIES = [
  { prefix: 'https://cors.caliph.my.id/', encode: false },
  { prefix: 'https://corsproxy.io/?', encode: false },
  { prefix: 'https://cors-anywhere.herokuapp.com/', encode: false },
];

// Proxy yang support POST (lebih terbatas)
const POST_PROXIES = [
  { prefix: 'https://cors.caliph.my.id/', encode: false },
  { prefix: 'https://corsproxy.io/?', encode: false },
];

const BASE_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'id-ID,id;q=0.9,en-US;q=0.8',
  'Cache-Control': 'no-cache',
};

function buildProxyUrl(proxy, targetUrl) {
  return proxy.encode
    ? proxy.prefix + encodeURIComponent(targetUrl)
    : proxy.prefix + targetUrl;
}

async function fetchWithFallback(targetUrl, extraHeaders = {}) {
  const url = targetUrl.startsWith('http') ? targetUrl : `${BASE_URL}${targetUrl}`;
  let lastError;
  for (const proxy of GET_PROXIES) {
    try {
      console.log(`[GET] ${proxy.prefix}`);
      const res = await axios.get(buildProxyUrl(proxy, url), {
        headers: { ...BASE_HEADERS, ...extraHeaders },
        timeout: 20000,
      });
      if (res.data && res.status === 200) return res;
    } catch (err) {
      console.error(`[GET Fail] ${proxy.prefix}: ${err.message}`);
      lastError = err;
    }
  }
  throw lastError || new Error('Semua GET proxy gagal.');
}

async function postWithFallback(targetUrl, body, extraHeaders = {}) {
  const url = targetUrl.startsWith('http') ? targetUrl : `${BASE_URL}${targetUrl}`;
  let lastError;
  for (const proxy of POST_PROXIES) {
    try {
      console.log(`[POST] ${proxy.prefix}`);
      const res = await axios.post(buildProxyUrl(proxy, url), body, {
        headers: {
          ...BASE_HEADERS,
          'Content-Type': 'application/x-www-form-urlencoded',
          'X-Requested-With': 'XMLHttpRequest',
          ...extraHeaders,
        },
        timeout: 20000,
      });
      if (res.data) return res;
    } catch (err) {
      console.error(`[POST Fail] ${proxy.prefix}: ${err.message}`);
      lastError = err;
    }
  }
  throw lastError || new Error('Semua POST proxy gagal.');
}

// ==========================================
// HELPER: Extract URL dari berbagai format response
// ==========================================
function extractUrlFromHtml(html) {
  if (!html || typeof html !== 'string') return null;
  const $ = cheerio.load(html);

  // Priority order: iframe > source > video > meta
  const checks = [
    () => $('iframe').attr('src') || $('iframe').attr('data-src'),
    () => $('source').attr('src'),
    () => $('video').attr('src'),
    () => $('meta[property="og:video"]').attr('content'),
  ];

  for (const fn of checks) {
    const url = fn();
    if (url && url.startsWith('http')) return url;
    if (url && url.startsWith('//')) return 'https:' + url;
  }

  // Regex fallback: cari URL yang mengandung domain video player umum
  const videoPatterns = [
    /(?:src|file|url)\s*[:=]\s*["']?(https?:\/\/[^"'\s,;]+(?:\.mp4|\.m3u8|streamtape|dood|filelions|pixeldrain|krakenfiles|gofile)[^"'\s,;]*)/gi,
    /["'](https?:\/\/(?:streamtape|doodstream|dood\.|filelions|pixeldrain|krakenfiles)\.[^"'\s]+)["']/gi,
  ];

  for (const pattern of videoPatterns) {
    const match = pattern.exec(html);
    if (match && match[1]) return match[1];
  }

  return null;
}

// ==========================================
// SCRAPER FUNCTIONS
// ==========================================
async function animeterbaru(page = 1) {
  const res = await fetchWithFallback(`${BASE_URL}/anime-terbaru/page/${page}/`);
  const $ = cheerio.load(res.data);
  const data = [];
  $('.post-show ul li').each((_, e) => {
    const a = $(e).find('.dtla h2 a');
    const url = a.attr('href');
    if (!url) return;
    data.push({
      title: a.text().trim(),
      url,
      image: $(e).find('.thumb img').attr('src') || $(e).find('.thumb img').attr('data-src') || '',
      episode: $(e).find('.dtla span').filter((_, s) => $(s).text().includes('Episode')).text().replace('Episode', '').trim(),
    });
  });
  return data;
}

async function search(query) {
  const res = await fetchWithFallback(`${BASE_URL}/?s=${encodeURIComponent(query)}`);
  const $ = cheerio.load(res.data);
  const data = [];
  $('.animpost').each((_, e) => {
    const url = $(e).find('a').attr('href');
    if (!url) return;
    data.push({
      title: $(e).find('.data .title h2').text().trim() || $(e).find('h2').text().trim(),
      image: $(e).find('img').attr('src') || $(e).find('img').attr('data-src') || '',
      type: $(e).find('.type').text().trim(),
      score: $(e).find('.score').text().trim(),
      url,
    });
  });
  return data;
}

async function detail(link) {
  const targetUrl = link.startsWith('http') ? link : `${BASE_URL}${link}`;
  const res = await fetchWithFallback(targetUrl);
  const $ = cheerio.load(res.data);

  const epSelectors = [
    '.lstepsiode ul li', '.epsiode ul li', '#episodelist ul li',
    '.eps-list ul li', '.daftar-eps ul li', '.bxcl ul li',
  ];
  let epElements = $([]);
  for (const sel of epSelectors) {
    epElements = $(sel);
    if (epElements.length > 0) break;
  }

  const episodes = [];
  epElements.each((_, e) => {
    const url = $(e).find('a').attr('href');
    if (!url) return;
    episodes.push({
      title: $(e).find('.lchx a').text().trim() || $(e).find('a').text().trim(),
      url,
      date: $(e).find('.date').text().trim(),
    });
  });

  const info = {};
  const infoSelectors = ['.spe span', '.anim-senct .right-senc .spe span', '.infox .spe span'];
  for (const sel of infoSelectors) {
    $(sel).each((_, e) => {
      const t = $(e).text();
      if (t.includes(':')) {
        const ci = t.indexOf(':');
        const k = t.substring(0, ci).trim().toLowerCase().replace(/\s+/g, '_');
        const v = t.substring(ci + 1).trim();
        if (k && v) info[k] = v;
      }
    });
    if (Object.keys(info).length > 0) break;
  }

  return {
    title: $('h1.entry-title, h1[itemprop="name"]').first().text().trim()
      || $('title').text().replace(/ ?[–-] ?Samehadaku/i, '').trim(),
    image: $('meta[property="og:image"]').attr('content')
      || $('.infoanime img').attr('src') || $('.thumb img').attr('src') || '',
    description: $('.entry-content p').first().text().trim()
      || $('meta[name="description"]').attr('content') || '',
    episodes,
    info,
  };
}

// ==========================================
// DOWNLOAD/STREAM - STRATEGI BERLAPIS
// 1. Coba ekstrak iframe langsung dari HTML halaman (tanpa AJAX)
// 2. Coba AJAX admin-ajax.php (butuh POST)
// 3. Kembalikan sourceUrl sebagai fallback "buka di browser"
// ==========================================
async function download(link) {
  const targetUrl = link.startsWith('http') ? link : `${BASE_URL}${link}`;
  const res = await fetchWithFallback(targetUrl);
  const $ = cheerio.load(res.data);
  const streams = [];
  const title = $('h1[itemprop="name"], h1.entry-title').first().text().trim();
  const cookies = (res.headers['set-cookie'] || []).map(v => v.split(';')[0]).join('; ');

  // ---- STRATEGI 1: Cari iframe yang sudah ter-embed langsung di HTML ----
  console.log('[Stream] Strategy 1: Direct iframe extraction from page HTML');
  const directIframeSelectors = [
    '.pembed iframe', '.embed-responsive iframe', '.player-embed iframe',
    '#player iframe', '.vid-box iframe', '.video-player iframe',
    '[class*="player"] iframe', '[class*="embed"] iframe',
  ];
  for (const sel of directIframeSelectors) {
    $(sel).each((_, el) => {
      const src = $(el).attr('src') || $(el).attr('data-src');
      if (src) {
        const url = src.startsWith('//') ? 'https:' + src : src;
        if (!streams.find(s => s.url === url)) {
          streams.push({ server: `Direct-${streams.length + 1}`, url });
          console.log(`[Stream] ✅ Direct iframe: ${url}`);
        }
      }
    });
  }

  // ---- STRATEGI 2: AJAX via server list ----
  const serverSelectors = [
    'div#server > ul > li', '#server ul li', '.mirror > ul > li',
    '.server-list li', '.mirrorstream ul li', '[id*="server"] ul li',
  ];

  let serverElements = $([]);
  for (const sel of serverSelectors) {
    serverElements = $(sel);
    if (serverElements.length > 0) {
      console.log(`[Stream] Strategy 2: AJAX - Found "${sel}" (${serverElements.length} servers)`);
      break;
    }
  }

  if (serverElements.length > 0) {
    const ajaxUrl = `${BASE_URL}/wp-admin/admin-ajax.php`;

    for (const li of serverElements.toArray()) {
      const div = $(li).find('div[data-post]');
      const post = div.attr('data-post');
      const nume = div.attr('data-nume');
      const type = div.attr('data-type') || 'streaming';
      const name = $(li).find('span').first().text().trim()
        || $(li).text().trim() || `Server-${streams.length + 1}`;

      if (!post || !nume) continue;

      const body = new URLSearchParams({ action: 'player_ajax', post, nume, type }).toString();

      try {
        const r = await postWithFallback(ajaxUrl, body, {
          Cookie: cookies,
          Referer: targetUrl,
          Origin: BASE_URL,
        });

        const streamUrl = extractUrlFromHtml(
          typeof r.data === 'string' ? r.data : JSON.stringify(r.data)
        );

        if (streamUrl && !streams.find(s => s.url === streamUrl)) {
          streams.push({ server: name, url: streamUrl });
          console.log(`[Stream] ✅ AJAX: "${name}" -> ${streamUrl}`);
        } else {
          console.log(`[Stream] ⚠️ No URL for "${name}". Response: ${String(r.data).substring(0, 200)}`);
        }
      } catch (e) {
        console.error(`[Stream Error] "${name}": ${e.message}`);
      }
    }
  }

  // ---- Log jika benar-benar kosong ----
  if (streams.length === 0) {
    console.error('[Stream] ❌ 0 streams found. Page HTML snippet:\n', $.html().substring(0, 600));
  }

  return {
    title,
    streams,
    // FIX PENTING: Kirim sourceUrl agar frontend bisa buka di browser sebagai last resort
    sourceUrl: targetUrl,
  };
}

// ==========================================
// ROUTES
// ==========================================
app.get('/api/latest', async (req, res) => {
  try { res.json(await animeterbaru(req.query.page || 1)); }
  catch (e) { console.error(e); res.status(500).json({ error: e.message }); }
});
app.get('/api/search', async (req, res) => {
  try { res.json(await search(req.query.q)); }
  catch (e) { console.error(e); res.status(500).json({ error: e.message }); }
});
app.get('/api/detail', async (req, res) => {
  try { res.json(await detail(req.query.url)); }
  catch (e) { console.error(e); res.status(500).json({ error: e.message }); }
});
app.get('/api/watch', async (req, res) => {
  try { res.json(await download(req.query.url)); }
  catch (e) { console.error(e); res.status(500).json({ error: e.message, streams: [], sourceUrl: req.query.url }); }
});

// Debug endpoint: /api/debug
app.get('/api/debug', async (req, res) => {
  const results = { timestamp: new Date().toISOString(), proxies: [] };
  for (const proxy of GET_PROXIES) {
    try {
      const start = Date.now();
      await axios.get(buildProxyUrl(proxy, `${BASE_URL}/`), { timeout: 10000, headers: BASE_HEADERS });
      results.proxies.push({ proxy: proxy.prefix, method: 'GET', status: 'OK', ms: Date.now() - start });
    } catch (e) {
      results.proxies.push({ proxy: proxy.prefix, method: 'GET', status: 'FAIL', error: e.message });
    }
  }
  res.json(results);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
module.exports = app;
