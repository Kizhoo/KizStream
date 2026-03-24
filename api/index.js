const express = require('express');
const axios = require('axios');
const cheerio = require('cheerio');
const cors = require('cors');

const app = express();
app.use(cors());

const BASE_URL = 'https://v1.samehadaku.how';
const PROXY = 'https://cors.caliph.my.id/';

// Konfigurasi Header untuk meniru browser asli
const commonHeaders = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
    'Accept-Language': 'id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7',
    'Cache-Control': 'no-cache',
    'Pragma': 'no-cache'
};

async function animeterbaru(page = 1) {
    try {
        const res = await axios.get(`${PROXY}${BASE_URL}/anime-terbaru/page/${page}/`, { headers: commonHeaders });
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
        const res = await axios.get(`${PROXY}${BASE_URL}/?s=${encodeURIComponent(query)}`, { headers: commonHeaders });
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
        const res = await axios.get(`${PROXY}${targetUrl}`, { headers: commonHeaders });
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
            title: $('h1.entry-title').text().trim(),
            image: $('meta[property="og:image"]').attr('content'),
            description: $('.entry-content p').first().text().trim(),
            episodes,
            info
        };
    } catch (e) { throw e; }
}

async function download(link) {
    try {
        const targetUrl = link.startsWith('http') ? link : `${BASE_URL}${link}`;
        const res = await axios.get(`${PROXY}${targetUrl}`, { headers: commonHeaders });
        const $ = cheerio.load(res.data);
        const streams = [];

        // Ambil elemen server
        const servers = $('#server ul li div');
        
        for (let i = 0; i < servers.length; i++) {
            const el = $(servers[i]);
            const post = el.attr('data-post');
            const nume = el.attr('data-nume');
            const type = el.attr('data-type');
            const serverName = el.parent().find('span').text().trim();

            if (post && nume && type) {
                try {
                    const formData = new URLSearchParams();
                    formData.append('action', 'player_ajax');
                    formData.append('post', post);
                    formData.append('nume', nume);
                    formData.append('type', type);

                    const ajaxRes = await axios.post(`${PROXY}${BASE_URL}/wp-admin/admin-ajax.php`, formData.toString(), {
                        headers: {
                            ...commonHeaders,
                            'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
                            'X-Requested-With': 'XMLHttpRequest',
                            'Referer': targetUrl
                        }
                    });

                    const $$ = cheerio.load(ajaxRes.data);
                    let videoUrl = $$('iframe').attr('src') || $$('source').attr('src');

                    if (videoUrl) {
                        if (videoUrl.startsWith('//')) videoUrl = 'https:' + videoUrl;
                        streams.push({ server: serverName || `Server ${nume}`, url: videoUrl });
                    }
                } catch (ajaxErr) {
                    console.error(`Gagal ambil server ${serverName}`);
                }
            }
        }

        return {
            title: $('h1.entry-title').text().trim() || "Video Player",
            streams: streams
        };
    } catch (e) {
        return { title: "Error", streams: [] };
    }
}

app.get('/api/latest', async (req, res) => res.json(await animeterbaru(req.query.page)));
app.get('/api/search', async (req, res) => res.json(await search(req.query.q)));
app.get('/api/detail', async (req, res) => res.json(await detail(req.query.url)));
app.get('/api/watch', async (req, res) => res.json(await download(req.query.url)));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));

module.exports = app;
