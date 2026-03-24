const express = require('express');
const axios = require('axios');
const cheerio = require('cheerio');
const cors = require('cors');

const app = express();
app.use(cors());

const BASE_URL = 'https://v1.samehadaku.how';
const PROXY = 'https://cors.caliph.my.id/';

const commonHeaders = {
    'User-Agent': 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Mobile Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
    'Accept-Language': 'id-ID,id;q=0.9,en-US;q=0.8',
    'Referer': 'https://v1.samehadaku.how/'
};

// Helper untuk fetch dengan timeout agar tidak gantung
const fetchWithProxy = async (url) => {
    return axios.get(`${PROXY}${url}`, { 
        headers: commonHeaders,
        timeout: 8000 
    });
};

app.get('/api/latest', async (req, res) => {
    try {
        const page = req.query.page || 1;
        const response = await fetchWithProxy(`${BASE_URL}/anime-terbaru/page/${page}/`);
        const $ = cheerio.load(response.data);
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
        res.json(data);
    } catch (e) { res.json([]); }
});

app.get('/api/search', async (req, res) => {
    try {
        const response = await fetchWithProxy(`${BASE_URL}/?s=${encodeURIComponent(req.query.q)}`);
        const $ = cheerio.load(response.data);
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
        res.json(data);
    } catch (e) { res.json([]); }
});

app.get('/api/detail', async (req, res) => {
    try {
        const response = await fetchWithProxy(req.query.url);
        const $ = cheerio.load(response.data);
        const episodes = [];
        $('.lstepsiode ul li').each((_, e) => {
            episodes.push({
                title: $(e).find('.epsleft .lchx a').text().trim(),
                url: $(e).find('.epsleft .lchx a').attr('href')
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
        res.json({
            title: $('h1.entry-title').text().trim(),
            image: $('meta[property="og:image"]').attr('content'),
            description: $('.entry-content').text().trim(),
            episodes,
            info
        });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/watch', async (req, res) => {
    try {
        const targetUrl = req.query.url;
        const response = await fetchWithProxy(targetUrl);
        const $ = cheerio.load(response.data);
        const streams = [];

        // STRATEGI 1: Ambil data dari elemen server (Metode AJAX)
        const serverElements = $('#server ul li div');
        
        // Kita hanya ambil maksimal 3 server pertama untuk menghindari timeout Vercel
        const limit = Math.min(serverElements.length, 3);

        for (let i = 0; i < limit; i++) {
            const el = $(serverElements[i]);
            const post = el.attr('data-post');
            const nume = el.attr('data-nume');
            const type = el.attr('data-type');
            const name = el.parent().find('span').text().trim() || `Server ${nume}`;

            if (post && nume) {
                try {
                    const params = new URLSearchParams({ action: 'player_ajax', post, nume, type });
                    const ajaxRes = await axios.post(`${PROXY}${BASE_URL}/wp-admin/admin-ajax.php`, params.toString(), {
                        headers: { 
                            ...commonHeaders, 
                            'Content-Type': 'application/x-www-form-urlencoded',
                            'X-Requested-With': 'XMLHttpRequest',
                            'Referer': targetUrl
                        }
                    });
                    const $$ = cheerio.load(ajaxRes.data);
                    let src = $$('iframe').attr('src') || $$('source').attr('src');
                    if (src) {
                        if (src.startsWith('//')) src = 'https:' + src;
                        streams.push({ server: name, url: src });
                    }
                } catch (err) { continue; }
            }
        }

        // STRATEGI 2: Fallback jika Strategi 1 gagal (Cari iframe yang bocor di HTML)
        if (streams.length === 0) {
            $('iframe').each((_, ifr) => {
                const src = $(ifr).attr('src');
                if (src && !src.includes('facebook') && !src.includes('google')) {
                    streams.push({ server: 'Default', url: src.startsWith('//') ? 'https:' + src : src });
                }
            });
        }

        res.json({
            title: $('h1.entry-title').text().trim(),
            streams: streams
        });
    } catch (e) {
        res.json({ title: "Error", streams: [] });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));

module.exports = app;
