'use strict';
/* ============================================================
   NimeStream — app.js v10
   Fixes: IDB key error, history undefined, score ?, synopsis,
          jadwal, Supabase auth (email+password), more genres
   ============================================================ */

// ── SUPABASE CONFIG ──────────────────────────────────────────
// Ganti dengan URL dan anon key project Supabase kamu
// Supabase Dashboard → Settings → API
const SB_URL  = 'https://panhgnyfszfxoaiuavzz.supabase.co';      // https://xxx.supabase.co
const SB_KEY  = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBhbmhnbnlmc3pmeG9haXVhdnp6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ1MTg0MzgsImV4cCI6MjA5MDA5NDQzOH0.NDtyR4VsjbVgPqcYl_CtG20PP-Onm1Qg_DjsTN-Xv3U'; // eyJhbGci...
const SB_READY = SB_URL !== 'https://panhgnyfszfxoaiuavzz.supabase.co';
let sb = null;
if (SB_READY && window.supabase) sb = window.supabase.createClient(SB_URL, SB_KEY);

// ── CONSTANTS ─────────────────────────────────────────────────
const API   = '/api';
const DAYS  = ['minggu','senin','selasa','rabu','kamis','jumat','sabtu'];
const DNAMES = ['Min','Sen','Sel','Rab','Kam','Jum','Sab'];
const HOME_GENRES = [
  { label:'Action',    q:'action bleach jujutsu kimetsu' },
  { label:'Romance',   q:'love romance kanojo' },
  { label:'Isekai',    q:'isekai tensei reincarnation' },
  { label:'Comedy',    q:'comedy slice bocchi' },
  { label:'Fantasy',   q:'fantasy magic mahou' },
  { label:'School',    q:'school gakuen classroom' },
];

// ── STATE ─────────────────────────────────────────────────────
let currentUser  = null;
let currentView  = 'home';
let navHistory   = [];
let jadwalCache  = null;
let jadwalDay    = null;
let heroIdx      = 0, heroTimer = null;
let selectedRiw  = new Set();
let multiSelect  = false;
let watchTimer   = null;
let currentEpUrl = null;

// ── INDEXEDDB (offline fallback) ─────────────────────────────
function openDB() {
  return new Promise((res, rej) => {
    const r = indexedDB.open('NimeStreamDB', 4);
    r.onupgradeneeded = e => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains('history'))   db.createObjectStore('history',   { keyPath: 'episodeUrl' });
      if (!db.objectStoreNames.contains('favorites')) db.createObjectStore('favorites', { keyPath: 'url' });
    };
    r.onsuccess = () => res(r.result);
    r.onerror   = () => rej(r.error);
  });
}
async function idbPut(store, obj) {
  const db = await openDB();
  return new Promise((res,rej) => { const tx = db.transaction(store,'readwrite'); const req = tx.objectStore(store).put(obj); req.onsuccess = ()=>res(); req.onerror = ()=>rej(req.error); });
}
async function idbGet(store, key) {
  const db = await openDB();
  return new Promise(res => { const r = db.transaction(store,'readonly').objectStore(store).get(key); r.onsuccess=()=>res(r.result||null); r.onerror=()=>res(null); });
}
async function idbAll(store) {
  const db = await openDB();
  return new Promise(res => { const r = db.transaction(store,'readonly').objectStore(store).getAll(); r.onsuccess=()=>res(r.result||[]); r.onerror=()=>res([]); });
}
async function idbDel(store, key) {
  const db = await openDB();
  return new Promise(res => { db.transaction(store,'readwrite').objectStore(store).delete(key).onsuccess=()=>res(); });
}
async function idbClear(store) {
  const db = await openDB();
  return new Promise(res => { db.transaction(store,'readwrite').objectStore(store).clear().onsuccess=()=>res(); });
}

// ── DATA LAYER (Supabase when logged in, IDB fallback) ────────
async function saveHistory(entry) {
  if (!entry.episodeUrl) return;  // FIX: guard against missing key
  entry.lastWatched = entry.lastWatched || Date.now();
  entry.totalSecs   = entry.totalSecs   || 1420;
  entry.watchedSecs = entry.watchedSecs || 0;
  await idbPut('history', entry);
  if (sb && currentUser) {
    await sb.from('watch_history').upsert({
      user_id: currentUser.id,
      episode_url: entry.episodeUrl,
      anime_url: entry.animeUrl || '',
      anime_title: entry.animeTitle || '',
      episode_title: entry.episodeTitle || '',
      episode_num: String(entry.episode || ''),
      image_url: entry.image || '',
      watched_secs: entry.watchedSecs,
      total_secs: entry.totalSecs,
      last_watched: new Date(entry.lastWatched).toISOString(),
    }, { onConflict: 'user_id,episode_url' });
  }
}
async function getHistory() {
  if (sb && currentUser) {
    const { data } = await sb.from('watch_history').select('*').eq('user_id', currentUser.id).order('last_watched', { ascending: false }).limit(200);
    if (data && data.length) {
      return data.map(r => ({
        episodeUrl: r.episode_url, animeUrl: r.anime_url, animeTitle: r.anime_title,
        episodeTitle: r.episode_title, episode: r.episode_num, image: r.image_url,
        watchedSecs: r.watched_secs, totalSecs: r.total_secs, lastWatched: new Date(r.last_watched).getTime()
      }));
    }
  }
  return (await idbAll('history')).sort((a,b) => (b.lastWatched||0) - (a.lastWatched||0));
}
async function deleteHistory(epUrl) {
  await idbDel('history', epUrl);
  if (sb && currentUser) await sb.from('watch_history').delete().eq('user_id', currentUser.id).eq('episode_url', epUrl);
}
async function saveFav(obj) {
  await idbPut('favorites', { ...obj, timestamp: Date.now() });
  if (sb && currentUser) await sb.from('favorites').upsert({ user_id: currentUser.id, anime_url: obj.url, title: obj.title, image_url: obj.image, score: String(obj.score||'') }, { onConflict: 'user_id,anime_url' });
}
async function delFav(url) {
  await idbDel('favorites', url);
  if (sb && currentUser) await sb.from('favorites').delete().eq('user_id', currentUser.id).eq('anime_url', url);
}
async function getFav(url) {
  if (sb && currentUser) { const { data } = await sb.from('favorites').select('id').eq('user_id', currentUser.id).eq('anime_url', url).maybeSingle(); return !!data; }
  return !!(await idbGet('favorites', url));
}
async function getAllFavs() {
  if (sb && currentUser) {
    const { data } = await sb.from('favorites').select('*').eq('user_id', currentUser.id).order('created_at', { ascending: false });
    if (data) return data.map(r => ({ url: r.anime_url, title: r.title, image: r.image_url, score: r.score }));
  }
  return (await idbAll('favorites')).sort((a,b) => (b.timestamp||0) - (a.timestamp||0));
}

