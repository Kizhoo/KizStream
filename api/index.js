const express = require('express');
const axios = require('axios');
const cheerio = require('cheerio');
const cors = require('cors');

const app = express();
app.use(cors());

// Headers yang lebih lengkap untuk meniru browser asli
const headers = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9,id;q=0.8',
  'Referer': 'https://v1.samehadaku.how/',
  'Origin': 'https://v1.samehadaku.how'
};

const PROXY = 'https://cors.caliph.my.id/';
const BASE_URL = 'https://v1.samehadaku.how';

async function animeterbaru(page = 1) {
  try {
    const res = await axios.get(`${PROXY}${BASE_URL}/anime-terbaru/page/${page}/`, { headers });
    const $ = cheerio.load(res.data);
    const data = [];
    $('.post-show ul li').each((_, e) => {
      const a = $(e).find('.dtla h2 a');
      data.push({
        title: a.text().trim(),
        url: a.attr('href'),
        image: $(e).find('.thumb img').attr('src'),
        episode: $(e).find('.dtla span:contains("Episode")').text().replace('Episode', '').trim(),
      });
    });
    return data;
  } catch (e) { return []; }
}

async function search(query) {
  try {
    const res = await axios.get(`${PROXY}${BASE_URL}/?s=${encodeURIComponent(query)}`, { headers });
    const $ = cheerio.load(res.data);
    const data = [];
    $('.animpost').each((_, e) => {
      data.push({
        title: $(e).find('.data .title h2').text().trim(),
        image: $(e).find('.content-thumb img').attr('src'),
        type: $(e).find('.type').text().trim(),
        score: $(e).find('.score').text().trim(),
        url: $(e).find('a').attr('href')
      });
    });
    return data;
  } catch (e) { return []; }
}

async function detail(link) {
  try {
    const targetUrl = link.startsWith('http') ? link : `${BASE_URL}${link}`;
    const res = await axios.get(`${PROXY}${targetUrl}`, { headers });
    const $ = cheerio.load(res.data);

    const episodes = [];
    $('.lstepsiode ul li').each((_, e) => {
      episodes.push({
        title: $(e).find('.epsleft .lchx a').text().trim(),
        url: $(e).find('.epsleft .lchx a').attr('href'),
        date: $(e).find('.epsleft .date').text().trim()
      });
    });

    const info = {};
    $('.anim-senct .right-senc .spe span').each((_, e) => {
      const t = $(e).text();
      if (t.includes(':')) {
        const [k, v] = t.split(':');
        info[k.trim().toLowerCase().replace(/\s+/g, '_')] = v.trim();
      }
    });

    return {
      title: $('h1.entry-title').text().trim() || $('title').text().replace(' - Samehadaku', '').trim(),
      image: $('meta[property="og:image"]').attr('content'),
      description: $('.entry-content').text().trim(),
      episodes,
      info
    };
  } catch (e) { throw e; }
}

async function download(link) {
  try {
    const targetUrl = link.startsWith('http') ? link : `${BASE_URL}${link}`;
    const res = await axios.get(`${PROXY}${targetUrl}`, { headers });
    const $ = cheerio.load(res.data);
    const data = [];

    // Ambil semua elemen server
    const serverList = $('div#server > ul > li');
    
    if (serverList.length === 0) {
        // Fallback jika struktur berbeda: cari iframe langsung di konten
        const fallbackIframe = $('iframe').attr('src');
        if (fallbackIframe) data.push({ server: 'Default', url: fallbackIframe });
    }

    for (const li of serverList.toArray()) {
      const div = $(li).find('div');
      const post = div.attr('data-post');
      const nume = div.attr('data-nume');
      const type = div.attr('data-type');
      const name = $(li).find('span').text().trim() || `Server ${nume}`;
      
      if (!post || !nume) continue;

      const body = new URLSearchParams({ 
        action: 'player_ajax', 
        post: post, 
        nume: nume, 
        type: type 
      }).toString();
      
      try {
          const r = await axios.post(`${PROXY}${BASE_URL}/wp-admin/admin-ajax.php`, body, {
            headers: {
                ...headers,
                'Content-Type': 'application/x-www-form-urlencoded',
                'X-Requested-With': 'XMLHttpRequest',
                'Referer': targetUrl
            }
          });
          
          const $$ = cheerio.load(r.data);
          let iframeUrl = $$('iframe').attr('src') || $$('source').attr('src');
          
          if (iframeUrl) {
              if (iframeUrl.startsWith('//')) iframeUrl = 'https:' + iframeUrl;
              data.push({ server: name, url: iframeUrl });
          }
      } catch (e) {
          console.error(`Gagal memuat server ${name}`);
      }
    }

    return {
      title: $('.media-body h1').text().trim() || $('h1.entry-title').text().trim(),
      streams: data
    };
  } catch (e) {
    console.error("Download Error:", e.message);
    return { title: "Error", streams: [] };
  }
}

// --- ROUTES API ---
app.get('/api/latest', async (req, res) => {
  const data = await animeterbaru(req.query.page || 1);
  res.json(data);
});

app.get('/api/search', async (req, res) => {
  const data = await search(req.query.q);
  res.json(data);
});

app.get('/api/detail', async (req, res) => {
  try {
    const data = await detail(req.query.url);
    res.json(data);
  } catch (e) { res.status(500).json({ error: "Gagal mengambil detail" }); }
});

app.get('/api/watch', async (req, res) => {
  try {
    const data = await download(req.query.url);
    res.json(data);
  } catch (e) { res.status(500).json({ error: "Gagal memuat video" }); }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));

module.exports = app;
