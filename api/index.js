const express = require('express');
const axios = require('axios');
const cheerio = require('cheerio');
const cors = require('cors');

const app = express();
app.use(cors());

const BASE_URL = 'https://v1.samehadaku.how';

// =======================================================
// PERBAIKAN FUNDAMENTAL:
// Backend (Vercel/Node.js) TIDAK butuh CORS proxy.
// CORS hanya batasan browser. Server bisa langsung request
// ke samehadaku.how tanpa perantara apapun.
// Proxy justru jadi titik gagal utama selama ini!
// =======================================================

const BASE_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
  'Accept-Language': 'id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7',
  'Accept-Encoding': 'gzip, deflate, br',
  'Connection': 'keep-alive',
  'Cache-Control': 'no-cache',
  'Pragma': 'no-cache',
  'Sec-Fetch-Dest': 'document',
  'Sec-Fetch-Mode': 'navigate',
  'Sec-Fetch-Site': 'none',
  'Upgrade-Insecure-Requests': '1',
};

const AJAX_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
  'Accept': '*/*',
  'Accept-Language': 'id-ID,id;q=0.9,en-US;q=0.8',
  'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
  'X-Requested-With': 'XMLHttpRequest',
  'Sec-Fetch-Dest': 'empty',
  'Sec-Fetch-Mode': 'cors',
  'Sec-Fetch-Site': 'same-origin',
};

// Langsung ke samehadaku tanpa proxy
async function fetchDirect(path, extraHeaders = {}) {
  const url = path.startsWith('http') ? path : `${BASE_URL}${path}`;
  console.log(`[GET] ${url}`);
  const res = await axios.get(url, {
    headers: { ...BASE_HEADERS, ...extraHeaders },
    timeout: 25000,
    maxRedirects: 5,
  });
  return res;
}

async function postDirect(url, body, extraHeaders = {}) {
  const target = url.startsWith('http') ? url : `${BASE_URL}${url}`;
  console.log(`[POST] ${target}`);
  const res = await axios.post(target, body, {
    headers: { ...AJAX_HEADERS, ...extraHeaders },
    timeout: 25000,
  });
  return res;
}

// ==========================================
// SCRAPER FUNCTIONS
// ==========================================
async function animeterbaru(page = 1) {
  const res = await fetchDirect(`/anime-terbaru/page/${page}/`);
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
  const res = await fetchDirect(`/?s=${encodeURIComponent(query)}`);
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
  const res = await fetchDirect(targetUrl);
  const $ = cheerio.load(res.data);

  // Multiple selector fallback untuk episode list
  const epSelectors = [
    '.lstepsiode ul li', '.epsiode ul li', '#episodelist ul li',
    '.eps-list ul li', '.bxcl ul li',
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
      || $('.infoanime img').attr('src') || '',
    description: $('.entry-content p').first().text().trim()
      || $('meta[name="description"]').attr('content') || '',
    episodes,
    info,
  };
}

async function download(link) {
  const targetUrl = link.startsWith('http') ? link : `${BASE_URL}${link}`;

  // Fetch halaman episode — ambil cookies sekaligus
  const res = await fetchDirect(targetUrl);
  const $ = cheerio.load(res.data);
  const title = $('h1[itemprop="name"], h1.entry-title').first().text().trim();
  const streams = [];

  // Kumpulkan cookies dari response
  const rawCookies = res.headers['set-cookie'] || [];
  const cookieStr = rawCookies.map(c => c.split(';')[0]).join('; ');

  // Cari server list
  const serverSelectors = [
    'div#server > ul > li', '#server ul li', '.mirror > ul > li',
    '.server-list li', '.mirrorstream ul li', '[id*="server"] ul li',
  ];

  let serverElements = $([]);
  for (const sel of serverSelectors) {
    serverElements = $(sel);
    if (serverElements.length > 0) {
      console.log(`[Stream] Selector hit: "${sel}" (${serverElements.length} servers)`);
      break;
    }
  }

  if (serverElements.length === 0) {
    console.error('[Stream] ❌ Tidak ada server element. HTML:\n', $.html().substring(0, 500));
    return { title, streams: [] };
  }

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
      const r = await postDirect(ajaxUrl, body, {
        'Referer': targetUrl,
        'Origin': BASE_URL,
        'Cookie': cookieStr,
        'Host': 'v1.samehadaku.how',
      });

      const $$ = cheerio.load(typeof r.data === 'string' ? r.data : JSON.stringify(r.data));

      // Cari URL dengan berbagai cara
      let streamUrl =
        $$('iframe').attr('src') ||
        $$('iframe').attr('data-src') ||
        $$('source').attr('src') ||
        $$('video').attr('src');

      // Kalau iframe berisi relative URL, fix
      if (streamUrl && streamUrl.startsWith('//')) streamUrl = 'https:' + streamUrl;

      if (streamUrl && streamUrl.startsWith('http')) {
        if (!streams.find(s => s.url === streamUrl)) {
          streams.push({ server: name, url: streamUrl });
          console.log(`[Stream] ✅ "${name}" -> ${streamUrl}`);
        }
      } else {
        console.log(`[Stream] ⚠️ No URL for "${name}". Response (200 chars): ${String(r.data).substring(0, 200)}`);
      }
    } catch (e) {
      console.error(`[Stream Error] "${name}": ${e.message}`);
    }
  }

  console.log(`[Stream] Total: ${streams.length} stream(s) found`);
  return { title, streams };
}

// ==========================================
// ROUTES
// ==========================================
app.get('/api/latest', async (req, res) => {
  try { res.json(await animeterbaru(req.query.page || 1)); }
  catch (e) { console.error(e.message); res.status(500).json({ error: e.message }); }
});

app.get('/api/search', async (req, res) => {
  try { res.json(await search(req.query.q)); }
  catch (e) { console.error(e.message); res.status(500).json({ error: e.message }); }
});

app.get('/api/detail', async (req, res) => {
  try { res.json(await detail(req.query.url)); }
  catch (e) { console.error(e.message); res.status(500).json({ error: e.message }); }
});

app.get('/api/watch', async (req, res) => {
  try { res.json(await download(req.query.url)); }
  catch (e) { console.error(e.message); res.status(500).json({ error: e.message, streams: [] }); }
});

// Debug: /api/debug?url=https://v1.samehadaku.how/episode/xxx
app.get('/api/debug', async (req, res) => {
  try {
    if (req.query.url) {
      const r = await fetchDirect(req.query.url);
      const $ = cheerio.load(r.data);
      // Tampilkan struktur server yang ditemukan
      const servers = [];
      $('div#server > ul > li, #server ul li').each((_, el) => {
        const div = $(el).find('div');
        servers.push({
          name: $(el).find('span').text().trim(),
          post: div.attr('data-post'),
          nume: div.attr('data-nume'),
          type: div.attr('data-type'),
        });
      });
      res.json({
        status: 'OK',
        url: req.query.url,
        httpStatus: r.status,
        serverCount: servers.length,
        servers,
        htmlSnippet: $.html().substring(0, 800),
      });
    } else {
      // Test koneksi langsung ke samehadaku
      const start = Date.now();
      const r = await fetchDirect('/');
      res.json({
        status: 'OK',
        httpStatus: r.status,
        ms: Date.now() - start,
        note: 'Direct connection to samehadaku.how (no proxy)',
      });
    }
  } catch (e) {
    res.status(500).json({ status: 'FAIL', error: e.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
module.exports = app;