// ── AUTH ──────────────────────────────────────────────────────
function handleAuthClick() {
  if (currentUser) { switchTab('settings'); return; }
  showLoginModal();
}

function showLoginModal() {
  const m = document.createElement('div');
  m.id = 'loginModal';
  m.className = 'modal-overlay';
  m.innerHTML = `
    <div class="modal-box">
      <button class="modal-close" onclick="closeModal()">✕</button>
      <div class="modal-logo">⚡ NimeStream</div>
      <div class="modal-tabs">
        <button class="modal-tab active" id="tabLogin" onclick="switchModalTab('login')">Login</button>
        <button class="modal-tab" id="tabRegister" onclick="switchModalTab('register')">Daftar</button>
      </div>
      <div id="modalLoginForm">
        <div class="form-group">
          <label>Email</label>
          <input type="email" id="loginEmail" placeholder="nama@email.com" autocomplete="email">
        </div>
        <div class="form-group">
          <label>Password</label>
          <input type="password" id="loginPass" placeholder="Password" autocomplete="current-password">
          <div class="form-err hidden" id="loginErr"></div>
        </div>
        <button class="form-submit" onclick="doLogin()">Masuk</button>
      </div>
      <div id="modalRegisterForm" class="hidden">
        <p class="register-info">Daftar akun baru melalui Bot Telegram kami:</p>
        <a href="https://t.me/NimeStreamBot" target="_blank" class="tg-btn">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm4.64 6.8l-1.69 7.97c-.12.56-.46.7-.93.43l-2.57-1.89-1.24 1.19c-.14.14-.25.25-.51.25l.18-2.58 4.67-4.22c.2-.18-.04-.28-.32-.1L7.6 14.24l-2.52-.78c-.55-.17-.56-.55.12-.81l9.85-3.8c.46-.17.86.11.7.95z"/></svg>
          Buka @NimeStreamBot di Telegram
        </a>
        <p class="register-sub">Ketik <b>/daftar</b> di bot, ikuti langkah-langkahnya, lalu login di sini.</p>
      </div>
    </div>`;
  document.body.appendChild(m);
  m.addEventListener('click', e => { if (e.target === m) closeModal(); });
}

function switchModalTab(tab) {
  document.getElementById('tabLogin').classList.toggle('active', tab==='login');
  document.getElementById('tabRegister').classList.toggle('active', tab==='register');
  document.getElementById('modalLoginForm').classList.toggle('hidden', tab!=='login');
  document.getElementById('modalRegisterForm').classList.toggle('hidden', tab!=='register');
}

async function doLogin() {
  if (!SB_READY || !sb) { showToast('Supabase belum dikonfigurasi di app.js'); return; }
  const email = document.getElementById('loginEmail')?.value.trim();
  const pass  = document.getElementById('loginPass')?.value;
  const errEl = document.getElementById('loginErr');
  if (!email || !pass) { if (errEl) { errEl.textContent = 'Isi email dan password'; errEl.classList.remove('hidden'); } return; }
  const btn = document.querySelector('.form-submit');
  if (btn) { btn.textContent = 'Memuat...'; btn.disabled = true; }
  const { data, error } = await sb.auth.signInWithPassword({ email, password: pass });
  if (btn) { btn.textContent = 'Masuk'; btn.disabled = false; }
  if (error) { if (errEl) { errEl.textContent = error.message === 'Invalid login credentials' ? 'Email atau password salah' : error.message; errEl.classList.remove('hidden'); } return; }
  currentUser = data.user;
  closeModal();
  renderAuthBtn();
  showToast('Login berhasil!');
  // Reload current view to show personalized data
  if (currentView === 'home') { document.getElementById('home-view').innerHTML=''; loadHome(); }
}

function closeModal() { const m = document.getElementById('loginModal'); if (m) m.remove(); }

