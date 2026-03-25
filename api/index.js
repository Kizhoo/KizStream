const express = require('express');
const axios = require('axios');
const cheerio = require('cheerio');
const cors = require('cors');

const app = express();
app.use(cors());

const BASE_URL = 'https://v2.samehadaku.how';

// =======================================================
// Strategi: coba direct dulu, fallback ke proxy
// Kenapa? Vercel IP bisa diblok Cloudflare samehadaku,
// tapi proxy pihak ketiga punya IP berbeda yang lolos.
// =======================================================

const GET_PROXIES = [
  // direct (null) dihapus - Vercel IP diblok 403 oleh Cloudflare samehadaku
  (url) => `https://cors.caliph.my.id/${url}`,
  (url) => `https://corsproxy.io/?${url}`,
  // allorigins dihapus - sering timeout 408
];

// POST proxy
const POST_PROXIES = [
  (url) => `https://cors.caliph.my.id/${url}`,
  (url) => `https://corsproxy.io/?${url}`,
];

const BASE_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
  'Accept-Language': 'id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7',
  'Cache-Control': 'no-cache',
  'Pragma': 'no-cache',
};

const AJAX_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
  'Accept': '*/*',
  'Accept-Language': 'id-ID,id;q=0.9,en-US;q=0.8',
  'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
  'X-Requested-With': 'XMLHttpRequest',
};

async function fetchWithFallback(targetUrl, extraHeaders = {}) {
  const url = targetUrl.startsWith('http') ? targetUrl : `${BASE_URL}${targetUrl}`;
  let lastError;

  for (const proxyFn of GET_PROXIES) {
    const finalUrl = proxyFn ? proxyFn(url) : url;
    const label = proxyFn ? finalUrl.split('?')[0].split('/').slice(0,3).join('/') : 'direct';
    try {
      console.log(`[GET] ${label}`);
      const res = await axios.get(finalUrl, {
        headers: { ...BASE_HEADERS, ...extraHeaders },
        timeout: 20000,
        maxRedirects: 5,
      });
      // Validasi: response harus ada isinya (bukan 403/captcha kosong)
      const html = typeof res.data === 'string' ? res.data : JSON.stringify(res.data);
      if (res.status === 200 && html.length > 500) {
        console.log(`[GET] ✅ OK via ${label} (${html.length} chars)`);
        return res;
      }
      console.log(`[GET] ⚠️ ${label} response terlalu pendek (${html.length} chars), skip`);
    } catch (err) {
      console.error(`[GET] ❌ ${label}: ${err.message}`);
      lastError = err;
    }
  }
  throw lastError || new Error('Semua GET method gagal');
}

