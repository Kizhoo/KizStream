'use strict';
// ============================================================
// NimeStream App.js - Full Featured
// ============================================================
const API = '/api';
let currentUser = null;
let currentView = 'home';
let navHistory = [];
let watchTimerID = null;
let watchStartTime = 0;
let currentEpisodeData = null;
let jadwalCache = null;
let jadwalDay = null;
let selectedRiwayat = new Set();
let heroSlideIndex = 0;
let heroSlideTimer = null;
let multiSelectMode = false;

// ============================================================
// INDEXEDDB
// ============================================================
const DB_NAME = 'NimeStreamDB', DB_VER = 3;
function openDB() {
  return new Promise((res, rej) => {
    const r = indexedDB.open(DB_NAME, DB_VER);
    r.onupgradeneeded = e => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains('history')) db.createObjectStore('history', { keyPath: 'episodeUrl' });
      if (!db.objectStoreNames.contains('favorites')) db.createObjectStore('favorites', { keyPath: 'url' });
    };
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}
async function dbPut(store, obj) {
  const db = await openDB();
  return new Promise((res, rej) => {
    const tx = db.transaction(store, 'readwrite');
    tx.objectStore(store).put(obj).onsuccess = e => res(e.target.result);
    tx.onerror = () => rej(tx.error);
  });
}
async function dbGet(store, key) {
  const db = await openDB();
  return new Promise((res) => {
    const tx = db.transaction(store, 'readonly');
    const req = tx.objectStore(store).get(key);
    req.onsuccess = () => res(req.result || null);
    req.onerror = () => res(null);
  });
}
async function dbGetAll(store) {
  const db = await openDB();
  return new Promise((res) => {
    const tx = db.transaction(store, 'readonly');
    const req = tx.objectStore(store).getAll();
    req.onsuccess = () => res(req.result || []);
    req.onerror = () => res([]);
  });
}
async function dbDelete(store, key) {
  const db = await openDB();
  return new Promise((res) => {
    const tx = db.transaction(store, 'readwrite');
    tx.objectStore(store).delete(key).onsuccess = () => res();
  });
}

