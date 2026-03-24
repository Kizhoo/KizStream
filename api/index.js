const express = require('express');
const axios = require('axios');
const cheerio = require('cheerio');
const cors = require('cors');

const app = express();
app.use(cors());

const BASE_URL = 'https://v1.samehadaku.how';
const PROXY = 'https://cors.caliph.my.id/';

// Header yang meniru browser asli secara akurat
const getHeaders = (referer = BASE_URL) => ({
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
    'Accept': '*/*',
    'Accept-Language': 'id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7',
    'Referer': referer,
    'Origin': BASE_URL,
    'X-Requested-With': 'XMLHttpRequest'
});

async function animeterbaru(page = 1) {
    try {
        const res = await axios.get(`${PROXY}${BASE_URL}/anime-terbaru/page/${page}/`, { headers: getHeaders() });
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
        const res = await axios.get(`${PROXY}${BASE_URL}/?s=${encodeURIComponent(query)}`, { headers: getHeaders() });
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
        const res = await axios.get(`${PROXY}${targetUrl}`, { headers: getHeaders() });
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
        const res = await axios.get(`${PROXY}${targetUrl}`, { headers: getHeaders(targetUrl) });
        const $ = cheerio.load(res.data);
        const data = [];
        const serverElements = $('div#server > ul > li');

        for (const li of serverElements.toArray()) {
            const div = $(li).find('div');
            const post = div.attr('data-post');
            const nume = div.attr('data-nume');
            const type = div.attr('data-type');
            const name = $(li).find('span').text().trim();

            if (!post || !nume) continue;

            const params = new URLSearchParams();
            params.append('action', 'player_ajax');
            params.append('post', post);
            params.append('nume', nume);
            params.append('type', type);

            try {
                const response = await axios.post(`${PROXY}${BASE_URL}/wp-admin/admin-ajax.php`, params.toString(), {
                    headers: {
                        ...getHeaders(targetUrl),
                        'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8'
                    }
                });

                const $$ = cheerio.load(response.data);
                let src = $$('iframe').attr('src') || $$('source').attr('src');
                
                if (src) {
                    if (src.startsWith('//')) src = 'https:' + src;
                    data.push({ server: name || `Server ${nume}`, url: src });
                }
            } catch (err) {
                console.log(`Gagal mengambil server: ${name}`);
            }
        }
        return { title: $('h1.entry-title').text().trim(), streams: data };
    } catch (e) {
        return { title: "Error", streams: [] };
    }
}

app.get('/api/latest', async (req, res) => res.json(await animeterbaru(req.query.page)));
app.get('/api/search', async (req, res) => res.json(await search(req.query.q)));
app.get('/api/detail', async (req, res) => res.json(await detail(req.query.url)));
app.get('/api/watch', async (req, res) => res.json(await download(req.query.url)));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server aktif di port ${PORT}`));

module.exports = app;
