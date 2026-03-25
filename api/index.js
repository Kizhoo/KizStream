const express = require('express');
const axios = require('axios');
const cheerio = require('cheerio');
const cors = require('cors');

const app = express();
app.use(cors());

// --- KONFIGURASI ---
const BASE_URL = 'https://otakudesu.blog';
// Menggunakan AllOrigins Proxy untuk menyembunyikan IP Vercel dari sistem anti-bot Otakudesu
const PROXY = 'https://api.allorigins.win/raw?url=';

async function fetchHTML(path) {
    const targetUrl = path.startsWith('http') ? path : `${BASE_URL}${path}`;
    const finalUrl = `${PROXY}${encodeURIComponent(targetUrl)}`;
    
    const res = await axios.get(finalUrl, {
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
        timeout: 10000
    });
    return cheerio.load(res.data);
}

// --- API: HALAMAN DEPAN ---
app.get('/api/latest', async (req, res) => {
    try {
        const $ = await fetchHTML('/ongoing-anime/');
        const data = [];
        $('.venz ul li').each((i, el) => {
            data.push({
                title: $(el).find('.jdlflm').text().trim(),
                url: $(el).find('a').attr('href'),
                image: $(el).find('img').attr('src'),
                episode: $(el).find('.epz').text().trim().replace('Episode ', '')
            });
        });
        res.status(200).json(data);
    } catch (e) { res.status(200).json([]); }
});

// --- API: PENCARIAN ---
app.get('/api/search', async (req, res) => {
    try {
        const query = req.query.q || '';
        const $ = await fetchHTML(`/?s=${encodeURIComponent(query)}&post_type=anime`);
        const data = [];
        $('.chivsrc li').each((i, el) => {
            data.push({
                title: $(el).find('h2 a').text().trim(),
                url: $(el).find('h2 a').attr('href'),
                image: $(el).find('img').attr('src'),
                type: $(el).find('.set').first().text().replace('Status : ', '').trim(),
                score: $(el).find('.set').last().text().replace('Rating : ', '').trim() || 'N/A'
            });
        });
        res.status(200).json(data);
    } catch (e) { res.status(200).json([]); }
});

// --- API: DETAIL ---
app.get('/api/detail', async (req, res) => {
    try {
        if (!req.query.url) return res.status(200).json({});
        const $ = await fetchHTML(req.query.url);
        
        const episodes = [];
        $('.episodelist ul li').each((i, el) => {
            episodes.push({
                title: $(el).find('a').text().trim(),
                url: $(el).find('a').attr('href'),
                date: $(el).find('.zeebr').text().trim()
            });
        });
        
        const info = {};
        $('.infozingle p').each((i, el) => {
            const text = $(el).text();
            if (text.includes(':')) {
                const [k, v] = text.split(':');
                info[k.trim().toLowerCase().replace(/\s+/g, '_')] = v.trim();
            }
        });
        
        res.status(200).json({
            title: $('.infozin h1').text().trim().replace(' Subtitle Indonesia', '') || $('title').text().trim(),
            image: $('.fotoanime img').attr('src'),
            description: $('.sinopc p').text().trim() || 'Tidak ada sinopsis',
            episodes: episodes,
            info: info
        });
    } catch (e) { res.status(200).json({}); }
});

// --- API: NONTON VIDEO ---
app.get('/api/watch', async (req, res) => {
    try {
        if (!req.query.url) return res.status(200).json({ title: "Error", streams: [] });
        const $ = await fetchHTML(req.query.url);
        const streams = [];

        // 1. Server Utama
        const defaultIframe = $('#lightsVideo iframe').attr('src') || $('.responsive-embed-iframe iframe').attr('src');
        if (defaultIframe) {
            streams.push({ server: 'Server Utama', url: defaultIframe });
        }

        // 2. Server Mirror
        $('.mirrorstream ul li a').each((i, el) => {
            const serverName = $(el).text().trim();
            const dataContent = $(el).attr('data-content');
            if (dataContent) {
                try {
                    const decoded = Buffer.from(dataContent, 'base64').toString('utf8');
                    let iframeUrl = cheerio.load(decoded)('iframe').attr('src');
                    if (iframeUrl && !streams.some(s => s.url === iframeUrl)) {
                        streams.push({ server: serverName, url: iframeUrl });
                    }
                } catch (e) {}
            }
        });

        // 3. Fallback
        if (streams.length === 0) {
            $('iframe').each((i, el) => {
                let src = $(el).attr('src');
                if (src && (src.includes('player') || src.includes('embed') || src.includes('desu'))) {
                    if (src.startsWith('//')) src = 'https:' + src;
                    streams.push({ server: `Server Cadangan ${streams.length + 1}`, url: src });
                }
            });
        }

        res.status(200).json({
            title: $('.venutama h1').text().trim() || 'Video Player',
            streams: streams
        });
    } catch (e) { res.status(200).json({ title: "Error", streams: [] }); }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server aktif di port ${PORT}`));

module.exports = app;