function renderAuthBtn() {
  const btn = document.getElementById('authBtn');
  if (!btn) return;
  if (currentUser?.user_metadata?.avatar_url) {
    btn.innerHTML = `<img src="${currentUser.user_metadata.avatar_url}" alt="avatar" style="width:100%;height:100%;object-fit:cover;border-radius:50%">`;
  } else if (currentUser) {
    const initials = (currentUser.email || 'U').charAt(0).toUpperCase();
    btn.innerHTML = `<span style="font-size:14px;font-weight:800;color:var(--accent)">${initials}</span>`;
  } else {
    btn.innerHTML = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>`;
  }
}

// Init auth state
if (SB_READY && sb) {
  sb.auth.getSession().then(({ data: { session } }) => { if (session) { currentUser = session.user; renderAuthBtn(); } });
  sb.auth.onAuthStateChange((_e, session) => { currentUser = session?.user || null; renderAuthBtn(); });
}

// ── THEME ─────────────────────────────────────────────────────
function toggleTheme() {
  const isLight = document.documentElement.hasAttribute('data-theme');
  if (isLight) { document.documentElement.removeAttribute('data-theme'); localStorage.setItem('theme','dark'); }
  else { document.documentElement.setAttribute('data-theme','light'); localStorage.setItem('theme','light'); }
}
if (localStorage.getItem('theme') === 'light') document.documentElement.setAttribute('data-theme','light');

// ── SEARCH ────────────────────────────────────────────────────
function toggleSearch() {
  const p = document.getElementById('searchPanel');
  p.classList.toggle('hidden');
  if (!p.classList.contains('hidden')) { const inp = document.getElementById('searchInput'); inp.value=''; inp.focus(); }
}
document.getElementById('searchInput').addEventListener('keypress', e => { if (e.key==='Enter') doSearch(); });
document.getElementById('searchInput').addEventListener('input',   e => { if (e.target.value.length > 2) { clearTimeout(e.target._t); e.target._t = setTimeout(doSearch, 600); } });

async function doSearch() {
  const q = document.getElementById('searchInput').value.trim();
  if (!q) return;
  loader(true);
  try {
    const data = await apiFetch(`${API}/search?q=${encodeURIComponent(q)}`);
    toggleSearch();
    navHistory.push(currentView);
    currentView = 'search';
    hideAllViews();
    const hv = document.getElementById('home-view');
    hv.classList.remove('hidden');
    document.getElementById('bottomNav').classList.remove('hidden');
    hv.innerHTML = `<div class="section-header"><h2 class="section-title">Hasil: "${q}"</h2></div><div class="anime-grid-3">${(data||[]).map(gridCard).join('')}</div>`;
  } catch(e) { showToast('Gagal mencari: '+e.message); }
  finally { loader(false); }
}

// ── UTILS ─────────────────────────────────────────────────────
const loader = on => document.getElementById('loading').classList.toggle('hidden', !on);
function showToast(msg, dur=2800) {
  const t = document.getElementById('toast'); t.textContent=msg; t.classList.remove('hidden');
  clearTimeout(t._t); t._t = setTimeout(()=>t.classList.add('hidden'), dur);
}
function fmtTime(s) { const m=Math.floor(s/60),sec=Math.floor(s%60); return `${m}:${sec.toString().padStart(2,'0')}`; }
function timeAgo(ts) {
  const d=Date.now()-ts, m=Math.floor(d/60000), h=Math.floor(d/3600000), day=Math.floor(d/86400000);
  return day>0?`${day} hari lalu`:h>0?`${h} jam lalu`:m>0?`${m} menit lalu`:'baru saja';
}
function getEpNum(title) {
  const m = title.match(/(?:Episode|Eps?)\s*(\d+(?:\.\d+)?)/i) || title.match(/\d+(?:\.\d+)?/g);
  if (!m) return title.substring(0,8);
  return Array.isArray(m) ? m[m.length-1] : m[1];
}
function slugify(url) { return url.replace(/https?:\/\/[^/]+\//,'').replace(/[^a-z0-9]/gi,'-').toLowerCase().substring(0,80); }
async function apiFetch(url) {
  const r = await fetch(url);
  const contentType = r.headers.get('content-type')||'';
  if (!contentType.includes('application/json')) throw new Error(`Server error ${r.status}`);
  const d = await r.json();
  if (!r.ok) throw new Error(d.error || `Error ${r.status}`);
  return d;
}

// ── NAVIGATION ────────────────────────────────────────────────
function hideAllViews() { document.querySelectorAll('.view').forEach(v=>v.classList.add('hidden')); }
function showView(id)   { hideAllViews(); document.getElementById(id).classList.remove('hidden'); document.getElementById('bottomNav').classList.remove('hidden'); document.getElementById('navbar').classList.remove('hidden'); }

function switchTab(tab) {
  currentView = tab; navHistory = [];
  document.querySelectorAll('.nav-item').forEach(b=>b.classList.remove('active'));
  const tabEl = document.getElementById(`tab-${tab}`); if (tabEl) tabEl.classList.add('active');
  switch(tab) {
    case 'home':     showView('home-view');     if (!document.getElementById('home-view').innerHTML.trim()) loadHome(); break;
    case 'jadwal':   showView('jadwal-view');   loadJadwal();    break;
    case 'riwayat':  showView('riwayat-view');  loadRiwayat();   break;
    case 'stream':   showView('stream-view');   loadFavorites(); break;
    case 'settings': showView('settings-view'); renderSettings();break;
  }
}

function goBack() {
  if (navHistory.length) {
    const prev = navHistory.pop();
    if (prev === 'detail') { showView('detail-view'); return; }
    switchTab(prev);
  } else switchTab('home');
}

function backFromWatch() {
  clearInterval(watchTimer); watchTimer = null;
  if (navHistory.length) { const prev = navHistory.pop(); if (prev==='detail') { showView('detail-view'); } else switchTab(prev); }
  else switchTab('home');
}

// ── CARD TEMPLATES ────────────────────────────────────────────
function gridCard(a, opts={}) {
  const ep = a.episode || a.score || '';
  return `<div class="grid-card" onclick="loadDetail('${a.url}')">
    <div class="grid-card-img">
      <img src="${a.image||''}" alt="${a.title}" loading="lazy" onerror="this.style.opacity=0">
      ${ep ? `<div class="grid-ep">Eps ${ep}</div>` : ''}
      ${a.score && !a.episode ? `<div class="grid-score">★ ${a.score}</div>` : ''}
      ${opts.badge ? `<div class="grid-badge">${opts.badge}</div>` : ''}
    </div>
    <div class="grid-card-title">${a.title}</div>
  </div>`;
}

function hCard(a) {
  const pct = Math.min(100, Math.round(((a.watchedSecs||0)/(a.totalSecs||1420))*100));
  return `<div class="h-card" onclick="loadDetail('${a.animeUrl||a.episodeUrl}')">
    <div class="h-card-img">
      <img src="${a.image||''}" alt="${a.animeTitle||a.title}" loading="lazy" onerror="this.style.opacity=0">
      <div class="h-card-badge">Eps ${a.episode||'?'}</div>
      <div class="h-card-prog"><div class="h-card-prog-fill" style="width:${pct}%"></div></div>
    </div>
    <div class="h-card-title">${a.animeTitle||a.title}</div>
  </div>`;
}

// ── HOME ──────────────────────────────────────────────────────
async function loadHome() {
  const c = document.getElementById('home-view');
  c.innerHTML = '<div style="padding:50px 0;text-align:center"><div class="loading-ring" style="margin:auto"></div></div>';
  try {
    const latest = await apiFetch(`${API}/latest`);
    if (!latest?.length) { c.innerHTML='<div class="empty-state"><h3>Tidak ada data</h3></div>'; return; }

    const top5 = latest.slice(0,5);
    let html = `
      <div class="hero-section">
        <div class="hero-slider-wrap" id="heroSlider">
          ${top5.map((a,i)=>`
            <div class="hero-slide" onclick="loadDetail('${a.url}')">
              <img class="hero-bg" src="${a.image}" alt="${a.title}" loading="${i===0?'eager':'lazy'}" onerror="this.style.opacity=0">
              <div class="hero-overlay"></div>
              <div class="hero-info">
                <div class="hero-rank">#${i+1}</div>
                <div class="hero-title">${a.title}</div>
                ${a.episode ? `<div class="hero-ep-badge">Eps ${a.episode}</div>` : ''}
                <button class="hero-play-btn" onclick="event.stopPropagation();loadDetail('${a.url}')">▶ Nonton Sekarang</button>
              </div>
            </div>`).join('')}
        </div>
        <div class="hero-dots" id="heroDots">${top5.map((_,i)=>`<div class="hero-dot${i===0?' active':''}" onclick="goToSlide(${i})"></div>`).join('')}</div>
      </div>`;

    // Ad banner
    html += `<div class="ad-banner"><ins class="adsbygoogle" style="display:block;min-height:50px" data-ad-client="ca-pub-XXXXXXXXXXXXXXXX" data-ad-slot="XXXXXXXXXX" data-ad-format="auto" data-full-width-responsive="true"></ins></div>`;

    // Recently watched
    const hist = (await getHistory()).slice(0,8);
    if (hist.length) {
      html += `<div class="section-header"><h2 class="section-title">Terakhir Ditonton</h2><button class="see-all-btn" onclick="switchTab('riwayat')">Lihat Semua ›</button></div><div class="h-scroll">${hist.map(hCard).join('')}</div>`;
    }

    // New update
    html += `<div class="section-header"><h2 class="section-title">🔥 New Update</h2><button class="see-all-btn" onclick="switchTab('jadwal')">Jadwal ›</button></div><div class="anime-grid-3">${latest.slice(0,9).map(a=>gridCard(a,{badge:'New'})).join('')}</div>`;

    c.innerHTML = html;
    startHeroSlider();
    try { (window.adsbygoogle = window.adsbygoogle||[]).push({}); } catch(_){}

    // Load genre sections lazily
    loadGenreSections(c);
  } catch(e) { c.innerHTML=`<div class="empty-state"><h3>Gagal memuat</h3><p>${e.message}</p><button class="detail-action-btn btn-primary" style="margin:12px auto 0;display:inline-flex;padding:10px 20px" onclick="document.getElementById('home-view').innerHTML='';loadHome()">🔄 Coba Lagi</button></div>`; }
}

async function loadGenreSections(container) {
  for (const g of HOME_GENRES) {
    const queries = g.q.split(' ');
    const results = await Promise.all(queries.map(q => apiFetch(`${API}/search?q=${encodeURIComponent(q)}`).catch(()=>[])));
    const combined = [...new Map(results.flat().filter(Boolean).map(a=>[a.url,a])).values()].slice(0,12);
    if (!combined.length) continue;
    const sec = document.createElement('div');
    sec.innerHTML = `<div class="section-header"><h2 class="section-title">${g.label}</h2><button class="see-all-btn" onclick="doSearchGenre('${g.q.split(' ')[0]}')">Lihat Semua ›</button></div><div class="h-scroll">${combined.map(a=>`
      <div class="h-card" onclick="loadDetail('${a.url}')">
        <div class="h-card-img"><img src="${a.image||''}" alt="${a.title}" loading="lazy" onerror="this.style.opacity=0">${a.score?`<div class="h-card-badge">★${a.score}</div>`:''}</div>
        <div class="h-card-title">${a.title}</div>
      </div>`).join('')}</div>`;
    container.appendChild(sec);
  }
}

async function doSearchGenre(q) {
  loader(true);
  try {
    const data = await apiFetch(`${API}/search?q=${encodeURIComponent(q)}`);
    navHistory.push(currentView); currentView='search';
    hideAllViews();
    const hv = document.getElementById('home-view');
    hv.classList.remove('hidden');
    document.getElementById('bottomNav').classList.remove('hidden');
    hv.innerHTML=`<div class="section-header"><h2 class="section-title">Genre: ${q}</h2></div><div class="anime-grid-3">${(data||[]).map(gridCard).join('')}</div>`;
  } catch(e){ showToast(e.message); } finally{ loader(false); }
}

function goToSlide(i) {
  const s = document.getElementById('heroSlider'); if (!s) return;
  s.scrollTo({ left: i*s.offsetWidth, behavior:'smooth' });
  document.querySelectorAll('.hero-dot').forEach((d,j) => d.classList.toggle('active', i===j));
  heroIdx = i;
}
function startHeroSlider() {
  clearInterval(heroTimer);
  const s = document.getElementById('heroSlider'); if (!s) return;
  const total = s.children.length;
  heroTimer = setInterval(()=>{ if (document.getElementById('home-view')?.classList.contains('hidden')) return; heroIdx=(heroIdx+1)%total; goToSlide(heroIdx); }, 4500);
}

// ── JADWAL ────────────────────────────────────────────────────
async function loadJadwal() {
  const today = new Date();
  jadwalDay = jadwalDay || DAYS[today.getDay()];
  renderDayStrip(today);
  if (!jadwalCache) {
    document.getElementById('jadwal-content').innerHTML='<div style="padding:40px 0;text-align:center"><div class="loading-ring" style="margin:auto"></div></div>';
    try { jadwalCache = await apiFetch(`${API}/jadwal`); }
    catch(e) { document.getElementById('jadwal-content').innerHTML=`<div class="empty-state"><h3>Gagal memuat jadwal</h3><p>${e.message}</p></div>`; return; }
  }
  renderJadwal(jadwalCache[jadwalDay]||[]);
  updateDayNav();
}
function renderDayStrip(today) {
  const todayKey = DAYS[today.getDay()];
  const strip = document.getElementById('dayStrip');
  strip.innerHTML = DAYS.map((d,i)=>{
    const dt = new Date(today); dt.setDate(today.getDate()-today.getDay()+i);
    return `<div class="day-pill ${d===jadwalDay?'active':''}" onclick="selectDay('${d}')">
      <span class="day-name">${DNAMES[i]}</span>
      <span class="day-date">${dt.getDate()}</span>
      ${d===todayKey && d!==jadwalDay?'<div class="day-dot"></div>':''}
    </div>`;
  }).join('');
}
function selectDay(day) { jadwalDay=day; renderDayStrip(new Date()); renderJadwal(jadwalCache?.[day]||[]); updateDayNav(); }
function updateDayNav() {
  const i=DAYS.indexOf(jadwalDay);
  document.getElementById('prevDayBtn').textContent = `← ${DNAMES[(i+6)%7]}`;
  document.getElementById('nextDayBtn').textContent = `${DNAMES[(i+1)%7]} →`;
}
document.getElementById('prevDayBtn').onclick = ()=>{ selectDay(DAYS[(DAYS.indexOf(jadwalDay)+6)%7]); };
document.getElementById('nextDayBtn').onclick = ()=>{ selectDay(DAYS[(DAYS.indexOf(jadwalDay)+1)%7]); };
function renderJadwal(items) {
  const now = new Date();
  if (!items||!items.length) { document.getElementById('jadwal-content').innerHTML='<div class="empty-state"><h3>Tidak ada jadwal</h3><p>Tidak ada anime yang tayang hari ini</p></div>'; return; }
  document.getElementById('jadwal-content').innerHTML = items.map(a=>{
    let cls='upcoming', txt='Belum Tayang';
    if (a.time) { const [h,m]=a.time.split(':').map(Number); const t=new Date(); t.setHours(h,m,0,0); if (now>t) { cls='aired'; txt='Sudah Tayang'; } }
    return `<div class="jadwal-item status-${cls}" onclick="loadDetail('${a.url}')">
      <div class="jadwal-time">${a.time||'??:??'}</div>
      <div class="jadwal-thumb"><img src="${a.image||''}" alt="${a.title}" loading="lazy" onerror="this.style.opacity=0"></div>
      <div class="jadwal-info">
        <div class="jadwal-title">${a.title}</div>
        ${a.episode?`<div class="jadwal-ep">Episode ${a.episode}</div>`:''}
        <div class="jadwal-stats">${a.score?`<span class="jadwal-score">★ ${a.score}</span>`:''}</div>
        <div class="jadwal-status ${cls}">${txt}</div>
      </div>
    </div>`;
  }).join('');
}

// ── RIWAYAT ───────────────────────────────────────────────────
async function loadRiwayat() {
  const c = document.getElementById('riwayat-content');
  const history = await getHistory();
  if (!history.length) { c.innerHTML='<div class="empty-state"><svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg><h3>Belum ada riwayat</h3><p>Anime yang ditonton akan muncul di sini</p></div>'; return; }
  const grouped = {};
  history.forEach(h => {
    const lw = h.lastWatched || Date.now();
    const label = new Date(lw).toLocaleDateString('id-ID',{day:'numeric',month:'long',year:'numeric'});
    (grouped[label] = grouped[label]||[]).push(h);
  });
  c.innerHTML = Object.entries(grouped).map(([date,items])=>`
    <div class="riwayat-date-group">
      <div class="riwayat-date-label">${date}</div>
      ${items.map(h=>{
        const lw = h.lastWatched||Date.now();
        const pct = Math.min(100,Math.round(((h.watchedSecs||0)/(h.totalSecs||1420))*100));
        const time = new Date(lw).toLocaleTimeString('id-ID',{hour:'2-digit',minute:'2-digit'});
        const isSel = selectedRiw.has(h.episodeUrl);
        return `<div class="riwayat-item ${isSel?'selected':''}" data-ep="${h.episodeUrl}" onclick="onRiwayatClick('${h.episodeUrl}')" oncontextmenu="onRiwayatLong('${h.episodeUrl}');return false">
          <div class="riwayat-thumb"><img src="${h.image||''}" alt="${h.animeTitle||h.title||''}" loading="lazy" onerror="this.style.opacity=0"></div>
          <div class="riwayat-info">
            <div class="riwayat-title">${h.animeTitle||h.title||'Tidak diketahui'}</div>
            <div class="riwayat-ep">${h.episodeTitle||(h.episode?'Episode '+h.episode:'')}</div>
            <div class="riwayat-prog-wrap">
              <div class="riwayat-prog-bar"><div class="riwayat-prog-fill" style="width:${pct}%"></div></div>
              <div class="riwayat-prog-time">${fmtTime(h.watchedSecs||0)} / ${fmtTime(h.totalSecs||1420)}</div>
            </div>
          </div>
          <div class="riwayat-watched-time">${time}</div>
        </div>`;
      }).join('')}
    </div>`).join('') + (multiSelect?`<div class="riwayat-actions"><button class="riwayat-action-btn single" onclick="exitMulti()">Batal</button><button class="riwayat-action-btn danger" onclick="deleteSelected()">Hapus (${selectedRiw.size})</button></div>`:'');
  // Touch long press
  c.querySelectorAll('.riwayat-item').forEach(el=>{
    let t;
    el.addEventListener('touchstart',()=>{ t=setTimeout(()=>onRiwayatLong(el.dataset.ep),600); });
    el.addEventListener('touchend',  ()=>clearTimeout(t));
    el.addEventListener('touchmove', ()=>clearTimeout(t));
  });
}
function onRiwayatClick(epUrl) {
  if (multiSelect) { selectedRiw.has(epUrl)?selectedRiw.delete(epUrl):selectedRiw.add(epUrl); loadRiwayat(); }
  else { loadWatch(epUrl); }
}
function onRiwayatLong(epUrl) { multiSelect=true; selectedRiw.add(epUrl); navigator.vibrate&&navigator.vibrate(30); loadRiwayat(); }
function exitMulti() { multiSelect=false; selectedRiw.clear(); loadRiwayat(); }
async function deleteSelected() {
  for (const u of selectedRiw) await deleteHistory(u);
  multiSelect=false; selectedRiw.clear(); showToast('Riwayat dihapus'); loadRiwayat();
}

// ── FAVORITES ─────────────────────────────────────────────────
async function loadFavorites() {
  const c = document.getElementById('stream-content');
  const favs = await getAllFavs();
  if (!favs.length) { c.innerHTML='<div class="empty-state"><svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78z"/></svg><h3>Belum ada favorit</h3><p>Tap ♡ di halaman detail untuk menyimpan</p></div>'; return; }
  c.innerHTML=`<div class="anime-grid-3" style="padding:16px">${favs.map(a=>`<div class="grid-card" onclick="loadDetail('${a.url}')"><div class="grid-card-img"><img src="${a.image||''}" alt="${a.title}" loading="lazy" onerror="this.style.opacity=0">${a.score?`<div class="grid-score">★ ${a.score}</div>`:''}</div><div class="grid-card-title">${a.title}</div></div>`).join('')}</div>`;
}

// ── DETAIL ────────────────────────────────────────────────────
async function loadDetail(url) {
  navHistory.push(currentView);
  currentView='detail';
  hideAllViews();
  document.getElementById('detail-view').classList.remove('hidden');
  document.getElementById('bottomNav').classList.add('hidden');
  const dc = document.getElementById('detail-content');
  dc.innerHTML='<div style="padding:50px 0;text-align:center"><div class="loading-ring" style="margin:auto"></div></div>';
  loader(true);
  try {
    const data  = await apiFetch(`${API}/detail?url=${encodeURIComponent(url)}`);
    const info  = data.info || {};
    const score = data.score || info.skor || info.score || info.rating || '';
    const status = info.status || 'Ongoing';
    const type   = info.tipe || info.type || 'TV';
    const studio = info.studio || '-';
    const totalEps = info.total_episode || info.episode || '?';
    const duration = info.durasi || info.duration || '23 Menit';
    const genreRaw = info.genre || info.genres || 'Anime';
    const genres = genreRaw.split(',').map(g=>g.trim()).filter(Boolean).slice(0,5);
    const eps = data.episodes || [];
    const isFav = await getFav(url);
    const watchedMap = {};
    (await getHistory()).forEach(h => { if (h.animeUrl===url) watchedMap[h.episodeUrl]=true; });
    const newest = eps[0], oldest = eps[eps.length-1];
    const newestNum = newest ? getEpNum(newest.title) : '';

    dc.innerHTML = `
      <div class="detail-banner"><img src="${data.image||''}" alt="${data.title}" loading="eager" onerror="this.style.opacity=0"><div class="detail-banner-overlay"></div></div>
      <div class="detail-main">
        <h1 class="detail-title">${data.title}</h1>
        ${info.japanese?`<div class="detail-alt-title">${info.japanese}</div>`:''}
        <div class="detail-badges">
          ${score?`<span class="detail-badge badge-score">★ ${score}</span>`:''}
          <span class="detail-badge badge-status">${status}</span>
          <span class="detail-badge badge-type">${type}</span>
        </div>
        <div class="detail-row">
          <div class="detail-poster"><img src="${data.image||''}" alt="${data.title}" onerror="this.style.opacity=0"></div>
          <div class="detail-info-col">
            <div class="detail-meta-item"><span class="detail-meta-label">Studio</span><span class="detail-meta-val">${studio}</span></div>
            <div class="detail-meta-item"><span class="detail-meta-label">Total Eps</span><span class="detail-meta-val">${totalEps}</span></div>
            <div class="detail-meta-item"><span class="detail-meta-label">Durasi</span><span class="detail-meta-val">${duration}</span></div>
            <div class="detail-meta-item"><span class="detail-meta-label">Genre</span><span class="detail-meta-val">${genres.join(', ')}</span></div>
          </div>
        </div>
        ${data.description?`
        <div class="detail-synopsis collapsed" id="synopsisEl">${data.description}</div>
        <button class="read-more-btn" id="synBtn" onclick="toggleSynopsis()">Selengkapnya ▼</button>
        `:''}
        <div class="detail-action-row">
          ${oldest?`<button class="detail-action-btn btn-primary" onclick="loadWatch('${oldest.url}',${JSON.stringify({animeTitle:data.title,animeUrl:url,image:data.image,episode:getEpNum(oldest.title),episodeTitle:oldest.title})})">▶ Nonton</button>`:''}
          ${newest?`<button class="detail-action-btn btn-secondary" onclick="loadWatch('${newest.url}',${JSON.stringify({animeTitle:data.title,animeUrl:url,image:data.image,episode:newestNum,episodeTitle:newest.title})})">▶ Terbaru (${newestNum})</button>`:''}
          <button class="fav-btn ${isFav?'active':''}" id="favBtn" onclick="toggleFavBtn('${url}','${data.title.replace(/'/g,"\\'")}','${(data.image||'').replace(/'/g,"\\'")}','${score}')">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="${isFav?'currentColor':'none'}" stroke="currentColor" stroke-width="2"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78z"/></svg>
          </button>
        </div>
      </div>
      <div class="ep-section">
        <div class="ep-section-header">
          <span class="ep-section-title">Daftar Episode</span>
          ${eps.length?`<span class="ep-range-badge">1 – ${newestNum}</span>`:''}
        </div>
        <div class="ep-grid">
          ${eps.map(ep=>{
            const n=getEpNum(ep.title), w=watchedMap[ep.url]||watchedMap[ep.url?.replace('v1.','v2.')];
            const meta=JSON.stringify({animeTitle:data.title,animeUrl:url,image:data.image,episode:n,episodeTitle:ep.title});
            return `<div class="ep-box ${w?'watched':''}" title="${ep.title}" onclick="loadWatch('${ep.url}',${meta})">${n}</div>`;
          }).join('')}
        </div>
      </div>`;

    // Fix synopsis expand (check if text is long enough)
    const synEl = document.getElementById('synopsisEl');
    const synBtn = document.getElementById('synBtn');
    if (synEl && synBtn) {
      if (synEl.scrollHeight <= synEl.clientHeight + 5) synBtn.style.display='none';
    }
  } catch(e) { dc.innerHTML=`<div class="empty-state"><h3>Gagal memuat</h3><p>${e.message}</p><button class="detail-action-btn btn-primary" style="margin:12px auto 0;display:inline-flex;padding:10px 20px" onclick="loadDetail('${url}')">🔄 Coba Lagi</button></div>`; }
  finally { loader(false); }
}

function toggleSynopsis() {
  const el=document.getElementById('synopsisEl'), btn=document.getElementById('synBtn');
  if (!el) return;
  const collapsed = el.classList.toggle('collapsed');
  if (btn) btn.textContent = collapsed ? 'Selengkapnya ▼' : 'Lebih sedikit ▲';
}

async function toggleFavBtn(url, title, image, score) {
  const isFav = await getFav(url);
  if (isFav) { await delFav(url); showToast('Dihapus dari favorit'); const b=document.getElementById('favBtn'); if(b){b.classList.remove('active');b.querySelector('svg').setAttribute('fill','none');} }
  else { await saveFav({url,title,image,score}); showToast('Ditambahkan ke favorit'); const b=document.getElementById('favBtn'); if(b){b.classList.add('active');b.querySelector('svg').setAttribute('fill','currentColor');} }
}

// ── WATCH ─────────────────────────────────────────────────────
async function loadWatch(epUrl, metaObj) {
  if (!epUrl) { showToast('URL episode tidak valid'); return; }
  let meta = {};
  if (typeof metaObj === 'object' && metaObj !== null) meta = metaObj;
  else if (typeof metaObj === 'string') { try { meta = JSON.parse(metaObj); } catch(_){} }

  currentEpUrl = epUrl;
  navHistory.push(currentView);
  currentView = 'watch';
  hideAllViews();
  document.getElementById('watch-view').classList.remove('hidden');
  document.getElementById('bottomNav').classList.add('hidden');
  document.getElementById('watch-content').innerHTML='<div style="padding:50px 0;text-align:center"><div class="loading-ring" style="margin:auto"></div></div>';
  clearInterval(watchTimer);
  loader(true);

  // Save history first (with proper key)
  const histEntry = {
    episodeUrl:  epUrl,
    animeUrl:    meta.animeUrl    || epUrl,
    animeTitle:  meta.animeTitle  || 'Anime',
    episodeTitle:meta.episodeTitle|| '',
    episode:     meta.episode     || '',
    image:       meta.image       || '',
    watchedSecs: 0,
    totalSecs:   1420,
    lastWatched: Date.now(),
  };
  const prev = await idbGet('history', epUrl);
  if (prev) { histEntry.watchedSecs=prev.watchedSecs; histEntry.totalSecs=prev.totalSecs; }
  await saveHistory(histEntry);

  try {
    const data = await apiFetch(`${API}/watch?url=${encodeURIComponent(epUrl)}`);
    renderWatchScreen(data, meta, epUrl);
    startWatchTimer(epUrl);
  } catch(e) {
    document.getElementById('watch-content').innerHTML=`<div class="stream-error"><svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="#666" stroke-width="1.5"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg><p>${e.message}</p><div class="stream-error-btns"><button class="detail-action-btn btn-primary" style="flex:0;padding:10px 22px" onclick="loadWatch('${epUrl}',${JSON.stringify(meta)})">🔄 Coba Lagi</button><button class="detail-action-btn btn-secondary" style="flex:0;padding:10px 22px" onclick="backFromWatch()">← Kembali</button></div></div>`;
  } finally { loader(false); }
}

function renderWatchScreen(data, meta, epUrl) {
  const streams = data.streams || [];
  const first   = streams[0];
  const epNum   = meta.episode || getEpNum(data.title);

  document.getElementById('watch-content').innerHTML = `
    <div class="player-wrap" id="playerWrap">
      ${first
        ? `<iframe id="videoPlayer" src="${first.url}" allowfullscreen allow="autoplay;fullscreen" scrolling="no" frameborder="0"></iframe>`
        : `<div class="stream-error"><svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="#666" stroke-width="1.5"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg><p>Stream tidak tersedia untuk episode ini</p><div class="stream-error-btns"><button class="detail-action-btn btn-primary" style="flex:0;padding:10px 22px" onclick="loadWatch('${epUrl}',${JSON.stringify(meta)})">🔄 Coba Lagi</button><button class="detail-action-btn btn-secondary" style="flex:0;padding:10px 22px" onclick="backFromWatch()">← Episode Lain</button></div></div>`
      }
    </div>
    <div class="watch-meta">
      <div class="watch-title">${data.title}</div>
      <div class="watch-ep-info">
        ${meta.image?`<div class="watch-anime-link"><div class="watch-anime-thumb"><img src="${meta.image}" alt="" onerror="this.style.opacity=0"></div><span class="watch-anime-name">${meta.animeTitle||''}</span></div>`:''}
        <span class="watch-ep-num">Episode ${epNum}</span>
      </div>
    </div>
    <div class="watch-actions">
      <button class="watch-action-btn" id="likeBtn" onclick="this.classList.toggle('active');showToast(this.classList.contains('active')?'👍 Disukai':'Like dibatalkan')">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 9V5a3 3 0 0 0-3-3l-4 9v11h11.28a2 2 0 0 0 2-1.7l1.38-9a2 2 0 0 0-2-2.3H14z"/><path d="M7 22H4a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2h3"/></svg>
        Suka
      </button>
      <button class="watch-action-btn">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg>
        Share
      </button>
      ${first?`<button class="watch-action-btn watch-quality-btn"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2"/></svg>${streams[0].server.match(/\d+p/i)?.[0]||'HD'}</button>`:'' }
    </div>
    ${streams.length>1?`
    <div class="server-section">
      <div class="server-section-label">Pilih Server:</div>
      <div class="server-list">${streams.map((s,i)=>`<button class="server-tag ${i===0?'active':''}" onclick="changeServer('${s.url}',this)">${s.server}</button>`).join('')}</div>
    </div>`:''}
    <div class="ep-list-section" id="epListSection"></div>
    <div id="commentsSection"></div>`;

  loadEpListForWatch(meta.animeUrl, epUrl, meta);
  renderComments(slugify(epUrl));
}

async function loadEpListForWatch(animeUrl, curEpUrl, meta) {
  if (!animeUrl) return;
  try {
    const data = await apiFetch(`${API}/detail?url=${encodeURIComponent(animeUrl)}`);
    const eps = data.episodes||[];
    if (!eps.length) return;
    const sec = document.getElementById('epListSection');
    if (!sec) return;
    sec.innerHTML=`<div class="ep-list-header"><span class="ep-list-title">Episode Lainnya</span><span class="ep-range-badge">1 – ${getEpNum(eps[0].title)}</span></div>
      <div class="ep-scroll">${eps.map(ep=>{
        const n=getEpNum(ep.title), isCur=ep.url===curEpUrl||ep.url?.replace('v1.','v2.')===curEpUrl;
        return `<div class="ep-box ${isCur?'current':''}" title="${ep.title}" onclick="loadWatch('${ep.url}',${JSON.stringify({animeTitle:meta.animeTitle,animeUrl,image:meta.image,episode:n,episodeTitle:ep.title})})">${n}</div>`;
      }).join('')}</div>`;
    sec.querySelector('.current')?.scrollIntoView({behavior:'smooth',block:'nearest',inline:'center'});
  } catch(_){}
}

function changeServer(url, btn) {
  const iframe = document.getElementById('videoPlayer');
  if (iframe) iframe.src = url;
  document.querySelectorAll('.server-tag').forEach(b=>b.classList.remove('active'));
  btn.classList.add('active');
  showToast('Server diganti');
}

function startWatchTimer(epUrl) {
  clearInterval(watchTimer);
  watchTimer = setInterval(async()=>{
    const e = await idbGet('history', epUrl);
    if (e) { e.watchedSecs=Math.min((e.watchedSecs||0)+10, e.totalSecs||1420); e.lastWatched=Date.now(); await idbPut('history', e); }
  }, 10000);
}

// ── COMMENTS ─────────────────────────────────────────────────
function renderComments(epKey) {
  const sec = document.getElementById('commentsSection');
  if (!sec) return;
  sec.innerHTML=`
    <div class="comments-section">
      <div class="comments-header">
        <div class="comments-count" id="commentsCount">Komentar</div>
        <div class="comment-tabs"><button class="comment-tab active">Terbaru</button></div>
      </div>
      ${currentUser
        ? `<div class="comment-input-row">
            <div class="comment-avatar">${currentUser.user_metadata?.avatar_url?`<img src="${currentUser.user_metadata.avatar_url}" alt="">`:'😊'}</div>
            <textarea class="comment-input" id="commentInput" placeholder="Tulis komentar..." rows="1"></textarea>
            <button class="comment-send" onclick="submitComment('${epKey}')">Kirim</button>
          </div>`
        : `<div class="comment-login-prompt"><p>Login untuk berkomentar</p><button class="login-cta-btn" onclick="handleAuthClick()">Login</button></div>`
      }
      <div class="comment-list" id="commentList"><div style="padding:20px;text-align:center;color:var(--text-muted);font-size:13px">Memuat komentar...</div></div>
    </div>`;

  if (SB_READY && sb) {
    sb.from('comments').select('*').eq('episode_key', epKey).order('created_at', { ascending: false }).limit(50)
      .then(({ data }) => {
        const list = document.getElementById('commentList');
        if (!list) return;
        const cnt  = document.getElementById('commentsCount');
        if (cnt) cnt.textContent = `${(data||[]).length} Komentar`;
        if (!data?.length) { list.innerHTML='<div style="padding:20px;text-align:center;color:var(--text-muted);font-size:13px">Belum ada komentar. Jadilah yang pertama!</div>'; return; }
        list.innerHTML = data.map(c=>`<div class="comment-item">
          <div class="comment-avatar">${c.avatar_url?`<img src="${c.avatar_url}" alt="">`:'😊'}</div>
          <div class="comment-body">
            <span class="comment-name">${c.username||'Anonim'}</span>
            <span class="comment-time">${timeAgo(new Date(c.created_at).getTime())}</span>
            <div class="comment-text">${c.text||''}</div>
          </div>
        </div>`).join('');
      });
  } else {
    const list = document.getElementById('commentList');
    if (list) list.innerHTML='<div style="padding:20px;text-align:center;color:var(--text-muted);font-size:13px">Aktifkan Supabase untuk melihat komentar</div>';
  }
}

async function submitComment(epKey) {
  if (!currentUser || !SB_READY || !sb) { showToast('Login dulu ya!'); return; }
  const inp = document.getElementById('commentInput');
  const text = inp?.value.trim();
  if (!text) return;
  const username = currentUser.user_metadata?.username || currentUser.email?.split('@')[0] || 'User';
  const { error } = await sb.from('comments').insert({ episode_key: epKey, user_id: currentUser.id, username, avatar_url: currentUser.user_metadata?.avatar_url||'', text });
  if (error) { showToast('Gagal kirim komentar'); return; }
  if (inp) inp.value='';
  showToast('Komentar terkirim!');
  renderComments(epKey);
}

// ── SETTINGS ─────────────────────────────────────────────────
function renderSettings() {
  const c = document.getElementById('settings-content');
  const isLight = document.documentElement.hasAttribute('data-theme');
  c.innerHTML=`
    ${currentUser?`
    <div class="user-profile-card">
      <div class="profile-avatar">${currentUser.user_metadata?.avatar_url?`<img src="${currentUser.user_metadata.avatar_url}" alt="">`:((currentUser.email||'U')[0].toUpperCase())}</div>
      <div><div class="profile-name">${currentUser.user_metadata?.username||currentUser.email?.split('@')[0]||'User'}</div><div class="profile-email">${currentUser.email||''}</div></div>
      <button class="profile-logout-btn" onclick="doLogout()">Logout</button>
    </div>`:
    `<div class="settings-section" style="margin-top:16px"><button class="login-cta-btn" style="width:calc(100% - 32px);margin:0 16px;justify-content:center;padding:14px;border-radius:12px;display:flex" onclick="handleAuthClick()"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>&nbsp;Login / Daftar</button></div>`}
    <div class="settings-list">
      <div class="settings-section">
        <div class="settings-section-title">Tampilan</div>
        <div class="settings-item" onclick="toggleTheme();renderSettings()">
          <div class="settings-item-left"><div class="settings-item-icon">🌙</div><div><div class="settings-item-title">Mode Gelap</div></div></div>
          <div class="toggle-switch ${!isLight?'on':''}"></div>
        </div>
      </div>
      <div class="settings-section" style="margin-top:12px">
        <div class="settings-section-title">Tentang</div>
        <div class="settings-item"><div class="settings-item-left"><div class="settings-item-icon">⚡</div><div><div class="settings-item-title">NimeStream</div><div class="settings-item-sub">v10.0 — Powered by Samehadaku</div></div></div></div>
        <div class="settings-item"><div class="settings-item-left"><div class="settings-item-icon">🛢️</div><div><div class="settings-item-title">Supabase</div><div class="settings-item-sub">${SB_READY?'✅ Terhubung':'⚠️ Belum dikonfigurasi — set SB_URL & SB_KEY di app.js'}</div></div></div></div>
        <div class="settings-item"><div class="settings-item-left"><div class="settings-item-icon">🤖</div><div><div class="settings-item-title">Bot Telegram</div><div class="settings-item-sub">Daftar akun via @NimeStreamBot</div></div></div>
          <a href="https://t.me/NimeStreamBot" target="_blank" class="see-all-btn" style="padding:0 12px">Buka ›</a>
        </div>
      </div>
      <div class="settings-section" style="margin-top:12px">
        <div class="settings-section-title">Data</div>
        <div class="settings-item" onclick="doClearHistory()"><div class="settings-item-left"><div class="settings-item-icon">🗑️</div><div><div class="settings-item-title">Hapus Semua Riwayat</div></div></div><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" stroke-width="2"><path d="M9 18l6-6-6-6"/></svg></div>
      </div>
    </div>`;
}

async function doLogout() {
  if (SB_READY && sb) await sb.auth.signOut();
  currentUser=null; renderAuthBtn(); renderSettings();
  showToast('Logout berhasil');
}

async function doClearHistory() {
  if (!confirm('Hapus semua riwayat?')) return;
  await idbClear('history');
  if (SB_READY && sb && currentUser) await sb.from('watch_history').delete().eq('user_id', currentUser.id);
  document.getElementById('home-view').innerHTML='';
  showToast('Riwayat dihapus');
}

// ── INIT ──────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  switchTab('home');
  renderAuthBtn();
});
