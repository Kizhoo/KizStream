const express = require('express');
const axios = require('axios');
const cheerio = require('cheerio');
const cors = require('cors');

const app = express();
app.use(cors());

const BASE_URL = 'https://v1.samehadaku.how';

// Kita ganti proxy ke Codetabs (lebih tangguh dari Caliph)
const PROXY = 'https://api.codetabs.com/v1/proxy/?quest=';

const getHeaders = (customReferer = BASE_URL) => ({
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
    'Accept-Language': 'id-ID,id;q=0.9,en-US;q=0.8',
    'Referer': customReferer,
    'Origin': BASE_URL
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
        $('.spe span').each((_, e) => {
            const t = $(e).text();
            if (t.includes(':')) {
                const [k, v] = t.split(':');
                info[k.trim().toLowerCase().replace(/\s+/g, '_')] = v.trim();
            }
        });
        
        return {
            title: $('h1.entry-title').text().trim() || $('title').text().trim(),
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
        const pageRes = await axios.get(`${PROXY}${targetUrl}`, { headers: getHeaders(BASE_URL) });
        
        const $ = cheerio.load(pageRes.data);
        const streams = [];
        const servers = $('div#server ul li div, .server ul li div');

        for (let i = 0; i < servers.length; i++) {
            const el = $(servers[i]);
            const post = el.attr('data-post');
            const nume = el.attr('data-nume');
            const type = el.attr('data-type');
            const serverName = el.find('span').text().trim() || el.parent().find('span').text().trim() || `Server ${nume}`;

            if (post && nume) {
                try {
                    const formData = new URLSearchParams();
                    formData.append('action', 'player_ajax');
                    formData.append('post', post);
                    formData.append('nume', nume);
                    formData.append('type', type);

                    const ajaxRes = await axios.post(`${PROXY}${BASE_URL}/wp-admin/admin-ajax.php`, formData.toString(), {
                        headers: {
                            ...getHeaders(targetUrl),
                            'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
                            'X-Requested-With': 'XMLHttpRequest'
                        }
                    });

                    const $$ = cheerio.load(ajaxRes.data);
                    let videoUrl = $$('iframe').attr('src') || $$('source').attr('src');

                    if (videoUrl) {
                        if (videoUrl.startsWith('//')) videoUrl = 'https:' + videoUrl;
                        streams.push({ server: serverName, url: videoUrl });
                    }
                } catch (ajaxErr) { 
                    // Kita log error spesifiknya agar tahu apakah masih diblokir
                    console.error(`Gagal server ${serverName}:`, ajaxErr.response ? ajaxErr.response.status : ajaxErr.message);
                }
            }
        }

        // Fallback: Cari link video di HTML awal jika AJAX mati total
        if (streams.length === 0) {
            const directIframe = $('.entry-content iframe').attr('src') || $('iframe[src*="player"], iframe[src*="embed"]').attr('src');
            if (directIframe) streams.push({ server: 'Server Utama', url: directIframe });
        }

        return { title: $('h1.entry-title').text().trim(), streams };
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
