const CACHE_NAME = 'nimestream-v2'; // <--- NAIK VERSI UNTUK MENGHANCURKAN CACHE LAMA
const ASSETS_TO_CACHE = [
    './',
    './index.html',
    './style.css',
    './app.js',
    'https://fonts.googleapis.com/css2?family=Outfit:wght@300;500;700&display=swap'
];

self.addEventListener('install', (event) => {
    self.skipWaiting(); // Paksa browser langsung menggunakan Service Worker versi baru ini
    event.waitUntil(
        caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS_TO_CACHE))
    );
});

self.addEventListener('activate', (event) => {
    event.waitUntil(self.clients.claim());
    // Sistem pembersih: Hapus semua cache versi sebelumnya yang menyebabkan Error / Layar Hitam
    event.waitUntil(
        caches.keys().then((cacheNames) => {
            return Promise.all(
                cacheNames.map((cache) => {
                    if (cache !== CACHE_NAME) {
                        return caches.delete(cache);
                    }
                })
            );
        })
    );
});

self.addEventListener('fetch', (event) => {
    event.respondWith(
        fetch(event.request).catch(() => caches.match(event.request))
    );
});