// ============================================================
// UTILS
// ============================================================
const $ = id => document.getElementById(id);
const loader = show => show ? $('loading').classList.remove('hidden') : $('loading').classList.add('hidden');
function showToast(msg, dur = 2500) {
  const t = $('toast'); t.textContent = msg; t.classList.remove('hidden','show'); t.classList.add('show');
  clearTimeout(t._t); t._t = setTimeout(() => t.classList.add('hidden'), dur);
}
function fmtTime(secs) {
  const m = Math.floor(secs / 60), s = Math.floor(secs % 60);
  return `${m}:${s.toString().padStart(2,'0')}`;
}
function timeAgo(ts) {
  const d = Date.now() - ts, m = Math.floor(d/60000), h = Math.floor(d/3600000), day = Math.floor(d/86400000);
  if (day > 0) return `${day} hari lalu`;
  if (h > 0) return `${h} jam lalu`;
  if (m > 0) return `${m} menit lalu`;
  return 'baru saja';
}
function slugify(url) { return url.replace(/https?:\/\/[^/]+\//,'').replace(/\//g,'-').replace(/[^a-z0-9-]/gi,'').toLowerCase(); }
function formatViews(n) {
  if (!n) return '0';
  n = parseInt(n);
  if (n >= 1e6) return (n/1e6).toFixed(1)+'M';
  if (n >= 1e3) return (n/1e3).toFixed(1)+'K';
  return n.toString();
}

// ============================================================
// AUTH
// ============================================================
function handleAuthClick() {
  if (currentUser) { switchTab('settings'); return; }
  if (!window.FIREBASE_READY) { showToast('Firebase belum dikonfigurasi'); return; }
  window.fbSignIn && window.fbSignIn().then(user => {
    if (user) { currentUser = user; renderAuthBtn(); showToast('Login berhasil: '+user.displayName); }
  });
}
function renderAuthBtn() {
  const btn = $('authBtn');
  if (currentUser && currentUser.photoURL) {
    btn.innerHTML = `<img src="${currentUser.photoURL}" alt="avatar">`;
  } else {
    btn.innerHTML = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>`;
  }
}
if (window.fbAuthChange) window.fbAuthChange(user => { currentUser = user; renderAuthBtn(); });

// ============================================================
// THEME
// ============================================================
function toggleTheme() {
  const isLight = document.documentElement.hasAttribute('data-theme');
  if (isLight) { document.documentElement.removeAttribute('data-theme'); localStorage.setItem('theme','dark'); }
  else { document.documentElement.setAttribute('data-theme','light'); localStorage.setItem('theme','light'); }
}
if (localStorage.getItem('theme') === 'light') document.documentElement.setAttribute('data-theme','light');

// ============================================================
// SEARCH
// ============================================================
function toggleSearch() {
  const p = $('searchPanel');
  p.classList.toggle('hidden');
  if (!p.classList.contains('hidden')) { $('searchInput').focus(); $('searchInput').value = ''; }
}
$('searchInput').addEventListener('keypress', e => { if (e.key === 'Enter') doSearch(); });
$('searchInput').addEventListener('input', e => { if (e.target.value.length > 2) clearTimeout(e.target._t), e.target._t = setTimeout(doSearch, 500); });
async function doSearch() {
  const q = $('searchInput').value.trim();
  if (!q) return;
  loader(true);
  try {
    const data = await fetch(`${API}/search?q=${encodeURIComponent(q)}`).then(r => r.json());
    toggleSearch();
    showSearchResults(q, data);
  } catch(e) { showToast('Gagal mencari'); } finally { loader(false); }
}
function showSearchResults(q, data) {
  navHistory.push(currentView);
  currentView = 'search';
  hideAllViews();
  $('home-view').classList.remove('hidden');
  $('home-view').innerHTML = `
    <div class="section-header"><h2 class="section-title">Hasil: "${q}"</h2></div>
    <div class="anime-grid-3">${(data||[]).map(a => gridCard(a)).join('')}</div>`;
}
function gridCard(a) {
  const ep = a.episode || a.score || '';
  return `<div class="grid-card" onclick="loadDetail('${a.url}')">
    <div class="grid-card-img">
      <img src="${a.image}" alt="${a.title}" loading="lazy" onerror="this.src='data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 width=%2260%22 height=%2280%22><rect fill=%22%23222%22 width=%2260%22 height=%2280%22/></svg>'">
      ${a.score ? `<div class="grid-score">★ ${a.score}</div>` : ''}
      ${ep ? `<div class="grid-ep">Eps ${ep}</div>` : ''}
    </div>
    <div class="grid-card-title">${a.title}</div>
  </div>`;
}

// ============================================================
// NAVIGATION
// ============================================================
function hideAllViews() {
  document.querySelectorAll('.view').forEach(v => v.classList.add('hidden'));
}
function showView(id) {
  hideAllViews();
  $(id).classList.remove('hidden');
  $('bottomNav').classList.remove('hidden');
}
function switchTab(tab) {
  currentView = tab;
  navHistory = [];
  hideAllViews();
  document.querySelectorAll('.nav-item').forEach(b => b.classList.remove('active'));
  $(`tab-${tab}`) && $(`tab-${tab}`).classList.add('active');
  $('bottomNav').classList.remove('hidden');
  $('navbar').classList.remove('hidden');
  switch(tab) {
    case 'home': showView('home-view'); if (!$('home-view').innerHTML.trim()) loadHome(); break;
    case 'jadwal': showView('jadwal-view'); loadJadwal(); break;
    case 'riwayat': showView('riwayat-view'); loadRiwayat(); break;
    case 'stream': showView('stream-view'); loadFavorites(); break;
    case 'settings': showView('settings-view'); renderSettings(); break;
  }
}
function goBack() {
  if (navHistory.length) { const prev = navHistory.pop(); switchTab(prev); }
  else switchTab('home');
}
function backFromWatch() {
  stopWatchTimer();
  if (navHistory.length) {
    const prev = navHistory.pop();
    hideAllViews(); showView(`${prev}-view`);
    if (prev === 'detail') { /* detail already rendered */ }
  } else switchTab('home');
}

// ============================================================
// HOME
// ============================================================
async function loadHome() {
  const container = $('home-view');
  container.innerHTML = '<div style="padding:40px 0;text-align:center;"><div class="loading-ring" style="margin:auto"></div></div>';
  try {
    const latest = await fetch(`${API}/latest`).then(r => r.json());
    if (!latest || !latest.length) { container.innerHTML = '<div class="empty-state"><h3>Tidak ada data</h3></div>'; return; }
    let html = '';

    // Hero slider - top 5
    const top5 = latest.slice(0, 5);
    html += `<div class="hero-section">
      <div class="hero-slider-wrap" id="heroSlider">
        ${top5.map((a, i) => `
          <div class="hero-slide" onclick="loadDetail('${a.url}')">
            <img class="hero-bg" src="${a.image}" alt="${a.title}" loading="${i===0?'eager':'lazy'}">
            <div class="hero-overlay"></div>
            <div class="hero-info">
              <div class="hero-rank">#${i+1}</div>
              <div class="hero-title">${a.title}</div>
              <div class="hero-meta-row">
                <span class="hero-views"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg> ${Math.floor(Math.random()*500+50)+'.'+Math.floor(Math.random()*9)}K</span>
              </div>
              <button class="hero-play-btn" onclick="event.stopPropagation();loadDetail('${a.url}')">▶ Nonton</button>
            </div>
          </div>`).join('')}
      </div>
      <div class="hero-dots" id="heroDots">
        ${top5.map((_,i) => `<div class="hero-dot ${i===0?'active':''}" onclick="goToSlide(${i})"></div>`).join('')}
      </div>
    </div>`;

    // Ad slot
    html += `<div class="ad-slot"><ins class="adsbygoogle" style="display:block" data-ad-format="auto" data-full-width-responsive="true"></ins></div>`;

    // Recently watched
    const history = (await dbGetAll('history')).sort((a,b) => b.lastWatched - a.lastWatched).slice(0,8);
    if (history.length > 0) {
      html += `<div class="section-header"><h2 class="section-title">Terakhir Ditonton</h2><button class="see-all-btn" onclick="switchTab('riwayat')">Lihat Lainnya ›</button></div>
        <div class="h-scroll">${history.map(h => `
          <div class="h-card" onclick="loadDetail('${h.animeUrl||h.episodeUrl}')">
            <div class="h-card-img">
              <img src="${h.image||''}" alt="${h.title}" loading="lazy">
              <div class="h-card-badge">Eps ${h.episode||'?'}</div>
              <div class="h-card-prog"><div class="h-card-prog-fill" style="width:${Math.min(100,Math.round((h.watchedSecs||0)/((h.totalSecs||1420))*100))}%"></div></div>
            </div>
            <div class="h-card-title">${h.animeTitle||h.title}</div>
          </div>`).join('')}
        </div>`;
    }

    // New update anime
    html += `<div class="section-header"><h2 class="section-title">New Update Anime</h2><button class="see-all-btn" onclick="switchTab('jadwal')">Lihat Jadwal ›</button></div>
      <div class="anime-grid-3">${latest.slice(0, 12).map((a, i) => `
        <div class="grid-card" onclick="loadDetail('${a.url}')">
          <div class="grid-card-img">
            <img src="${a.image}" alt="${a.title}" loading="${i<3?'eager':'lazy'}">
            <div class="grid-badge">New</div>
            ${a.episode ? `<div class="grid-ep">Eps ${a.episode}</div>` : ''}
          </div>
          <div class="grid-card-title">${a.title}</div>
        </div>`).join('')}
      </div>`;

    container.innerHTML = html;
    startHeroSlider();

    // Try to init AdSense
    try { (adsbygoogle = window.adsbygoogle || []).push({}); } catch(e) {}
  } catch(e) {
    container.innerHTML = `<div class="empty-state"><h3>Gagal memuat</h3><p>${e.message}</p></div>`;
  }
}

function goToSlide(i) {
  const slider = $('heroSlider'); if (!slider) return;
  slider.scrollTo({ left: i * slider.offsetWidth, behavior: 'smooth' });
  document.querySelectorAll('.hero-dot').forEach((d,j) => d.classList.toggle('active', i===j));
  heroSlideIndex = i;
}
function startHeroSlider() {
  clearInterval(heroSlideTimer);
  const slider = $('heroSlider'); if (!slider) return;
  const total = slider.children.length;
  heroSlideTimer = setInterval(() => {
    heroSlideIndex = (heroSlideIndex + 1) % total;
    goToSlide(heroSlideIndex);
  }, 4000);
}

// ============================================================
// JADWAL
// ============================================================
const DAYS = ['minggu','senin','selasa','rabu','kamis','jumat','sabtu'];
const DAY_NAMES = { minggu:'Min', senin:'Sen', selasa:'Sel', rabu:'Rab', kamis:'Kam', jumat:'Jum', sabtu:'Sab' };

async function loadJadwal() {
  const today = new Date();
  jadwalDay = jadwalDay || DAYS[today.getDay()];
  renderDayStrip(today);
  if (!jadwalCache) {
    $('jadwal-content').innerHTML = '<div style="padding:30px;text-align:center;"><div class="loading-ring" style="margin:auto"></div></div>';
    try {
      jadwalCache = await fetch(`${API}/jadwal`).then(r => r.json());
    } catch(e) { $('jadwal-content').innerHTML = `<div class="empty-state"><h3>Gagal memuat jadwal</h3><p>${e.message}</p></div>`; return; }
  }
  renderJadwal(jadwalCache[jadwalDay] || []);
  updateDayNavBtns();
}
function renderDayStrip(today) {
  const strip = $('dayStrip');
  const todayDayName = DAYS[today.getDay()];
  strip.innerHTML = DAYS.map((d, i) => {
    const date = new Date(today);
    date.setDate(today.getDate() - today.getDay() + i);
    const isToday = d === todayDayName;
    const isActive = d === jadwalDay;
    return `<div class="day-pill ${isActive?'active':''}" onclick="selectDay('${d}')">
      <span class="day-name">${DAY_NAMES[d]}</span>
      <span class="day-date">${date.getDate()}</span>
      ${isToday && !isActive ? '<div class="day-dot"></div>' : ''}
    </div>`;
  }).join('');
}
function selectDay(day) { jadwalDay = day; const t = new Date(); renderDayStrip(t); renderJadwal(jadwalCache?.[day]||[]); updateDayNavBtns(); }
function updateDayNavBtns() {
  const idx = DAYS.indexOf(jadwalDay);
  $('prevDayBtn').textContent = `← ${DAY_NAMES[DAYS[(idx+6)%7]]}`;
  $('nextDayBtn').textContent = `${DAY_NAMES[DAYS[(idx+1)%7]]} →`;
}
$('prevDayBtn').onclick = () => { const i = DAYS.indexOf(jadwalDay); selectDay(DAYS[(i+6)%7]); };
$('nextDayBtn').onclick = () => { const i = DAYS.indexOf(jadwalDay); selectDay(DAYS[(i+1)%7]); };

function renderJadwal(items) {
  const now = new Date();
  if (!items || items.length === 0) {
    $('jadwal-content').innerHTML = '<div class="empty-state"><h3>Tidak ada jadwal</h3><p>Belum ada anime yang tayang hari ini</p></div>';
    return;
  }
  $('jadwal-content').innerHTML = items.map(a => {
    let statusClass = 'upcoming', statusText = 'Belum Tayang';
    if (a.time) {
      const [h,m] = a.time.split(':').map(Number);
      const aired = new Date(); aired.setHours(h,m,0,0);
      if (now > aired) { statusClass = 'aired'; statusText = 'Sudah Tayang'; }
    }
    return `<div class="jadwal-item status-${statusClass}" onclick="loadDetail('${a.url}')">
      <div class="jadwal-time">${a.time||'??:??'}</div>
      <div class="jadwal-thumb"><img src="${a.image||''}" alt="${a.title}" loading="lazy"></div>
      <div class="jadwal-info">
        <div class="jadwal-title">${a.title}</div>
        ${a.episode ? `<div class="jadwal-ep">Episode ${a.episode}</div>` : ''}
        <div class="jadwal-stats">
          ${a.views ? `<span class="jadwal-views">👁 ${a.views}</span>` : ''}
          ${a.score ? `<span class="jadwal-score">★ ${a.score}</span>` : ''}
        </div>
        <div class="jadwal-status ${statusClass}">${statusText}</div>
      </div>
    </div>`;
  }).join('');
}

// ============================================================
// RIWAYAT
// ============================================================
async function loadRiwayat() {
  const container = $('riwayat-content');
  const history = (await dbGetAll('history')).sort((a,b) => b.lastWatched - a.lastWatched);
  if (!history.length) {
    container.innerHTML = '<div class="empty-state"><svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg><h3>Belum ada riwayat</h3><p>Anime yang kamu tonton akan muncul di sini</p></div>';
    return;
  }
  // Group by date
  const grouped = {};
  history.forEach(h => {
    const d = new Date(h.lastWatched);
    const label = d.toLocaleDateString('id-ID', { day:'numeric', month:'short', year:'numeric' });
    if (!grouped[label]) grouped[label] = [];
    grouped[label].push(h);
  });
  container.innerHTML = Object.entries(grouped).map(([date, items]) => `
    <div class="riwayat-date-group">
      <div class="riwayat-date-label">${date}</div>
      ${items.map(h => {
        const pct = Math.min(100, Math.round(((h.watchedSecs||0) / (h.totalSecs||1420)) * 100));
        const sel = selectedRiwayat.has(h.episodeUrl);
        const time = new Date(h.lastWatched).toLocaleTimeString('id-ID', {hour:'2-digit',minute:'2-digit'});
        return `<div class="riwayat-item ${sel?'selected':''}" onclick="onRiwayatClick('${h.episodeUrl}')" oncontextmenu="onRiwayatLongPress('${h.episodeUrl}');return false;" data-ep="${h.episodeUrl}">
          <div class="riwayat-thumb"><img src="${h.image||''}" alt="${h.title}" loading="lazy"></div>
          <div class="riwayat-info">
            <div class="riwayat-title">${h.animeTitle||h.title}</div>
            <div class="riwayat-ep">${h.episodeTitle||('Episode '+h.episode)}</div>
            <div class="riwayat-prog-wrap">
              <div class="riwayat-prog-bar"><div class="riwayat-prog-fill" style="width:${pct}%"></div></div>
              <div class="riwayat-prog-time">${fmtTime(h.watchedSecs||0)} / ${fmtTime(h.totalSecs||1420)}</div>
            </div>
          </div>
          <div class="riwayat-watched-time">${time}</div>
        </div>`;
      }).join('')}
    </div>`).join('') + (multiSelectMode ? `
    <div class="riwayat-actions">
      <button class="riwayat-action-btn single" onclick="exitMultiSelect()">Batal</button>
      <button class="riwayat-action-btn danger" onclick="deleteSelectedRiwayat()">Hapus (${selectedRiwayat.size})</button>
    </div>` : '');

  // Long press for mobile
  let lpTimer;
  container.querySelectorAll('.riwayat-item').forEach(el => {
    el.addEventListener('touchstart', () => { lpTimer = setTimeout(() => onRiwayatLongPress(el.dataset.ep), 600); });
    el.addEventListener('touchend', () => clearTimeout(lpTimer));
    el.addEventListener('touchmove', () => clearTimeout(lpTimer));
  });
}
function onRiwayatClick(epUrl) {
  if (multiSelectMode) { selectedRiwayat.has(epUrl) ? selectedRiwayat.delete(epUrl) : selectedRiwayat.add(epUrl); loadRiwayat(); }
  else loadWatch(epUrl);
}
function onRiwayatLongPress(epUrl) {
  multiSelectMode = true; selectedRiwayat.add(epUrl);
  navigator.vibrate && navigator.vibrate(30);
  loadRiwayat();
}
function exitMultiSelect() { multiSelectMode = false; selectedRiwayat.clear(); loadRiwayat(); }
async function deleteSelectedRiwayat() {
  for (const url of selectedRiwayat) await dbDelete('history', url);
  multiSelectMode = false; selectedRiwayat.clear();
  showToast('Riwayat dihapus'); loadRiwayat();
}

// ============================================================
// FAVORITES / STREAM TAB
// ============================================================
async function loadFavorites() {
  const container = $('stream-content');
  const favs = (await dbGetAll('favorites')).sort((a,b) => b.timestamp - a.timestamp);
  if (!favs.length) {
    container.innerHTML = '<div class="empty-state"><svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78z"/></svg><h3>Belum ada favorit</h3><p>Tap ikon ♡ saat membuka detail anime</p></div>';
    return;
  }
  container.innerHTML = `<div class="anime-grid-3" style="padding:16px;">${favs.map(a => `
    <div class="grid-card" onclick="loadDetail('${a.url}')">
      <div class="grid-card-img">
        <img src="${a.image}" alt="${a.title}" loading="lazy">
        <div class="grid-score">★ ${a.score||'?'}</div>
      </div>
      <div class="grid-card-title">${a.title}</div>
    </div>`).join('')}</div>`;
}

// ============================================================
// DETAIL
// ============================================================
async function loadDetail(url) {
  navHistory.push(currentView);
  currentView = 'detail';
  hideAllViews();
  $('detail-view').classList.remove('hidden');
  $('bottomNav').classList.add('hidden');
  $('detail-content').innerHTML = '<div style="padding:50px 0;text-align:center;"><div class="loading-ring" style="margin:auto"></div></div>';
  loader(true);
  try {
    const data = await fetch(`${API}/detail?url=${encodeURIComponent(url)}`).then(r => r.json());
    const info = data.info || {};
    const score = info.skor || info.score || '?';
    const status = info.status || 'Ongoing';
    const type = info.tipe || info.type || 'TV';
    const studio = info.studio || 'NimeStream';
    const totalEps = info.total_episode || info.episode || '?';
    const duration = info.durasi || info.duration || '23 Menit';
    const genres = (info.genre || info.genres || 'Anime').split(',').map(g => g.trim()).slice(0,4);
    const episodes = data.episodes || [];
    const isFav = !!(await dbGet('favorites', url));
    const newestEp = episodes[0];
    const oldestEp = episodes[episodes.length-1];
    const watchedEps = {};
    (await dbGetAll('history')).forEach(h => { if (h.animeUrl === url) watchedEps[h.episodeUrl] = true; });

    $('detail-content').innerHTML = `
      <div class="detail-banner">
        <img src="${data.image}" alt="${data.title}" loading="eager">
        <div class="detail-banner-overlay"></div>
      </div>
      <div class="detail-main">
        <div class="detail-title">${data.title}</div>
        ${info.japanese ? `<div class="detail-alt-title">${info.japanese}</div>` : ''}
        <div class="detail-badges">
          <span class="detail-badge badge-score">★ ${score}</span>
          <span class="detail-badge badge-status">${status}</span>
          <span class="detail-badge badge-type">${type}</span>
        </div>
        <div class="detail-row">
          <div class="detail-poster"><img src="${data.image}" alt="${data.title}"></div>
          <div class="detail-info-col">
            <div class="detail-meta-item"><span class="detail-meta-label">Studio</span><span class="detail-meta-val">${studio}</span></div>
            <div class="detail-meta-item"><span class="detail-meta-label">Total Eps</span><span class="detail-meta-val">${totalEps}</span></div>
            <div class="detail-meta-item"><span class="detail-meta-label">Durasi</span><span class="detail-meta-val">${duration}</span></div>
            <div class="detail-meta-item"><span class="detail-meta-label">Genre</span><span class="detail-meta-val">${genres.join(', ')}</span></div>
          </div>
        </div>
        <div class="detail-synopsis collapsed" id="detailSynopsis">${data.description || 'Tidak ada deskripsi.'}</div>
        <button class="read-more-btn" onclick="toggleSynopsis()">Selengkapnya ▼</button>
        <div class="detail-action-row">
          ${oldestEp ? `<button class="detail-action-btn btn-primary" onclick="loadWatch('${oldestEp.url}','${encodeURIComponent(JSON.stringify({animeTitle:data.title,animeUrl:url,image:data.image,episode:getEpNum(oldestEp.title),episodeTitle:oldestEp.title}))}')">▶ Nonton</button>` : ''}
          ${newestEp ? `<button class="detail-action-btn btn-secondary" onclick="loadWatch('${newestEp.url}','${encodeURIComponent(JSON.stringify({animeTitle:data.title,animeUrl:url,image:data.image,episode:getEpNum(newestEp.title),episodeTitle:newestEp.title}))}')">▶ Terbaru (${getEpNum(newestEp.title)})</button>` : ''}
          <button class="fav-btn ${isFav?'active':''}" id="favBtn" onclick="toggleFav('${url}','${data.title.replace(/'/g,"\\'")}','${data.image}','${score}')">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78z"/></svg>
          </button>
        </div>
      </div>
      <div class="ep-section">
        <div class="ep-section-header">
          <span class="ep-section-title">Daftar Episode</span>
          ${episodes.length ? `<span class="ep-range-badge">1 - ${getEpNum(episodes[0].title)}</span>` : ''}
        </div>
        <div class="ep-grid">
          ${episodes.map(ep => {
            const n = getEpNum(ep.title);
            const watched = watchedEps[ep.url];
            return `<div class="ep-box ${watched?'watched':''}" title="${ep.title}" onclick="loadWatch('${ep.url}','${encodeURIComponent(JSON.stringify({animeTitle:data.title,animeUrl:url,image:data.image,episode:n,episodeTitle:ep.title}))}')">
              ${n}
            </div>`;
          }).join('')}
        </div>
      </div>`;
  } catch(e) {
    $('detail-content').innerHTML = `<div class="empty-state"><h3>Gagal memuat</h3><p>${e.message}</p></div>`;
  } finally { loader(false); }
}
function getEpNum(title) {
  const m = title.match(/(?:Episode|Eps?)\s*(\d+(?:\.\d+)?)/i);
  if (m) return m[1];
  const n = title.match(/\d+/g);
  return n ? n[n.length-1] : title.substring(0,10);
}
function toggleSynopsis() {
  const s = $('detailSynopsis'); if (!s) return;
  s.classList.toggle('collapsed');
  document.querySelector('.read-more-btn').textContent = s.classList.contains('collapsed') ? 'Selengkapnya ▼' : 'Lebih sedikit ▲';
}
async function toggleFav(url, title, image, score) {
  const ex = await dbGet('favorites', url);
  if (ex) { await dbDelete('favorites', url); showToast('Dihapus dari favorit'); $('favBtn').classList.remove('active'); }
  else { await dbPut('favorites', { url, title, image, score, timestamp: Date.now() }); showToast('Ditambahkan ke favorit'); $('favBtn').classList.add('active'); }
}

// ============================================================
// WATCH
// ============================================================
async function loadWatch(epUrl, metaEncoded) {
  let meta = {};
  if (metaEncoded) try { meta = JSON.parse(decodeURIComponent(metaEncoded)); } catch(e) {}
  
  navHistory.push(currentView);
  currentView = 'watch';
  hideAllViews();
  $('watch-view').classList.remove('hidden');
  $('bottomNav').classList.add('hidden');
  $('watch-content').innerHTML = '<div style="padding:50px 0;text-align:center;"><div class="loading-ring" style="margin:auto"></div></div>';
  stopWatchTimer();
  loader(true);

  try {
    const data = await fetch(`${API}/watch?url=${encodeURIComponent(epUrl)}`).then(r => r.json());
    currentEpisodeData = { ...meta, epUrl, streams: data.streams || [], title: data.title };

    // Save to history
    const histEntry = {
      episodeUrl: epUrl,
      animeUrl: meta.animeUrl || epUrl,
      animeTitle: meta.animeTitle || data.title,
      episodeTitle: meta.episodeTitle || data.title,
      episode: meta.episode || '?',
      image: meta.image || '',
      title: data.title,
      watchedSecs: 0,
      totalSecs: 1420,
      lastWatched: Date.now(),
    };
    const existing = await dbGet('history', epUrl);
    if (existing) { histEntry.watchedSecs = existing.watchedSecs; histEntry.totalSecs = existing.totalSecs; }
    await dbPut('history', histEntry);

    renderWatchScreen(data, meta, epUrl);
    startWatchTimer(epUrl);
  } catch(e) {
    $('watch-content').innerHTML = `<div class="stream-error"><p>${e.message}</p><div class="stream-error-btns"><button class="detail-action-btn btn-primary" style="flex:0;padding:10px 20px" onclick="loadWatch('${epUrl}')">🔄 Coba Lagi</button><button class="detail-action-btn btn-secondary" style="flex:0;padding:10px 20px" onclick="backFromWatch()">← Kembali</button></div></div>`;
  } finally { loader(false); }
}

function renderWatchScreen(data, meta, epUrl) {
  const streams = data.streams || [];
  const firstStream = streams[0];
  const epNum = meta.episode || getEpNum(data.title);

  $('watch-content').innerHTML = `
    <div class="player-wrap" id="playerWrap">
      ${firstStream
        ? `<iframe id="videoPlayer" src="${firstStream.url}" allowfullscreen allow="autoplay; fullscreen" scrolling="no"></iframe>`
        : `<div class="stream-error">
            <svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="#666" stroke-width="1.5"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
            <p>Stream tidak tersedia</p>
            <div class="stream-error-btns">
              <button class="detail-action-btn btn-primary" style="flex:0;padding:10px 20px" onclick="loadWatch('${epUrl}')">🔄 Coba Lagi</button>
              <button class="detail-action-btn btn-secondary" style="flex:0;padding:10px 20px" onclick="backFromWatch()">← Kembali</button>
            </div>
          </div>`}
    </div>
    <div class="watch-meta">
      <div class="watch-title">${data.title}</div>
      <div class="watch-ep-info">
        ${meta.image ? `<div class="watch-anime-link"><div class="watch-anime-thumb"><img src="${meta.image}" alt=""></div><span class="watch-anime-name">${meta.animeTitle||''}</span></div>` : ''}
        <span class="watch-ep-num">Episode ${epNum}</span>
        <span class="watch-views">👁 ${Math.floor(Math.random()*200+50)+'.'+Math.floor(Math.random()*9)}K</span>
        <span class="watch-time-ago">• ${timeAgo(Date.now() - Math.floor(Math.random()*7)*86400000)}</span>
      </div>
    </div>
    <div class="watch-actions">
      <button class="watch-action-btn" id="likeBtn" onclick="handleLike(this)">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 9V5a3 3 0 0 0-3-3l-4 9v11h11.28a2 2 0 0 0 2-1.7l1.38-9a2 2 0 0 0-2-2.3H14z"/><path d="M7 22H4a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2h3"/></svg>
        <span id="likeCount">${Math.floor(Math.random()*9+1)+'.'+Math.floor(Math.random()*9)}K</span>
      </button>
      <button class="watch-action-btn" onclick="handleDislike(this)">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10 15v4a3 3 0 0 0 3 3l4-9V2H5.72a2 2 0 0 0-2 1.7l-1.38 9a2 2 0 0 0 2 2.3H10z"/><path d="M17 2h2.67A2.31 2.31 0 0 1 22 4v7a2.31 2.31 0 0 1-2.33 2H17"/></svg>
        <span>${Math.floor(Math.random()*50)}</span>
      </button>
      <button class="watch-action-btn watch-quality-btn">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2"/></svg>
        ${streams.length > 0 ? streams[0].server.match(/\d+p/i)?.[0] || '720p' : 'N/A'}
      </button>
      <button class="watch-action-btn">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg>
        Share
      </button>
    </div>
    ${streams.length > 1 ? `
    <div class="server-section">
      <div class="server-section-label">Pilih Server:</div>
      <div class="server-list">
        ${streams.map((s,i) => `<button class="server-tag ${i===0?'active':''}" onclick="changeServer('${s.url}',this)">${s.server}</button>`).join('')}
      </div>
    </div>` : ''}
    <div class="ep-list-section" id="epListSection"></div>
    <div id="commentsSection"></div>`;

  // Load episode list from history/detail
  loadEpListForWatch(meta.animeUrl, epUrl, meta);

  // Load comments
  const epKey = slugify(epUrl);
  renderComments(epKey);
}

async function loadEpListForWatch(animeUrl, currentEpUrl, meta) {
  if (!animeUrl) return;
  try {
    const data = await fetch(`${API}/detail?url=${encodeURIComponent(animeUrl)}`).then(r => r.json());
    const eps = data.episodes || [];
    if (!eps.length) return;
    const sec = $('epListSection');
    if (!sec) return;
    sec.innerHTML = `<div class="ep-list-header"><span class="ep-list-title">Episode Lainnya</span><span class="ep-range-badge">1 - ${getEpNum(eps[0].title)}</span></div>
      <div class="ep-scroll">
        ${eps.map(ep => {
          const n = getEpNum(ep.title);
          const isCurrent = ep.url === currentEpUrl || ep.url.replace('v1.','v2.') === currentEpUrl;
          return `<div class="ep-box ${isCurrent?'current':''}" title="${ep.title}" onclick="loadWatch('${ep.url}','${encodeURIComponent(JSON.stringify({animeTitle:meta.animeTitle,animeUrl,image:meta.image,episode:n,episodeTitle:ep.title}))}')">${n}</div>`;
        }).join('')}
      </div>`;
    // Scroll to current
    const cur = sec.querySelector('.ep-box.current');
    if (cur) cur.scrollIntoView({ behavior:'smooth', block:'nearest', inline:'center' });
  } catch(e) {}
}

function changeServer(url, btn) {
  const iframe = $('videoPlayer');
  if (iframe) iframe.src = url;
  document.querySelectorAll('.server-tag').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  showToast('Server diganti');
}
function handleLike(btn) {
  btn.classList.toggle('active');
  showToast(btn.classList.contains('active') ? '👍 Disukai!' : 'Like dibatalkan');
}
function handleDislike(btn) { showToast('Dislike dicatat'); }

// ============================================================
// WATCH TIMER (progress tracking)
// ============================================================
function startWatchTimer(epUrl) {
  watchStartTime = Date.now();
  clearInterval(watchTimerID);
  watchTimerID = setInterval(async () => {
    const secs = Math.floor((Date.now() - watchStartTime) / 1000);
    const existing = await dbGet('history', epUrl);
    if (existing) {
      existing.watchedSecs = Math.min((existing.watchedSecs || 0) + 10, existing.totalSecs || 1420);
      existing.lastWatched = Date.now();
      await dbPut('history', existing);
    }
  }, 10000); // update every 10 seconds
}
function stopWatchTimer() { clearInterval(watchTimerID); watchTimerID = null; }

// ============================================================
// COMMENTS (Firebase)
// ============================================================
function renderComments(epKey) {
  const sec = $('commentsSection');
  if (!sec) return;

  sec.innerHTML = `
    <div class="comments-section">
      <div class="comments-header">
        <div class="comments-count" id="commentsCount">0 Comments</div>
        <div class="comment-tabs">
          <button class="comment-tab active" id="tabTop" onclick="setCommentTab('top',this)">Top Comment</button>
          <button class="comment-tab" id="tabNew" onclick="setCommentTab('new',this)">Terbaru</button>
        </div>
      </div>
      ${renderCommentInput(epKey)}
      <div class="comment-list" id="commentList"><div class="empty-state" style="padding:20px"><p>Belum ada komentar. Jadilah yang pertama!</p></div></div>
    </div>`;

  if (window.FIREBASE_READY && window._fb) {
    const { db, ref, onValue, query, orderByChild, limitToLast } = window._fb;
    const commentsRef = query(ref(db, `comments/${epKey}`), orderByChild('timestamp'), limitToLast(50));
    onValue(commentsRef, snap => {
      const comments = [];
      snap.forEach(child => comments.push({ id: child.key, ...child.val() }));
      comments.reverse();
      renderCommentList(comments, epKey);
    });
  }
}

function renderCommentInput(epKey) {
  if (!window.FIREBASE_READY) return `<div class="comment-login-prompt"><p>Aktifkan Firebase untuk menggunakan komentar</p></div>`;
  if (!currentUser) return `
    <div class="comment-login-prompt">
      <p>Login untuk menambahkan komentar</p>
      <button class="login-cta-btn" onclick="handleAuthClick()">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
        Login dengan Google
      </button>
    </div>`;
  return `
    <div class="comment-input-row">
      <div class="comment-avatar">${currentUser.photoURL ? `<img src="${currentUser.photoURL}" alt="">` : '😊'}</div>
      <textarea class="comment-input" id="commentInput" placeholder="Tambahkan komentar..." rows="1"></textarea>
      <button class="comment-send" onclick="submitComment('${epKey}')">Kirim</button>
    </div>`;
}

function renderCommentList(comments, epKey) {
  const list = $('commentList');
  const count = $('commentsCount');
  if (count) count.textContent = `${comments.length.toLocaleString()} Comments`;
  if (!list) return;
  if (!comments.length) { list.innerHTML = '<div class="empty-state" style="padding:20px"><p>Belum ada komentar</p></div>'; return; }
  list.innerHTML = comments.map(c => `
    <div class="comment-item">
      <div class="comment-avatar">${c.userPhoto ? `<img src="${c.userPhoto}" alt="">` : '😊'}</div>
      <div class="comment-body">
        <span class="comment-name">${c.userName||'Anonim'}</span>
        <span class="comment-time">${timeAgo(c.timestamp||Date.now())}</span>
        <div class="comment-text">${c.text||''}</div>
        <button class="comment-reply-btn">Reply</button>
      </div>
    </div>`).join('');
}

async function submitComment(epKey) {
  if (!currentUser || !window.FIREBASE_READY) { showToast('Login dulu ya!'); return; }
  const input = $('commentInput');
  const text = input ? input.value.trim() : '';
  if (!text) return;
  const { db, ref, push, serverTimestamp } = window._fb;
  try {
    await push(ref(db, `comments/${epKey}`), {
      text, userName: currentUser.displayName, userPhoto: currentUser.photoURL,
      uid: currentUser.uid, timestamp: Date.now()
    });
    if (input) input.value = '';
    showToast('Komentar terkirim!');
  } catch(e) { showToast('Gagal mengirim komentar'); }
}

function setCommentTab(tab, btn) {
  document.querySelectorAll('.comment-tab').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
}

// ============================================================
// SETTINGS
// ============================================================
function renderSettings() {
  const container = $('settings-content');
  const isLight = document.documentElement.hasAttribute('data-theme');
  container.innerHTML = `
    ${currentUser ? `
    <div class="user-profile-card">
      <div class="profile-avatar">${currentUser.photoURL ? `<img src="${currentUser.photoURL}" alt="">` : '😊'}</div>
      <div>
        <div class="profile-name">${currentUser.displayName}</div>
        <div class="profile-email">${currentUser.email}</div>
      </div>
      <button class="profile-logout-btn" onclick="handleLogout()">Logout</button>
    </div>` : `
    <div class="settings-section" style="margin-top:16px">
      <button class="login-cta-btn" style="width:calc(100% - 32px);margin:0 16px;justify-content:center;padding:14px;border-radius:12px" onclick="handleAuthClick()">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/><path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/><path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/><path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/></svg>
        Login dengan Google
      </button>
    </div>`}
    <div class="settings-list">
      <div class="settings-section">
        <div class="settings-section-title">Tampilan</div>
        <div class="settings-item" onclick="toggleTheme()">
          <div class="settings-item-left">
            <div class="settings-item-icon">🌙</div>
            <div><div class="settings-item-title">Mode Gelap</div></div>
          </div>
          <div class="toggle-switch ${!isLight?'on':''}" id="darkModeToggle"></div>
        </div>
      </div>
      <div class="settings-section" style="margin-top:12px">
        <div class="settings-section-title">Tentang</div>
        <div class="settings-item">
          <div class="settings-item-left">
            <div class="settings-item-icon">⚡</div>
            <div><div class="settings-item-title">NimeStream</div><div class="settings-item-sub">v2.0.0 — Powered by Samehadaku</div></div>
          </div>
        </div>
        <div class="settings-item" style="cursor:default">
          <div class="settings-item-left">
            <div class="settings-item-icon">🔥</div>
            <div><div class="settings-item-title">Firebase</div><div class="settings-item-sub">${window.FIREBASE_READY ? '✅ Terhubung' : '⚠️ Belum dikonfigurasi'}</div></div>
          </div>
        </div>
      </div>
      <div class="settings-section" style="margin-top:12px">
        <div class="settings-section-title">Data</div>
        <div class="settings-item" onclick="clearHistory()">
          <div class="settings-item-left">
            <div class="settings-item-icon">🗑️</div>
            <div><div class="settings-item-title">Hapus Semua Riwayat</div></div>
          </div>
          <svg class="arrow" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 18l6-6-6-6"/></svg>
        </div>
      </div>
    </div>`;
}

async function clearHistory() {
  if (!confirm('Hapus semua riwayat tontonan?')) return;
  const db = await openDB();
  const tx = db.transaction('history','readwrite');
  tx.objectStore('history').clear();
  showToast('Riwayat dihapus');
  $('home-view').innerHTML = '';
}
async function handleLogout() {
  if (window.fbSignOut) await window.fbSignOut();
  currentUser = null; renderAuthBtn(); renderSettings();
  showToast('Logout berhasil');
}

// ============================================================
// INIT
// ============================================================
document.addEventListener('DOMContentLoaded', () => {
  switchTab('home');
  if (window.fbAuthChange) window.fbAuthChange(u => { currentUser = u; renderAuthBtn(); });
});
