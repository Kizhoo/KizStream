const express = require('express');
const axios = require('axios');
const cheerio = require('cheerio');
const cors = require('cors');

const app = express();
app.use(cors());

// Kita ganti target ke Otakudesu yang jauh lebih ramah server/scraper
const BASE_URL = 'https://otakudesu.cloud';

const getHeaders = () => ({
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
    'Accept-Language': 'id-ID,id;q=0.9,en-US;q=0.8',
    'Referer': BASE_URL,
    'Origin': BASE_URL
});

app.get('/api/latest', async (req, res) => {
    try {
        const response = await axios.get(`${BASE_URL}/ongoing-anime/`, { headers: getHeaders() });
        const $ = cheerio.load(response.data);
        const data = [];
        $('.venz ul li').each((i, el) => {
            data.push({
                title: $(el).find('.jdlflm').text().trim(),
                url: $(el).find('a').attr('href'),
                image: $(el).find('img').attr('src'),
                episode: $(el).find('.epz').text().trim().replace('Episode ', ''),
            });
        });
        res.json(data);
    } catch (e) { res.status(500).json([]); }
});

app.get('/api/search', async (req, res) => {
    try {
        const query = req.query.q;
        const response = await axios.get(`${BASE_URL}/?s=${encodeURIComponent(query)}&post_type=anime`, { headers: getHeaders() });
        const $ = cheerio.load(response.data);
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
        res.json(data);
    } catch (e) { res.status(500).json([]); }
});

app.get('/api/detail', async (req, res) => {
    try {
        const targetUrl = req.query.url.startsWith('http') ? req.query.url : `${BASE_URL}${req.query.url}`;
        const response = await axios.get(targetUrl, { headers: getHeaders() });
        const $ = cheerio.load(response.data);
        
        const episodes = [];
        // Mengambil daftar episode (Otakudesu biasanya menaruh episode terbaru di atas)
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
        
        res.json({
            title: $('.infozin h1').text().trim().replace(' Subtitle Indonesia', '') || $('title').text().trim(),
            image: $('.fotoanime img').attr('src'),
            description: $('.sinopc p').text().trim() || 'Tidak ada sinopsis',
            episodes: episodes,
            info: info
        });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/watch', async (req, res) => {
    try {
        const targetUrl = req.query.url.startsWith('http') ? req.query.url : `${BASE_URL}${req.query.url}`;
        const response = await axios.get(targetUrl, { headers: getHeaders() });
        const $ = cheerio.load(response.data);
        const streams = [];

        // 1. Ambil server utama (Iframe default yang langsung tampil)
        const defaultIframe = $('#lightsVideo iframe').attr('src') || $('.responsive-embed-iframe iframe').attr('src');
        if (defaultIframe) {
            streams.push({ server: 'Server Utama', url: defaultIframe });
        }

        // 2. Ekstrak server mirror lainnya (Biasanya Otakudesu menyembunyikannya di Base64)
        $('.mirrorstream ul li a').each((i, el) => {
            const serverName = $(el).text().trim();
            const dataContent = $(el).attr('data-content');
            if (dataContent) {
                try {
                    // Decode Base64 ke HTML string
                    const decodedHtml = Buffer.from(dataContent, 'base64').toString('utf8');
                    const iframeUrl = cheerio.load(decodedHtml)('iframe').attr('src');
                    if (iframeUrl && !streams.some(s => s.url === iframeUrl)) {
                        streams.push({ server: serverName, url: iframeUrl });
                    }
                } catch (decodeErr) { }
            }
        });

        res.json({
            title: $('.venutama h1').text().trim() || 'Video Player',
            streams: streams
        });
    } catch (e) { res.status(500).json({ title: "Error", streams: [] }); }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server aktif di port ${PORT}`));

module.exports = app;
