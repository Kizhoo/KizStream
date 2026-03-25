const express = require('express');
const axios = require('axios');
const cheerio = require('cheerio');
const cors = require('cors');

const app = express();
app.use(cors());

const BASE_URL = 'https://v1.samehadaku.how';

// ==========================================
// FIX #1: MULTIPLE PROXY FALLBACK
// ==========================================
const PROXIES = [
  { prefix: 'https://cors.caliph.my.id/', encode: false },
  { prefix: 'https://corsproxy.io/?', encode: false },
  { prefix: 'https://api.allorigins.win/raw?url=', encode: true },
  { prefix: 'https://cors-anywhere.herokuapp.com/', encode: false },
];

const BASE_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
  'Accept-Language': 'id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7',
  'Cache-Control': 'no-cache',
};

function buildProxyUrl(proxy, targetUrl) {
  return proxy.encode
    ? proxy.prefix + encodeURIComponent(targetUrl)
    : proxy.prefix + targetUrl;
}

// FIX #2: FETCH DENGAN AUTO RETRY
async function fetchWithFallback(targetUrl, extraHeaders = {}) {
  const url = targetUrl.startsWith('http') ? targetUrl : `${BASE_URL}${targetUrl}`;
  let lastError;
  for (const proxy of PROXIES) {
    try {
      console.log(`[Fetch] Trying: ${proxy.prefix}`);
      const res = await axios.get(buildProxyUrl(proxy, url), {
        headers: { ...BASE_HEADERS, ...extraHeaders },
        timeout: 20000,
      });
      if (res.data && res.status === 200) return res;
    } catch (err) {
      console.error(`[Fetch Fail] ${proxy.prefix}: ${err.message}`);
      lastError = err;
    }
  }
  throw lastError || new Error('Semua proxy gagal.');
}

async function postWithFallback(targetUrl, body, extraHeaders = {}) {
  const url = targetUrl.startsWith('http') ? targetUrl : `${BASE_URL}${targetUrl}`;
  let lastError;
  for (const proxy of PROXIES) {
    try {
      console.log(`[POST] Trying: ${proxy.prefix}`);
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
  throw lastError || new Error('Semua proxy gagal untuk POST.');
}

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

  // FIX #3: MULTIPLE SELECTOR FALLBACK - EPISODE LIST
  const epSelectors = [
    '.lstepsiode ul li', '.epsiode ul li', '#episodelist ul li',
    '.eps-list ul li', '.daftar-eps ul li', '.bxcl ul li',
  ];
  let epElements = $([]);
  for (const sel of epSelectors) {
    epElements = $(sel);
    if (epElements.length > 0) { console.log(`[Detail] Episodes: "${sel}" (${epElements.length})`); break; }
  }

  const episodes = [];
  epElements.each((_, e) => {
    const a = $(e).find('a');
    const url = a.attr('href');
    if (!url) return;
    episodes.push({
      title: $(e).find('.lchx a').text().trim() || a.text().trim(),
      url,
      date: $(e).find('.date').text().trim(),
    });
  });

  // FIX #4: MULTIPLE SELECTOR FALLBACK - INFO ANIME
  const info = {};
  const infoSelectors = ['.spe span', '.anim-senct .right-senc .spe span', '.infox .spe span', '.infoanime .spe span'];
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
      || $('.sinopsis p').first().text().trim()
      || $('meta[name="description"]').attr('content') || '',
    episodes,
    info,
  };
}

// ==========================================
// FIX #5: STREAM EXTRACTION - PERBAIKAN UTAMA
// ==========================================
async function download(link) {
  const targetUrl = link.startsWith('http') ? link : `${BASE_URL}${link}`;
  const res = await fetchWithFallback(targetUrl);
  const $ = cheerio.load(res.data);
  const streams = [];

  const cookies = (res.headers['set-cookie'] || []).map(v => v.split(';')[0]).join('; ');

  // Multiple server selector patterns
  const serverSelectors = [
    'div#server > ul > li', '#server ul li', '.mirror > ul > li',
    '.server-list li', '.player-server li', '[id*="server"] ul li', '.mirrorstream ul li',
  ];

  let serverElements = $([]);
  for (const sel of serverSelectors) {
    serverElements = $(sel);
    if (serverElements.length > 0) {
      console.log(`[Stream] Selector: "${sel}" -> ${serverElements.length} server(s)`);
      break;
    }
  }

  if (serverElements.length === 0) {
    console.error('[Stream] ❌ Server elements tidak ditemukan. HTML:\n', $.html().substring(0, 800));
    return {
      title: $('h1[itemprop="name"], h1.entry-title').first().text().trim(),
      streams: [],
      error: 'Struktur HTML berubah - server elements tidak ditemukan',
    };
  }

  const ajaxUrl = `${BASE_URL}/wp-admin/admin-ajax.php`;

  for (const li of serverElements.toArray()) {
    const div = $(li).find('div[data-post]');
    const post = div.attr('data-post');
    const nume = div.attr('data-nume');
    const type = div.attr('data-type') || 'streaming';
    const name = $(li).find('span').first().text().trim()
      || $(li).text().trim() || `Server ${streams.length + 1}`;

    if (!post || !nume) continue;

    const body = new URLSearchParams({ action: 'player_ajax', post, nume, type }).toString();

    try {
      const r = await postWithFallback(ajaxUrl, body, {
        Cookie: cookies, Referer: targetUrl, Origin: BASE_URL,
      });

      const $$ = cheerio.load(r.data);
      const rawUrl = $$('iframe').attr('src') || $$('iframe').attr('data-src')
        || $$('source').attr('src') || $$('video').attr('src');

      if (rawUrl) {
        const finalUrl = rawUrl.startsWith('//') ? 'https:' + rawUrl : rawUrl;
        streams.push({ server: name, url: finalUrl });
        console.log(`[Stream] ✅ ${name} -> ${finalUrl}`);
      } else {
        console.log(`[Stream] ⚠️ No URL for "${name}". Response: ${String(r.data).substring(0, 200)}`);
      }
    } catch (e) {
      console.error(`[Stream Error] "${name}": ${e.message}`);
    }
  }

  return {
    title: $('h1[itemprop="name"], h1.entry-title').first().text().trim(),
    streams,
  };
}

// ROUTES
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
  catch (e) { console.error(e); res.status(500).json({ error: e.message, streams: [] }); }
});

// FIX #6: DEBUG ENDPOINT - cek status semua proxy
// Buka /api/debug di browser untuk melihat proxy mana yang hidup
app.get('/api/debug', async (req, res) => {
  const results = { timestamp: new Date().toISOString(), base_url: BASE_URL, proxies: [] };
  for (const proxy of PROXIES) {
    try {
      const start = Date.now();
      await axios.get(buildProxyUrl(proxy, `${BASE_URL}/`), { timeout: 10000, headers: BASE_HEADERS });
      results.proxies.push({ proxy: proxy.prefix, status: 'OK', ms: Date.now() - start });
    } catch (e) {
      results.proxies.push({ proxy: proxy.prefix, status: 'FAIL', error: e.message });
    }
  }
  res.json(results);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
module.exports = app;
