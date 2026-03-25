const express = require('express');
const axios = require('axios');
const cheerio = require('cheerio');
const cors = require('cors');

const app = express();
app.use(cors());

// Daftar domain Otakudesu yang paling sering aktif
const DOMAINS = ['https://otakudesu.cloud', 'https://otakudesu.best', 'https://otakudesu.cam'];

const getHeaders = () => ({
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
    'Accept-Language': 'id-ID,id;q=0.9,en-US;q=0.8',
});

// FUNGSI PENARIK HTML (Tahan Banting - Anti Cloudflare & Anti Domain Mati)
async function fetchHTML(path) {
    let cleanPath = path;
    if (path.startsWith('http')) {
        try { 
            const urlObj = new URL(path);
            cleanPath = urlObj.pathname + urlObj.search; 
        } catch (e) { }
    }

    // Coba satu per satu domain yang hidup
    for (const domain of DOMAINS) {
        const targetUrl = `${domain}${cleanPath}`;
        
        // 3 Jalur: Langsung -> Corsproxy -> AllOrigins
        const routes = [
            targetUrl, 
            `https://corsproxy.io/?${encodeURIComponent(targetUrl)}`,
            `https://api.allorigins.win/raw?url=${encodeURIComponent(targetUrl)}`
        ];

        for (const url of routes) {
            try {
                const res = await axios.get(url, { headers: getHeaders(), timeout: 8000 });
                // Validasi apakah ini HTML Otakudesu asli (bukan halaman blokir Cloudflare)
                if (res.data && (res.data.includes('venz') || res.data.includes('chivsrc') || res.data.includes('episodelist') || res.data.includes('lightsVideo'))) {
                    return cheerio.load(res.data);
                }
            } catch (e) { }
        }
    }
    return null; // Gagal total jika server Otakudesu hancur semua
}

// --- API: HALAMAN DEPAN ---
app.get('/api/latest', async (req, res) => {
    try {
        const $ = await fetchHTML('/ongoing-anime/');
        if (!$) return res.json([]);
        
        const data = [];
        $('.venz ul li').each((i, el) => {
            data.push({
                title: $(el).find('.jdlflm').text().trim(),
                url: $(el).find('a').attr('href'),
                image: $(el).find('img').attr('src'),
                episode: $(el).find('.epz').text().trim().replace('Episode ', '')
            });
        });
        res.json(data);
    } catch (e) { res.json([]); }
});

// --- API: PENCARIAN ---
app.get('/api/search', async (req, res) => {
    try {
        const query = req.query.q || '';
        const $ = await fetchHTML(`/?s=${encodeURIComponent(query)}&post_type=anime`);
        if (!$) return res.json([]);

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
    } catch (e) { res.json([]); }
});

// --- API: DETAIL ---
app.get('/api/detail', async (req, res) => {
    try {
        if (!req.query.url) return res.json({});
        const $ = await fetchHTML(req.query.url);
        if (!$) return res.json({});
        
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
    } catch (e) { res.json({}); }
});

// --- API: NONTON VIDEO ---
app.get('/api/watch', async (req, res) => {
    try {
        if (!req.query.url) return res.json({ title: "Error", streams: [] });
        const $ = await fetchHTML(req.query.url);
        if (!$) return res.json({ title: "Error", streams: [] });
        
        const streams = [];

        // 1. Server Utama
        const defaultIframe = $('#lightsVideo iframe').attr('src') || $('.responsive-embed-iframe iframe').attr('src');
        if (defaultIframe) streams.push({ server: 'Server Utama', url: defaultIframe });

        // 2. Server Mirror (Base64 Decode)
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

        res.json({ title: $('.venutama h1').text().trim() || 'Video Player', streams: streams });
    } catch (e) { res.json({ title: "Error", streams: [] }); }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server aktif di port ${PORT}`));
module.exports = app;