async function postWithFallback(targetUrl, body, extraHeaders = {}) {
  const url = targetUrl.startsWith('http') ? targetUrl : `${BASE_URL}${targetUrl}`;
  let lastError;

  for (const proxyFn of POST_PROXIES) {
    const finalUrl = proxyFn ? proxyFn(url) : url;
    const label = proxyFn ? finalUrl.split('?')[0].split('/').slice(0,3).join('/') : 'direct';
    try {
      console.log(`[POST] ${label}`);
      const res = await axios.post(finalUrl, body, {
        headers: { ...AJAX_HEADERS, ...extraHeaders },
        timeout: 20000,
      });
      if (res.data) {
        console.log(`[POST] ✅ OK via ${label}`);
        return res;
      }
    } catch (err) {
      console.error(`[POST] ❌ ${label}: ${err.message}`);
      lastError = err;
    }
  }
  throw lastError || new Error('Semua POST method gagal');
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
  let targetUrl = link.startsWith('http') ? link : `${BASE_URL}${link}`;
  targetUrl = targetUrl.replace('v1.samehadaku.how', 'v2.samehadaku.how');
  const res = await fetchWithFallback(targetUrl);
  const $ = cheerio.load(res.data);

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
      // Normalize domain v1 -> v2 di setiap URL episode
      url: url.replace('v1.samehadaku.how', 'v2.samehadaku.how'),
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

// ==========================================
// HELPER: Ekstrak URL stream dari berbagai format HTML/string
// ==========================================
function extractIframeUrl(html) {
  if (!html || typeof html !== 'string') return null;
  const $ = cheerio.load(html);

  // Priority: iframe > source > video
  const iframeSrc = $('iframe').attr('src') || $('iframe').attr('data-src');
  if (iframeSrc && iframeSrc.length > 5) return iframeSrc;

  const sourceSrc = $('source').attr('src');
  if (sourceSrc && sourceSrc.length > 5) return sourceSrc;

  const videoSrc = $('video').attr('src');
  if (videoSrc && videoSrc.length > 5) return videoSrc;

  // Regex fallback: cari URL https di dalam string
  const patterns = [
    /src=["'](https?:\/\/[^"']+)["']/i,
    /file["']?\s*:\s*["'](https?:\/\/[^"']+)["']/i,
    /url["']?\s*:\s*["'](https?:\/\/[^"']+)["']/i,
    /(https?:\/\/(?:streamtape|doodstream|dood\.|filelions|pixeldrain|streamlare|mp4upload|krakenfiles|gofile)[^\s"'<>]+)/i,
  ];
  for (const pat of patterns) {
    const m = pat.exec(html);
    if (m && m[1]) return m[1];
  }
  return null;
}

async function download(link) {
  // Normalize: episode URL dari detail page mungkin masih pakai v1
  let targetUrl = link.startsWith('http') ? link : `${BASE_URL}${link}`;
  targetUrl = targetUrl.replace('v1.samehadaku.how', 'v2.samehadaku.how');
  const res = await fetchWithFallback(targetUrl);
  const $ = cheerio.load(res.data);
  const title = $('h1[itemprop="name"], h1.entry-title').first().text().trim();
  const streams = [];
  const cookieStr = (res.headers['set-cookie'] || []).map(c => c.split(';')[0]).join('; ');

  const serverSelectors = [
    'div#server > ul > li', '#server ul li', '.mirror > ul > li',
    '.server-list li', '.mirrorstream ul li', '[id*="server"] ul li',
  ];
  let serverElements = $([]);
  for (const sel of serverSelectors) {
    serverElements = $(sel);
    if (serverElements.length > 0) {
      console.log(`[Stream] "${sel}" -> ${serverElements.length} server(s)`);
      break;
    }
  }

  if (serverElements.length === 0) {
    console.error('[Stream] ❌ Server elements tidak ditemukan');
    return { title, streams: [] };
  }

  // ==========================================
  // FIX KRITIS: Ekstrak nonce dari halaman
  // WordPress membutuhkan nonce valid agar AJAX tidak return "0"
  // ==========================================
  const pageHtml = typeof res.data === 'string' ? res.data : '';
  let nonce = null;
  const noncePatterns = [
    /["']nonce["']\s*:\s*["']([a-f0-9]{8,12})["']/i,
    /nonce\s*=\s*["']([a-f0-9]{8,12})["']/i,
    /player_nonce["']?\s*[:=]\s*["']([a-f0-9]{8,12})["']/i,
    /var\s+nonce\s*=\s*["']([^"']+)["']/i,
    /"nonce"\s*:\s*"([^"]+)"/i,
  ];
  for (const pat of noncePatterns) {
    const m = pat.exec(pageHtml);
    if (m && m[1]) { nonce = m[1]; console.log(`[Stream] Nonce found: ${nonce}`); break; }
  }
  if (!nonce) console.log('[Stream] ⚠️ No nonce found in page, AJAX may return 0');

  // Gunakan domain dari targetUrl (bukan BASE_URL) untuk AJAX
  const ajaxDomain = new URL(targetUrl).origin;
  const ajaxUrl = `${ajaxDomain}/wp-admin/admin-ajax.php`;
  console.log(`[Stream] AJAX URL: ${ajaxUrl}, nonce: ${nonce}`);

  for (const li of serverElements.toArray()) {
    const div = $(li).find('div[data-post]');
    const post = div.attr('data-post');
    const nume = div.attr('data-nume');
    const type = div.attr('data-type') || 'streaming';
    const name = $(li).find('span').first().text().trim() || `Server-${streams.length + 1}`;
    if (!post || !nume) continue;

    // Sertakan nonce - WAJIB agar AJAX tidak balik "0"
    const bodyParams = { action: 'player_ajax', post, nume, type };
    if (nonce) bodyParams.nonce = nonce;
    const body = new URLSearchParams(bodyParams).toString();
    console.log(`[Stream] Trying server: "${name}" post=${post} nume=${nume} type=${type}`);
    try {
      const r = await postWithFallback(ajaxUrl, body, {
        'Referer': targetUrl,
        'Origin': BASE_URL,
        'Cookie': cookieStr,
        'Host': 'v1.samehadaku.how',
      });

      // ==========================================
      // FIX: Handle semua format response AJAX
      // WordPress bisa return: HTML, JSON object, JSON string, atau angka "0"
      // ==========================================
      let streamUrl = null;
      const rawData = r.data;
      console.log(`[Stream] Raw response type: ${typeof rawData}, preview: ${String(rawData).substring(0, 200)}`);

      // Case 1: Response sudah object JSON (axios auto-parse)
      if (typeof rawData === 'object' && rawData !== null) {
        // Format: { data: "<iframe...>" } atau { embed: "..." } atau { url: "..." }
        const htmlChunk = rawData.data || rawData.embed || rawData.html || rawData.content || '';
        if (htmlChunk) streamUrl = extractIframeUrl(htmlChunk);
        if (!streamUrl && rawData.url) streamUrl = rawData.url;
        if (!streamUrl && rawData.file) streamUrl = rawData.file;
      }

      // Case 2: Response string (HTML atau JSON string)
      if (!streamUrl && typeof rawData === 'string') {
        // Coba parse sebagai JSON dulu
        if (rawData.trim().startsWith('{') || rawData.trim().startsWith('[')) {
          try {
            const parsed = JSON.parse(rawData);
            const htmlChunk = parsed.data || parsed.embed || parsed.html || parsed.content || '';
            if (htmlChunk) streamUrl = extractIframeUrl(htmlChunk);
            if (!streamUrl && parsed.url) streamUrl = parsed.url;
          } catch (_) {}
        }
        // Kalau bukan JSON atau JSON tidak ada URL, parse sebagai HTML langsung
        if (!streamUrl) streamUrl = extractIframeUrl(rawData);
      }

      // Normalize URL
      if (streamUrl && streamUrl.startsWith('//')) streamUrl = 'https:' + streamUrl;

      if (streamUrl && streamUrl.startsWith('http') && !streams.find(s => s.url === streamUrl)) {
        streams.push({ server: name, url: streamUrl });
        console.log(`[Stream] ✅ "${name}" -> ${streamUrl}`);
      } else {
        console.log(`[Stream] ⚠️ No URL for "${name}". Parsed: ${streamUrl}`);
      }
    } catch (e) {
      console.error(`[Stream Error] "${name}": ${e.message}`);
    }
  }

  console.log(`[Stream] Total: ${streams.length} stream(s)`);
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

// Debug: /api/debug?url=URL_EPISODE
// Tampilkan raw AJAX response untuk diagnosa
app.get('/api/debug', async (req, res) => {
  if (!req.query.url) {
    // Test koneksi semua proxy
    const results = { timestamp: new Date().toISOString(), tests: [] };
    for (const proxyFn of GET_PROXIES) {
      const testUrl = `${BASE_URL}/`;
      const finalUrl = proxyFn ? proxyFn(testUrl) : testUrl;
      const label = proxyFn ? finalUrl.split('?')[0].split('/').slice(0,3).join('/') : 'direct';
      try {
        const start = Date.now();
        const r = await axios.get(finalUrl, { headers: BASE_HEADERS, timeout: 10000 });
        const html = typeof r.data === 'string' ? r.data : JSON.stringify(r.data);
        results.tests.push({ label, status: 'OK', ms: Date.now() - start, chars: html.length });
      } catch (e) {
        results.tests.push({ label, status: 'FAIL', error: e.message });
      }
    }
    return res.json(results);
  }

  try {
    const targetUrl = req.query.url;
    const res2 = await fetchWithFallback(targetUrl);
    const $ = cheerio.load(res2.data);
    const cookieStr = (res2.headers['set-cookie'] || []).map(c => c.split(';')[0]).join('; ');

    // Ekstrak nonce dari halaman
    const noncePatterns = [
      /nonce["']?\s*[:=]\s*["']([a-f0-9]{10})["']/i,
      /player_nonce["']?\s*[:=]\s*["']([a-f0-9]{10})["']/i,
      /"nonce":"([^"]+)"/i,
      /var\s+\w+\s*=\s*\{[^}]*nonce[^}]*\}/gi,
    ];
    const pageHtml = res2.data;
    let nonce = null;
    for (const pat of noncePatterns) {
      const m = pat.exec(pageHtml);
      if (m && m[1]) { nonce = m[1]; break; }
    }

    // Cari server elements
    const servers = [];
    $('div#server > ul > li, #server ul li').each((_, el) => {
      const div = $(el).find('div[data-post]');
      servers.push({
        name: $(el).find('span').first().text().trim(),
        post: div.attr('data-post'),
        nume: div.attr('data-nume'),
        type: div.attr('data-type'),
      });
    });

    // Test AJAX untuk server pertama
    let ajaxTest = null;
    if (servers.length > 0 && servers[0].post) {
      const { post, nume, type } = servers[0];
      const body = new URLSearchParams({ action: 'player_ajax', post, nume: nume || '1', type: type || 'streaming' }).toString();
      try {
        const ajaxRes = await postWithFallback(`${BASE_URL}/wp-admin/admin-ajax.php`, body, {
          'Referer': targetUrl, 'Origin': BASE_URL, 'Cookie': cookieStr,
        });
        ajaxTest = {
          status: 'OK',
          type: typeof ajaxRes.data,
          raw: String(ajaxRes.data).substring(0, 500),
        };
      } catch (e) {
        ajaxTest = { status: 'FAIL', error: e.message };
      }
    }

    res.json({
      url: targetUrl,
      cookieCount: cookieStr.split(';').length,
      nonce,
      serverCount: servers.length,
      servers: servers.slice(0, 5),
      ajaxTest,
      htmlSnippet: pageHtml.substring(0, 1000),
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
module.exports = app;
