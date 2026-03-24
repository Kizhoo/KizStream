const express = require('express');
const axios = require('axios');
const cheerio = require('cheerio');
const cors = require('cors');

const app = express();
app.use(cors());

// Target Otakudesu
const BASE_URL = 'https://otakudesu.cloud';

// Header murni tanpa proxy
const getHeaders = () => ({
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
    'Accept-Language': 'id-ID,id;q=0.9,en-US;q=0.8'
});

// --- API: HALAMAN DEPAN ---
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
    } catch (e) { 
        console.error("Error Latest:", e.message);
        res.json([]); // Jangan gunakan status 500 agar frontend tidak panik
    }
});

// --- API: PENCARIAN & KATEGORI ---
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
    } catch (e) { 
        console.error("Error Search:", e.message);
        res.json([]); 
    }
});

// --- API: DETAIL ANIME ---
app.get('/api/detail', async (req, res) => {
    try {
        const targetUrl = req.query.url.startsWith('http') ? req.query.url : `${BASE_URL}${req.query.url}`;
        const response = await axios.get(targetUrl, { headers: getHeaders() });
        const $ = cheerio.load(response.data);
        
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
        
        res.json({
            title: $('.infozin h1').text().trim().replace(' Subtitle Indonesia', '') || $('title').text().trim(),
            image: $('.fotoanime img').attr('src'),
            description: $('.sinopc p').text().trim() || 'Tidak ada sinopsis',
            episodes: episodes,
            info: info
        });
    } catch (e) { 
        console.error("Error Detail:", e.message);
        res.json({ error: e.message }); 
    }
});

// --- API: NONTON VIDEO ---
app.get('/api/watch', async (req, res) => {
    try {
        const targetUrl = req.query.url.startsWith('http') ? req.query.url : `${BASE_URL}${req.query.url}`;
        const response = await axios.get(targetUrl, { headers: getHeaders() });
        const $ = cheerio.load(response.data);
        const streams = [];

        // Server Utama
        const defaultIframe = $('#lightsVideo iframe').attr('src') || $('.responsive-embed-iframe iframe').attr('src');
        if (defaultIframe) {
            streams.push({ server: 'Server Utama', url: defaultIframe });
        }

        // Server Mirror (Base64 Decode)
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

        res.json({
            title: $('.venutama h1').text().trim() || 'Video Player',
            streams: streams
        });
    } catch (e) { 
        console.error("Error Watch:", e.message);
        res.json({ title: "Error", streams: [] }); 
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server aktif di port ${PORT}`));

module.exports = app;
