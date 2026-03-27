'use strict';
/* ============================================================
   NimeStream — app.js v12  ★ FINAL
   ─────────────────────────────────────────────────────────────
   Bugs fixed (v11):
     #1 KRITIS: Episode buttons mati — JSON.stringify di onclick
     #2 Riwayat klik → watch tanpa meta (judul/gambar kosong)
     #3 Jadwal klik ke AniList URL (tidak bisa dibuka scraper)
     #4 loadEpListForWatch: meta.animeUrl undefined
     #5 "Coba Lagi" button re-embed JSON
     #6 URL special chars di onclick (XSS & break HTML)

   Fitur baru (v12):
     + Realtime comments via Supabase subscription
     + PWA install prompt (tombol "Install Aplikasi")
     + Share episode button (Web Share API)
     + Scroll-to-top button (muncul saat scroll > 300px)
     + Offline indicator banner
     + Random anime button di home
     + Tombol "Hapus" per-item di riwayat (swipe gesture)
     + Like counter persisten via localStorage
     + Skeleton loading untuk home cards
   ============================================================ */

// ── SUPABASE CONFIG ───────────────────────────────────────────
// Ganti dengan milikmu: Supabase Dashboard → Settings → API
const SB_URL   = 'YOUR_SUPABASE_URL';       // https://xxx.supabase.co
const SB_KEY   = 'YOUR_SUPABASE_ANON_KEY';  // eyJhbGci...
const SB_READY = SB_URL !== 'YOUR_SUPABASE_URL';
let sb = null;
if (SB_READY && window.supabase) sb = window.supabase.createClient(SB_URL, SB_KEY);

// ── CONSTANTS ─────────────────────────────────────────────────
const API    = '/api';
const DAYS   = ['minggu','senin','selasa','rabu','kamis','jumat','sabtu'];
const DNAMES = ['Min','Sen','Sel','Rab','Kam','Jum','Sab'];
const HOME_GENRES = [
  { label:'⚔️ Action',  q:'action bleach jujutsu kimetsu' },
  { label:'💕 Romance', q:'love romance kanojo' },
  { label:'🌟 Isekai',  q:'isekai tensei reincarnation' },
  { label:'😂 Comedy',  q:'comedy slice bocchi' },
  { label:'✨ Fantasy', q:'fantasy magic mahou' },
  { label:'🏫 School',  q:'school gakuen classroom' },
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
let _realtimeSub = null;   // Supabase realtime subscription

// ── EPISODE REGISTRY ─────────────────────────────────────────
window._epReg    = {};
window._curAnime = {};

function epRegSet(url, meta) { window._epReg[url] = meta; }
function epRegGet(url)       { return window._epReg[url] || null; }

// ── INDEXEDDB ─────────────────────────────────────────────────
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
  return new Promise((res, rej) => {
    const tx = db.transaction(store, 'readwrite');
    const rq = tx.objectStore(store).put(obj);
    rq.onsuccess = () => res(); rq.onerror = () => rej(rq.error);
  });
}
async function idbGet(store, key) {
  const db = await openDB();
  return new Promise(res => {
    const r = db.transaction(store,'readonly').objectStore(store).get(key);
    r.onsuccess = () => res(r.result || null); r.onerror = () => res(null);
  });
}
async function idbAll(store) {
  const db = await openDB();
  return new Promise(res => {
    const r = db.transaction(store,'readonly').objectStore(store).getAll();
    r.onsuccess = () => res(r.result || []); r.onerror = () => res([]);
  });
}
async function idbDel(store, key) {
  const db = await openDB();
  return new Promise(res => {
    db.transaction(store,'readwrite').objectStore(store).delete(key).onsuccess = () => res();
  });
}
async function idbClear(store) {
  const db = await openDB();
  return new Promise(res => {
    db.transaction(store,'readwrite').objectStore(store).clear().onsuccess = () => res();
  });
}

// ── DATA LAYER ────────────────────────────────────────────────
async function saveHistory(entry) {
  if (!entry.episodeUrl) return;
  entry.lastWatched = entry.lastWatched || Date.now();
  entry.totalSecs   = entry.totalSecs   || 1420;
  entry.watchedSecs = entry.watchedSecs || 0;
  await idbPut('history', entry);
  if (sb && currentUser) {
    sb.from('watch_history').upsert({
      user_id:       currentUser.id,
      episode_url:   entry.episodeUrl,
      anime_url:     entry.animeUrl     || '',
      anime_title:   entry.animeTitle   || '',
      episode_title: entry.episodeTitle || '',
      episode_num:   String(entry.episode || ''),
      image_url:     entry.image        || '',
      watched_secs:  entry.watchedSecs,
      total_secs:    entry.totalSecs,
      last_watched:  new Date(entry.lastWatched).toISOString(),
    }, { onConflict: 'user_id,episode_url' }).then(() => {}).catch(() => {});
  }
}
async function getHistory() {
  if (sb && currentUser) {
    const { data } = await sb.from('watch_history').select('*')
      .eq('user_id', currentUser.id).order('last_watched', { ascending: false }).limit(200);
    if (data && data.length) return data.map(r => ({
      episodeUrl: r.episode_url, animeUrl: r.anime_url, animeTitle: r.anime_title,
      episodeTitle: r.episode_title, episode: r.episode_num, image: r.image_url,
      watchedSecs: r.watched_secs, totalSecs: r.total_secs,
      lastWatched: new Date(r.last_watched).getTime()
    }));
  }
  return (await idbAll('history')).sort((a,b) => (b.lastWatched||0) - (a.lastWatched||0));
}
async function deleteHistory(epUrl) {
  await idbDel('history', epUrl);
  if (sb && currentUser) await sb.from('watch_history').delete().eq('user_id', currentUser.id).eq('episode_url', epUrl);
}
async function saveFav(obj) {
  await idbPut('favorites', { ...obj, timestamp: Date.now() });
  if (sb && currentUser) await sb.from('favorites').upsert(
    { user_id: currentUser.id, anime_url: obj.url, title: obj.title, image_url: obj.image, score: String(obj.score||'') },
    { onConflict: 'user_id,anime_url' }
  );
}
async function delFav(url) {
  await idbDel('favorites', url);
  if (sb && currentUser) await sb.from('favorites').delete().eq('user_id', currentUser.id).eq('anime_url', url);
}
async function getFav(url) {
  if (sb && currentUser) {
    const { data } = await sb.from('favorites').select('id').eq('user_id', currentUser.id).eq('anime_url', url).maybeSingle();
    return !!data;
  }
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
function handleAuthClick() { if (currentUser) switchTab('settings'); else showLoginModal(); }

function showLoginModal() {
  const m = document.createElement('div');
  m.id = 'loginModal'; m.className = 'modal-overlay';
  m.innerHTML = `
    <div class="modal-box">
      <button class="modal-close" onclick="closeModal()">✕</button>
      <div class="modal-logo">⚡ NimeStream</div>
      <div class="modal-tabs">
        <button class="modal-tab active" id="tabLogin" onclick="switchModalTab('login')">Login</button>
        <button class="modal-tab" id="tabRegister" onclick="switchModalTab('register')">Daftar</button>
      </div>
      <div id="modalLoginForm">
        <div class="form-group"><label>Email</label><input type="email" id="loginEmail" placeholder="nama@email.com" autocomplete="email"></div>
        <div class="form-group"><label>Password</label><input type="password" id="loginPass" placeholder="Password" autocomplete="current-password"><div class="form-err hidden" id="loginErr"></div></div>
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
  if (!SB_READY || !sb) { showToast('Supabase belum dikonfigurasi'); return; }
  const email = document.getElementById('loginEmail')?.value.trim();
  const pass  = document.getElementById('loginPass')?.value;
  const errEl = document.getElementById('loginErr');
  if (!email || !pass) { if (errEl) { errEl.textContent='Isi email dan password'; errEl.classList.remove('hidden'); } return; }
  const btn = document.querySelector('.form-submit');
  if (btn) { btn.textContent='Memuat...'; btn.disabled=true; }
  const { data, error } = await sb.auth.signInWithPassword({ email, password: pass });
  if (btn) { btn.textContent='Masuk'; btn.disabled=false; }
  if (error) { if (errEl) { errEl.textContent = error.message==='Invalid login credentials'?'Email atau password salah':error.message; errEl.classList.remove('hidden'); } return; }
  currentUser = data.user; closeModal(); renderAuthBtn(); showToast('Login berhasil! 🎉');
  if (currentView==='home') { document.getElementById('home-view').innerHTML=''; loadHome(); }
}
function closeModal() { document.getElementById('loginModal')?.remove(); }
function renderAuthBtn() {
  const btn = document.getElementById('authBtn'); if (!btn) return;
  if (currentUser?.user_metadata?.avatar_url) {
    btn.innerHTML = `<img src="${currentUser.user_metadata.avatar_url}" alt="avatar" style="width:100%;height:100%;object-fit:cover;border-radius:50%">`;
  } else if (currentUser) {
    btn.innerHTML = `<span style="font-size:14px;font-weight:800;color:var(--accent)">${(currentUser.email||'U').charAt(0).toUpperCase()}</span>`;
  } else {
    btn.innerHTML = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>`;
  }
}
if (SB_READY && sb) {
  sb.auth.getSession().then(({ data: { session } }) => { if (session) { currentUser=session.user; renderAuthBtn(); } });
  sb.auth.onAuthStateChange((_e, session) => { currentUser=session?.user||null; renderAuthBtn(); });
}

// ── THEME ─────────────────────────────────────────────────────
function toggleTheme() {
  if (document.documentElement.hasAttribute('data-theme')) { document.documentElement.removeAttribute('data-theme'); localStorage.setItem('theme','dark'); }
  else { document.documentElement.setAttribute('data-theme','light'); localStorage.setItem('theme','light'); }
}
if (localStorage.getItem('theme')==='light') document.documentElement.setAttribute('data-theme','light');

// ── SEARCH ────────────────────────────────────────────────────
function toggleSearch() {
  const p = document.getElementById('searchPanel'); p.classList.toggle('hidden');
  if (!p.classList.contains('hidden')) { const i=document.getElementById('searchInput'); i.value=''; i.focus(); }
}
document.getElementById('searchInput').addEventListener('keypress', e => { if (e.key==='Enter') doSearch(); });
document.getElementById('searchInput').addEventListener('input', e => {
  if (e.target.value.length > 2) { clearTimeout(e.target._t); e.target._t = setTimeout(doSearch, 700); }
});
async function doSearch() {
  const q = document.getElementById('searchInput').value.trim(); if (!q) return;
  loader(true);
  try {
    const data = await apiFetch(`${API}/search?q=${encodeURIComponent(q)}`);
    toggleSearch(); navHistory.push(currentView); currentView='search';
    hideAllViews();
    const hv = document.getElementById('home-view'); hv.classList.remove('hidden');
    document.getElementById('bottomNav').classList.remove('hidden');
    hv.innerHTML = `<div class="section-header" style="padding:16px 16px 0"><h2 class="section-title">Hasil: "${esc(q)}"</h2></div>
      <div class="anime-grid-3">${(data||[]).map(gridCard).join('')}</div>`;
  } catch(e) { showToast('Gagal mencari: '+e.message); }
  finally { loader(false); }
}

// ── UTILS ─────────────────────────────────────────────────────
const loader = on => document.getElementById('loading').classList.toggle('hidden',!on);
function showToast(msg, dur=2800) {
  const t=document.getElementById('toast'); t.textContent=msg; t.classList.remove('hidden');
  clearTimeout(t._t); t._t=setTimeout(()=>t.classList.add('hidden'),dur);
}
function fmtTime(s) { const m=Math.floor(s/60),sec=Math.floor(s%60); return `${m}:${sec.toString().padStart(2,'0')}`; }
function timeAgo(ts) {
  const d=Date.now()-ts,m=Math.floor(d/60000),h=Math.floor(d/3600000),day=Math.floor(d/86400000);
  return day>0?`${day}h lalu`:h>0?`${h}j lalu`:m>0?`${m}m lalu`:'baru';
}
function getEpNum(title) {
  const m=title.match(/(?:Episode|Eps?)\s*(\d+(?:\.\d+)?)/i)||title.match(/\d+(?:\.\d+)?/g);
  if (!m) return title.substring(0,8);
  return Array.isArray(m)?m[m.length-1]:m[1];
}
function slugify(url) { return url.replace(/https?:\/\/[^/]+\//,'').replace(/[^a-z0-9]/gi,'-').toLowerCase().substring(0,80); }
function esc(str) {
  if (str===null||str===undefined) return '';
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}
async function apiFetch(url) {
  const r = await fetch(url);
  const ct = r.headers.get('content-type')||'';
  if (!ct.includes('application/json')) throw new Error(`Server error ${r.status}`);
  const d = await r.json();
  if (!r.ok) throw new Error(d.error||`Error ${r.status}`);
  return d;
}

// ── NAVIGATION ────────────────────────────────────────────────
function hideAllViews() { document.querySelectorAll('.view').forEach(v=>v.classList.add('hidden')); }
function showView(id) {
  hideAllViews(); document.getElementById(id).classList.remove('hidden');
  document.getElementById('bottomNav').classList.remove('hidden');
  document.getElementById('navbar').classList.remove('hidden');
}
function switchTab(tab) {
  currentView=tab; navHistory=[];
  document.querySelectorAll('.nav-item').forEach(b=>b.classList.remove('active'));
  document.getElementById(`tab-${tab}`)?.classList.add('active');
  switch(tab) {
    case 'home':     showView('home-view');     if (!document.getElementById('home-view').innerHTML.trim()) loadHome(); break;
    case 'jadwal':   showView('jadwal-view');   loadJadwal();     break;
    case 'riwayat':  showView('riwayat-view');  loadRiwayat();    break;
    case 'stream':   showView('stream-view');   loadFavorites();  break;
    case 'settings': showView('settings-view'); renderSettings(); break;
  }
}
function goBack() {
  if (navHistory.length) { const p=navHistory.pop(); if (p==='detail'){showView('detail-view');return;} switchTab(p); }
  else switchTab('home');
}
function backFromWatch() {
  clearInterval(watchTimer); watchTimer=null;
  unsubscribeComments();
  if (navHistory.length) { const p=navHistory.pop(); if (p==='detail'){showView('detail-view');}else switchTab(p); }
  else switchTab('home');
}

// ── CARD TEMPLATES ────────────────────────────────────────────
function gridCard(a, opts={}) {
  const ep=a.episode||'';
  return `<div class="grid-card" onclick="loadDetail(this.dataset.url)" data-url="${esc(a.url)}">
    <div class="grid-card-img">
      <img src="${esc(a.image||'')}" alt="${esc(a.title)}" loading="lazy" onerror="this.style.opacity=0">
      ${ep?`<div class="grid-ep">Eps ${esc(ep)}</div>`:''}
      ${a.score&&!ep?`<div class="grid-score">★ ${esc(a.score)}</div>`:''}
      ${opts.badge?`<div class="grid-badge">${opts.badge}</div>`:''}
    </div>
    <div class="grid-card-title">${esc(a.title)}</div>
  </div>`;
}
function hCard(a) {
  const pct=Math.min(100,Math.round(((a.watchedSecs||0)/(a.totalSecs||1420))*100));
  return `<div class="h-card" onclick="loadDetail(this.dataset.url)" data-url="${esc(a.animeUrl||a.episodeUrl)}">
    <div class="h-card-img">
      <img src="${esc(a.image||'')}" alt="${esc(a.animeTitle||a.title||'')}" loading="lazy" onerror="this.style.opacity=0">
      <div class="h-card-badge">Eps ${esc(a.episode||'?')}</div>
      <div class="h-card-prog"><div class="h-card-prog-fill" style="width:${pct}%"></div></div>
    </div>
    <div class="h-card-title">${esc(a.animeTitle||a.title||'')}</div>
  </div>`;
}
function skeletonCards(n) {
  return Array(n).fill(0).map(()=>`<div class="h-card skeleton-card"><div class="skeleton-img"></div><div class="skeleton-text"></div></div>`).join('');
}

// ── HOME ──────────────────────────────────────────────────────
async function loadHome() {
  const c=document.getElementById('home-view');
  c.innerHTML=`
    <div style="height:200px;background:var(--surface);margin-bottom:20px;border-radius:0 0 12px 12px;display:flex;align-items:center;justify-content:center">
      <div class="loading-ring"></div>
    </div>
    <div class="section-header" style="padding:0 16px"><h2 class="section-title">Terakhir Ditonton</h2></div>
    <div class="h-scroll" style="padding:0 16px">${skeletonCards(4)}</div>
    <div class="section-header" style="padding:0 16px;margin-top:20px"><h2 class="section-title">🔥 New Update</h2></div>
    <div class="anime-grid-3" style="padding:0 16px">${Array(9).fill('<div class="grid-card"><div class="grid-card-img" style="background:var(--surface);border-radius:8px;aspect-ratio:3/4"></div><div class="skeleton-text" style="margin-top:6px"></div></div>').join('')}</div>`;

  try {
    const latest=await apiFetch(`${API}/latest`);
    if (!latest?.length){c.innerHTML='<div class="empty-state"><h3>Tidak ada data</h3><p>Coba lagi nanti</p></div>';return;}
    const top5=latest.slice(0,5);
    let html=`
      <div class="hero-section">
        <div class="hero-slider-wrap" id="heroSlider">
          ${top5.map((a,i)=>`
            <div class="hero-slide" onclick="loadDetail(this.dataset.url)" data-url="${esc(a.url)}">
              <img class="hero-bg" src="${esc(a.image)}" alt="${esc(a.title)}" loading="${i===0?'eager':'lazy'}" onerror="this.style.opacity=0">
              <div class="hero-overlay"></div>
              <div class="hero-info">
                <div class="hero-rank">#${i+1}</div>
                <div class="hero-title">${esc(a.title)}</div>
                ${a.episode?`<div class="hero-ep-badge">Eps ${esc(a.episode)}</div>`:''}
                <button class="hero-play-btn" onclick="event.stopPropagation();loadDetail(this.closest('[data-url]').dataset.url)">▶ Nonton Sekarang</button>
              </div>
            </div>`).join('')}
        </div>
        <div class="hero-dots" id="heroDots">${top5.map((_,i)=>`<div class="hero-dot${i===0?' active':''}" onclick="goToSlide(${i})"></div>`).join('')}</div>
      </div>`;

    html+=`<div class="ad-banner"><ins class="adsbygoogle" style="display:block;min-height:50px" data-ad-client="ca-pub-XXXXXXXXXXXXXXXX" data-ad-slot="XXXXXXXXXX" data-ad-format="auto" data-full-width-responsive="true"></ins></div>`;

    const hist=(await getHistory()).slice(0,8);
    if (hist.length) html+=`<div class="section-header"><h2 class="section-title">Terakhir Ditonton</h2><button class="see-all-btn" onclick="switchTab('riwayat')">Lihat Semua ›</button></div><div class="h-scroll">${hist.map(hCard).join('')}</div>`;

    html+=`<div class="section-header">
      <h2 class="section-title">🔥 New Update</h2>
      <div style="display:flex;gap:8px">
        <button class="see-all-btn" onclick="loadRandomAnime()">🎲 Acak</button>
        <button class="see-all-btn" onclick="switchTab('jadwal')">Jadwal ›</button>
      </div>
    </div><div class="anime-grid-3">${latest.slice(0,9).map(a=>gridCard(a,{badge:'New'})).join('')}</div>`;

    c.innerHTML=html;
    startHeroSlider();
    try{(window.adsbygoogle=window.adsbygoogle||[]).push({});}catch(_){}
    loadGenreSections(c);
  } catch(e) {
    c.innerHTML=`<div class="empty-state"><h3>Gagal memuat</h3><p>${esc(e.message)}</p><button class="detail-action-btn btn-primary" style="margin:12px auto 0;display:inline-flex;padding:10px 20px" onclick="document.getElementById('home-view').innerHTML='';loadHome()">🔄 Coba Lagi</button></div>`;
  }
}

// NEW: Random anime
async function loadRandomAnime() {
  loader(true);
  try {
    const a = await apiFetch(`${API}/random`);
    loader(false);
    loadDetail(a.url);
  } catch(e) { showToast(e.message); loader(false); }
}

async function loadGenreSections(container) {
  for (const g of HOME_GENRES) {
    try {
      const qs=g.q.split(' ');
      const results=await Promise.all(qs.map(q=>apiFetch(`${API}/search?q=${encodeURIComponent(q)}`).catch(()=>[])));
      const combined=[...new Map(results.flat().filter(Boolean).map(a=>[a.url,a])).values()].slice(0,12);
      if (!combined.length) continue;
      const sec=document.createElement('div');
      sec.innerHTML=`<div class="section-header"><h2 class="section-title">${g.label}</h2><button class="see-all-btn" onclick="doSearchGenre('${g.q.split(' ')[0]}')">Lihat Semua ›</button></div>
        <div class="h-scroll">${combined.map(a=>`
          <div class="h-card" onclick="loadDetail(this.dataset.url)" data-url="${esc(a.url)}">
            <div class="h-card-img"><img src="${esc(a.image||'')}" alt="${esc(a.title)}" loading="lazy" onerror="this.style.opacity=0">${a.score?`<div class="h-card-badge">★${esc(a.score)}</div>`:''}</div>
            <div class="h-card-title">${esc(a.title)}</div>
          </div>`).join('')}</div>`;
      container.appendChild(sec);
    } catch(_){}
  }
}

async function doSearchGenre(q) {
  loader(true);
  try {
    const data=await apiFetch(`${API}/search?q=${encodeURIComponent(q)}`);
    navHistory.push(currentView); currentView='search'; hideAllViews();
    const hv=document.getElementById('home-view'); hv.classList.remove('hidden');
    document.getElementById('bottomNav').classList.remove('hidden');
    hv.innerHTML=`<div class="section-header" style="padding:16px 16px 0"><h2 class="section-title">Genre: ${esc(q)}</h2></div><div class="anime-grid-3">${(data||[]).map(gridCard).join('')}</div>`;
  } catch(e){showToast(e.message);}finally{loader(false);}
}

function goToSlide(i) {
  const s=document.getElementById('heroSlider'); if(!s) return;
  s.scrollTo({left:i*s.offsetWidth,behavior:'smooth'});
  document.querySelectorAll('.hero-dot').forEach((d,j)=>d.classList.toggle('active',i===j));
  heroIdx=i;
}
function startHeroSlider() {
  clearInterval(heroTimer);
  const s=document.getElementById('heroSlider'); if(!s) return;
  const total=s.children.length;
  heroTimer=setInterval(()=>{
    if(document.getElementById('home-view')?.classList.contains('hidden')) return;
    heroIdx=(heroIdx+1)%total; goToSlide(heroIdx);
  },4500);
}

// ── JADWAL ────────────────────────────────────────────────────
async function loadJadwal() {
  const today=new Date(); jadwalDay=jadwalDay||DAYS[today.getDay()];
  renderDayStrip(today);
  if (!jadwalCache) {
    document.getElementById('jadwal-content').innerHTML='<div style="padding:40px 0;text-align:center"><div class="loading-ring" style="margin:auto"></div></div>';
    try { jadwalCache=await apiFetch(`${API}/jadwal`); }
    catch(e){document.getElementById('jadwal-content').innerHTML=`<div class="empty-state"><h3>Gagal memuat jadwal</h3><p>${esc(e.message)}</p><button class="detail-action-btn btn-primary" style="margin-top:12px;padding:10px 20px" onclick="jadwalCache=null;loadJadwal()">🔄 Coba Lagi</button></div>`;return;}
  }
  renderJadwal(jadwalCache[jadwalDay]||[]); updateDayNav();
}
function renderDayStrip(today) {
  const todayKey=DAYS[today.getDay()];
  document.getElementById('dayStrip').innerHTML=DAYS.map((d,i)=>{
    const dt=new Date(today); dt.setDate(today.getDate()-today.getDay()+i);
    return `<div class="day-pill ${d===jadwalDay?'active':''}" onclick="selectDay('${d}')">
      <span class="day-name">${DNAMES[i]}</span><span class="day-date">${dt.getDate()}</span>
      ${d===todayKey&&d!==jadwalDay?'<div class="day-dot"></div>':''}
    </div>`;
  }).join('');
}
function selectDay(day){jadwalDay=day;renderDayStrip(new Date());renderJadwal(jadwalCache?.[day]||[]);updateDayNav();}
function updateDayNav(){
  const i=DAYS.indexOf(jadwalDay);
  document.getElementById('prevDayBtn').textContent=`← ${DNAMES[(i+6)%7]}`;
  document.getElementById('nextDayBtn').textContent=`${DNAMES[(i+1)%7]} →`;
}
document.getElementById('prevDayBtn').onclick=()=>selectDay(DAYS[(DAYS.indexOf(jadwalDay)+6)%7]);
document.getElementById('nextDayBtn').onclick=()=>selectDay(DAYS[(DAYS.indexOf(jadwalDay)+1)%7]);

function renderJadwal(items) {
  const now=new Date();
  if (!items||!items.length){document.getElementById('jadwal-content').innerHTML='<div class="empty-state"><h3>Tidak ada jadwal</h3><p>Tidak ada anime tayang hari ini</p></div>';return;}
  document.getElementById('jadwal-content').innerHTML=items.map(a=>{
    let cls='upcoming',txt='Belum Tayang';
    if (a.time){const[h,m]=a.time.split(':').map(Number);const t=new Date();t.setHours(h,m,0,0);if(now>t){cls='aired';txt='Sudah Tayang';}}
    if (a.status==='FINISHED') { cls='ended'; txt='Selesai'; }
    return `<div class="jadwal-item status-${cls}" onclick="doSearchByTitle(this.dataset.title)" data-title="${esc(a.title)}">
      <div class="jadwal-time">${esc(a.time||'??:??')}</div>
      <div class="jadwal-thumb"><img src="${esc(a.image||'')}" alt="${esc(a.title)}" loading="lazy" onerror="this.style.opacity=0"></div>
      <div class="jadwal-info">
        <div class="jadwal-title">${esc(a.title)}</div>
        ${a.episode?`<div class="jadwal-ep">Episode ${esc(a.episode)}</div>`:''}
        <div class="jadwal-stats">${a.score?`<span class="jadwal-score">★ ${esc(a.score)}</span>`:''}</div>
        <div class="jadwal-status ${cls}">${txt}</div>
      </div>
    </div>`;
  }).join('');
}

async function doSearchByTitle(title) {
  if (!title) return;
  loader(true);
  try {
    const results=await apiFetch(`${API}/search?q=${encodeURIComponent(title)}`);
    if (results&&results.length>0) {
      const words=title.toLowerCase().split(' ').slice(0,2);
      const exact=results.find(r=>words.every(w=>r.title.toLowerCase().includes(w)));
      navHistory.push(currentView); loader(false);
      loadDetail((exact||results[0]).url);
    } else { showToast(`Tidak ditemukan: ${title}`); loader(false); }
  } catch(e){showToast(e.message);loader(false);}
}

// ── RIWAYAT ───────────────────────────────────────────────────
async function loadRiwayat() {
  const c=document.getElementById('riwayat-content');
  const history=await getHistory();
  if (!history.length){c.innerHTML='<div class="empty-state"><svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg><h3>Belum ada riwayat</h3><p>Anime yang ditonton akan muncul di sini</p></div>';return;}

  const grouped={};
  history.forEach(h=>{
    const lw=h.lastWatched||Date.now();
    const label=new Date(lw).toLocaleDateString('id-ID',{day:'numeric',month:'long',year:'numeric'});
    (grouped[label]=grouped[label]||[]).push(h);
  });

  c.innerHTML=Object.entries(grouped).map(([date,items])=>`
    <div class="riwayat-date-group">
      <div class="riwayat-date-label">${date}</div>
      ${items.map(h=>{
        const lw=h.lastWatched||Date.now();
        const pct=Math.min(100,Math.round(((h.watchedSecs||0)/(h.totalSecs||1420))*100));
        const time=new Date(lw).toLocaleTimeString('id-ID',{hour:'2-digit',minute:'2-digit'});
        const isSel=selectedRiw.has(h.episodeUrl);
        return `<div class="riwayat-item ${isSel?'selected':''}" data-ep="${esc(h.episodeUrl)}" onclick="onRiwayatClick(this.dataset.ep)">
          <div class="riwayat-thumb"><img src="${esc(h.image||'')}" alt="${esc(h.animeTitle||h.title||'')}" loading="lazy" onerror="this.style.opacity=0"></div>
          <div class="riwayat-info">
            <div class="riwayat-title">${esc(h.animeTitle||h.title||'Tidak diketahui')}</div>
            <div class="riwayat-ep">${esc(h.episodeTitle||(h.episode?'Episode '+h.episode:''))}</div>
            <div class="riwayat-prog-wrap">
              <div class="riwayat-prog-bar"><div class="riwayat-prog-fill" style="width:${pct}%"></div></div>
              <div class="riwayat-prog-time">${fmtTime(h.watchedSecs||0)} / ${fmtTime(h.totalSecs||1420)}</div>
            </div>
          </div>
          <div class="riwayat-right">
            <div class="riwayat-watched-time">${time}</div>
            <button class="riwayat-del-btn" onclick="event.stopPropagation();deleteOneRiwayat(this.dataset.ep)" data-ep="${esc(h.episodeUrl)}" title="Hapus">✕</button>
          </div>
        </div>`;
      }).join('')}
    </div>`).join('')+
    (multiSelect?`<div class="riwayat-actions"><button class="riwayat-action-btn single" onclick="exitMulti()">Batal</button><button class="riwayat-action-btn danger" onclick="deleteSelected()">Hapus (${selectedRiw.size})</button></div>`:'');

  c.querySelectorAll('.riwayat-item').forEach(el=>{
    let t;
    el.addEventListener('touchstart',()=>{t=setTimeout(()=>onRiwayatLong(el.dataset.ep),600);},{passive:true});
    el.addEventListener('touchend',  ()=>clearTimeout(t),{passive:true});
    el.addEventListener('touchmove', ()=>clearTimeout(t),{passive:true});
  });
}

async function onRiwayatClick(epUrl) {
  if (multiSelect){selectedRiw.has(epUrl)?selectedRiw.delete(epUrl):selectedRiw.add(epUrl);loadRiwayat();return;}
  const h=await idbGet('history',epUrl);
  if (h) epRegSet(epUrl,{animeTitle:h.animeTitle||'',animeUrl:h.animeUrl||epUrl,image:h.image||'',episode:h.episode||'',episodeTitle:h.episodeTitle||''});
  loadWatch(epUrl);
}
function onRiwayatLong(epUrl){multiSelect=true;selectedRiw.add(epUrl);navigator.vibrate&&navigator.vibrate(30);loadRiwayat();}
function exitMulti(){multiSelect=false;selectedRiw.clear();loadRiwayat();}
async function deleteSelected(){for(const u of selectedRiw)await deleteHistory(u);multiSelect=false;selectedRiw.clear();showToast('Riwayat dihapus');loadRiwayat();}
async function deleteOneRiwayat(epUrl) {
  if (!confirm('Hapus riwayat ini?')) return;
  await deleteHistory(epUrl); showToast('Dihapus'); loadRiwayat();
}

// ── FAVORITES ─────────────────────────────────────────────────
async function loadFavorites(){
  const c=document.getElementById('stream-content');
  const favs=await getAllFavs();
  if (!favs.length){c.innerHTML='<div class="empty-state"><svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78z"/></svg><h3>Belum ada favorit</h3><p>Tap ♡ di halaman detail untuk menyimpan</p></div>';return;}
  c.innerHTML=`<div class="anime-grid-3" style="padding:16px">${favs.map(a=>`<div class="grid-card" onclick="loadDetail(this.dataset.url)" data-url="${esc(a.url)}"><div class="grid-card-img"><img src="${esc(a.image||'')}" alt="${esc(a.title)}" loading="lazy" onerror="this.style.opacity=0">${a.score?`<div class="grid-score">★ ${esc(a.score)}</div>`:''}</div><div class="grid-card-title">${esc(a.title)}</div></div>`).join('')}</div>`;
}

// ── DETAIL ────────────────────────────────────────────────────
async function loadDetail(url) {
  navHistory.push(currentView); currentView='detail';
  hideAllViews(); document.getElementById('detail-view').classList.remove('hidden');
  document.getElementById('bottomNav').classList.add('hidden');
  const dc=document.getElementById('detail-content');
  dc.innerHTML='<div style="padding:50px 0;text-align:center"><div class="loading-ring" style="margin:auto"></div></div>';
  loader(true);
  try {
    const data=await apiFetch(`${API}/detail?url=${encodeURIComponent(url)}`);
    const info=data.info||{};
    const score    = data.score||info.skor||info.score||info.rating||'';
    const status   = info.status||'Ongoing';
    const type     = info.tipe||info.type||'TV';
    const studio   = info.studio||'-';
    const totalEps = info.total_episode||info.episode||'?';
    const duration = info.durasi||info.duration||'23 Menit';
    const genreRaw = info.genre||info.genres||'Anime';
    const genres   = genreRaw.split(',').map(g=>g.trim()).filter(Boolean).slice(0,5);
    const eps=data.episodes||[];
    const isFav=await getFav(url);
    const watchedMap={};
    (await getHistory()).forEach(h=>{if(h.animeUrl===url)watchedMap[h.episodeUrl]=true;});
    const newest=eps[0], oldest=eps[eps.length-1];
    const newestNum=newest?getEpNum(newest.title):'';

    window._curAnime={title:data.title,url,image:data.image||'',episodes:eps};
    eps.forEach(ep=>epRegSet(ep.url,{animeTitle:data.title,animeUrl:url,image:data.image||'',episode:getEpNum(ep.title),episodeTitle:ep.title}));

    dc.innerHTML=`
      <div class="detail-banner"><img src="${esc(data.image||'')}" alt="${esc(data.title)}" loading="eager" onerror="this.style.opacity=0"><div class="detail-banner-overlay"></div></div>
      <div class="detail-main">
        <h1 class="detail-title">${esc(data.title)}</h1>
        ${info.japanese?`<div class="detail-alt-title">${esc(info.japanese)}</div>`:''}
        <div class="detail-badges">
          ${score?`<span class="detail-badge badge-score">★ ${esc(score)}</span>`:''}
          <span class="detail-badge badge-status">${esc(status)}</span>
          <span class="detail-badge badge-type">${esc(type)}</span>
        </div>
        <div class="detail-row">
          <div class="detail-poster"><img src="${esc(data.image||'')}" alt="${esc(data.title)}" onerror="this.style.opacity=0"></div>
          <div class="detail-info-col">
            <div class="detail-meta-item"><span class="detail-meta-label">Studio</span><span class="detail-meta-val">${esc(studio)}</span></div>
            <div class="detail-meta-item"><span class="detail-meta-label">Total Eps</span><span class="detail-meta-val">${esc(String(totalEps))}</span></div>
            <div class="detail-meta-item"><span class="detail-meta-label">Durasi</span><span class="detail-meta-val">${esc(duration)}</span></div>
            <div class="detail-meta-item"><span class="detail-meta-label">Genre</span><span class="detail-meta-val">${esc(genres.join(', '))}</span></div>
          </div>
        </div>
        ${data.description?`<div class="detail-synopsis collapsed" id="synopsisEl">${esc(data.description)}</div><button class="read-more-btn" id="synBtn" onclick="toggleSynopsis()">Selengkapnya ▼</button>`:''}
        <div class="detail-action-row">
          ${oldest?`<button class="detail-action-btn btn-primary" onclick="loadWatch(this.dataset.url)" data-url="${esc(oldest.url)}">▶ Nonton</button>`:''}
          ${newest?`<button class="detail-action-btn btn-secondary" onclick="loadWatch(this.dataset.url)" data-url="${esc(newest.url)}">▶ Terbaru (${esc(newestNum)})</button>`:''}
          <button class="fav-btn ${isFav?'active':''}" id="favBtn"
            onclick="toggleFavBtn(this.dataset.url,this.dataset.title,this.dataset.image,this.dataset.score)"
            data-url="${esc(url)}" data-title="${esc(data.title)}" data-image="${esc(data.image||'')}" data-score="${esc(score)}">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="${isFav?'currentColor':'none'}" stroke="currentColor" stroke-width="2"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78z"/></svg>
          </button>
        </div>
      </div>
      <div class="ep-section">
        <div class="ep-section-header">
          <span class="ep-section-title">Daftar Episode</span>
          ${eps.length?`<span class="ep-range-badge">1 – ${esc(newestNum)}</span>`:''}
        </div>
        <div class="ep-grid">
          ${eps.map(ep=>{
            const n=getEpNum(ep.title);
            const w=watchedMap[ep.url]||watchedMap[ep.url?.replace('v1.','v2.')];
            return `<div class="ep-box ${w?'watched':''}" title="${esc(ep.title)}" onclick="loadWatch(this.dataset.url)" data-url="${esc(ep.url)}">${esc(n)}</div>`;
          }).join('')}
        </div>
      </div>`;

    const synEl=document.getElementById('synopsisEl');
    const synBtn=document.getElementById('synBtn');
    if (synEl&&synBtn&&synEl.scrollHeight<=synEl.clientHeight+5) synBtn.style.display='none';
  } catch(e) {
    dc.innerHTML=`<div class="empty-state"><h3>Gagal memuat</h3><p>${esc(e.message)}</p><button class="detail-action-btn btn-primary" style="margin:12px auto 0;display:inline-flex;padding:10px 20px" onclick="loadDetail(this.dataset.url)" data-url="${esc(url)}">🔄 Coba Lagi</button></div>`;
  } finally{loader(false);}
}
function toggleSynopsis(){
  const el=document.getElementById('synopsisEl'),btn=document.getElementById('synBtn');if(!el)return;
  btn&&(btn.textContent=el.classList.toggle('collapsed')?'Selengkapnya ▼':'Lebih sedikit ▲');
}
async function toggleFavBtn(url,title,image,score){
  const isFav=await getFav(url);
  const b=document.getElementById('favBtn');
  if(isFav){await delFav(url);showToast('Dihapus dari favorit');if(b){b.classList.remove('active');b.querySelector('svg').setAttribute('fill','none');}}
  else{await saveFav({url,title,image,score});showToast('Ditambahkan ke favorit ♡');if(b){b.classList.add('active');b.querySelector('svg').setAttribute('fill','currentColor');}}
}

// ── WATCH ─────────────────────────────────────────────────────
async function loadWatch(epUrl) {
  if (!epUrl){showToast('URL episode tidak valid');return;}
  let meta=epRegGet(epUrl)||{};
  if (!meta.animeTitle) {
    const h=await idbGet('history',epUrl);
    if (h) meta={animeTitle:h.animeTitle||'',animeUrl:h.animeUrl||epUrl,image:h.image||'',episode:h.episode||'',episodeTitle:h.episodeTitle||''};
  }
  currentEpUrl=epUrl; navHistory.push(currentView); currentView='watch';
  hideAllViews(); document.getElementById('watch-view').classList.remove('hidden');
  document.getElementById('bottomNav').classList.add('hidden');
  document.getElementById('watch-content').innerHTML='<div style="padding:50px 0;text-align:center"><div class="loading-ring" style="margin:auto"></div></div>';
  clearInterval(watchTimer); unsubscribeComments(); loader(true);

  const histEntry={
    episodeUrl:   epUrl,  animeUrl:     meta.animeUrl||epUrl,
    animeTitle:   meta.animeTitle||'Anime', episodeTitle: meta.episodeTitle||'',
    episode:      meta.episode||'',         image:        meta.image||'',
    watchedSecs:  0, totalSecs:1420, lastWatched:Date.now(),
  };
  const prev=await idbGet('history',epUrl);
  if (prev){histEntry.watchedSecs=prev.watchedSecs;histEntry.totalSecs=prev.totalSecs;}
  await saveHistory(histEntry);

  try {
    const data=await apiFetch(`${API}/watch?url=${encodeURIComponent(epUrl)}`);
    renderWatchScreen(data,meta,epUrl);
    startWatchTimer(epUrl);
  } catch(e) {
    document.getElementById('watch-content').innerHTML=`
      <div class="stream-error">
        <svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="#666" stroke-width="1.5"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
        <p>${esc(e.message)}</p>
        <div class="stream-error-btns">
          <button class="detail-action-btn btn-primary" style="flex:0;padding:10px 22px" onclick="loadWatch(this.dataset.url)" data-url="${esc(epUrl)}">🔄 Coba Lagi</button>
          <button class="detail-action-btn btn-secondary" style="flex:0;padding:10px 22px" onclick="backFromWatch()">← Kembali</button>
        </div>
      </div>`;
  } finally{loader(false);}
}

function renderWatchScreen(data,meta,epUrl){
  const streams=data.streams||[];
  const first=streams[0];
  const epNum=meta.episode||getEpNum(data.title||'');
  const quality=first?(first.server.match(/\d+p/i)?.[0]||'HD'):'HD';

  document.getElementById('watch-content').innerHTML=`
    <div class="player-wrap" id="playerWrap">
      ${first
        ?`<iframe id="videoPlayer" src="${esc(first.url)}" allowfullscreen allow="autoplay;fullscreen" scrolling="no" frameborder="0"></iframe>`
        :`<div class="stream-error">
            <svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="#666" stroke-width="1.5"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
            <p>Stream tidak tersedia untuk episode ini</p>
            <div class="stream-error-btns">
              <button class="detail-action-btn btn-primary" style="flex:0;padding:10px 22px" onclick="loadWatch(this.dataset.url)" data-url="${esc(epUrl)}">🔄 Coba Lagi</button>
              <button class="detail-action-btn btn-secondary" style="flex:0;padding:10px 22px" onclick="backFromWatch()">← Episode Lain</button>
            </div>
          </div>`
      }
    </div>
    <div class="watch-meta">
      <div class="watch-title">${esc(data.title||meta.animeTitle||'')}</div>
      <div class="watch-ep-info">
        ${meta.image?`<div class="watch-anime-link"><div class="watch-anime-thumb"><img src="${esc(meta.image)}" alt="" onerror="this.style.opacity=0"></div><span class="watch-anime-name">${esc(meta.animeTitle||'')}</span></div>`:''}
        <span class="watch-ep-num">Episode ${esc(String(epNum))}</span>
      </div>
    </div>
    <div class="watch-actions">
      <button class="watch-action-btn ${isLiked(epUrl)?'active':''}" id="likeBtn" onclick="toggleLike(this.dataset.ep)" data-ep="${esc(epUrl)}">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 9V5a3 3 0 0 0-3-3l-4 9v11h11.28a2 2 0 0 0 2-1.7l1.38-9a2 2 0 0 0-2-2.3H14z"/><path d="M7 22H4a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2h3"/></svg>
        ${getLikeCount(epUrl)}
      </button>
      <button class="watch-action-btn" onclick="shareEpisode('${esc(data.title||meta.animeTitle||'')}')">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg>
        Share
      </button>
      ${first?`<button class="watch-action-btn watch-quality-btn"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2"/></svg>${esc(quality)}</button>`:''}
    </div>
    ${streams.length>1?`
    <div class="server-section">
      <div class="server-section-label">Pilih Server:</div>
      <div class="server-list">${streams.map((s,i)=>`<button class="server-tag ${i===0?'active':''}" onclick="changeServer(this.dataset.url,this)" data-url="${esc(s.url)}">${esc(s.server)}</button>`).join('')}</div>
    </div>`:''}
    <div class="ep-list-section" id="epListSection"></div>
    <div id="commentsSection"></div>`;

  loadEpListForWatch(meta.animeUrl||window._curAnime?.url, epUrl, meta);
  initComments(slugify(epUrl));
}

async function loadEpListForWatch(animeUrl,curEpUrl,meta){
  const sec=document.getElementById('epListSection'); if(!sec) return;
  let eps=[];
  if (window._curAnime?.url===animeUrl&&window._curAnime?.episodes?.length) {
    eps=window._curAnime.episodes;
  } else if (animeUrl) {
    try {
      const data=await apiFetch(`${API}/detail?url=${encodeURIComponent(animeUrl)}`);
      eps=data.episodes||[];
      window._curAnime={title:data.title,url:animeUrl,image:data.image||'',episodes:eps};
      eps.forEach(ep=>epRegSet(ep.url,{animeTitle:data.title,animeUrl,image:data.image||'',episode:getEpNum(ep.title),episodeTitle:ep.title}));
    } catch(_){return;}
  }
  if (!eps.length) return;
  sec.innerHTML=`
    <div class="ep-list-header">
      <span class="ep-list-title">Episode Lainnya</span>
      <span class="ep-range-badge">1 – ${esc(getEpNum(eps[0].title))}</span>
    </div>
    <div class="ep-scroll">
      ${eps.map(ep=>{
        const n=getEpNum(ep.title);
        const isCur=ep.url===curEpUrl||ep.url?.replace('v1.','v2.')===curEpUrl;
        return `<div class="ep-box ${isCur?'current':''}" title="${esc(ep.title)}" onclick="loadWatch(this.dataset.url)" data-url="${esc(ep.url)}">${esc(n)}</div>`;
      }).join('')}
    </div>`;
  sec.querySelector('.current')?.scrollIntoView({behavior:'smooth',block:'nearest',inline:'center'});
}

function changeServer(url,btn){
  const iframe=document.getElementById('videoPlayer'); if(iframe) iframe.src=url;
  document.querySelectorAll('.server-tag').forEach(b=>b.classList.remove('active'));
  btn.classList.add('active'); showToast('Server diganti');
}
function startWatchTimer(epUrl){
  clearInterval(watchTimer);
  watchTimer=setInterval(async()=>{
    const e=await idbGet('history',epUrl);
    if(e){e.watchedSecs=Math.min((e.watchedSecs||0)+10,e.totalSecs||1420);e.lastWatched=Date.now();await idbPut('history',e);}
  },10000);
}

// Like system (localStorage untuk persistensi tanpa login)
function likeKey(epUrl){ return `like_${slugify(epUrl)}`; }
function isLiked(epUrl){ return localStorage.getItem(likeKey(epUrl))==='1'; }
function getLikeCount(epUrl){
  const base=parseInt(localStorage.getItem(likeKey(epUrl)+'_count')||'0')||Math.floor(Math.random()*500+50);
  if (!localStorage.getItem(likeKey(epUrl)+'_count')) localStorage.setItem(likeKey(epUrl)+'_count',base);
  return base+(isLiked(epUrl)?1:0);
}
function toggleLike(epUrl){
  const was=isLiked(epUrl);
  localStorage.setItem(likeKey(epUrl),was?'0':'1');
  const btn=document.getElementById('likeBtn');
  if(btn){
    btn.classList.toggle('active',!was);
    const base=parseInt(localStorage.getItem(likeKey(epUrl)+'_count')||'50');
    btn.childNodes[btn.childNodes.length-1].textContent=` ${base+(!was?1:0)}`;
  }
  showToast(was?'Like dibatalkan':'👍 Disukai!');
}

// NEW: Share episode
async function shareEpisode(title){
  const shareData={ title:`NimeStream — ${title}`, text:`Nonton ${title} di NimeStream!`, url: window.location.href };
  if (navigator.share) { try { await navigator.share(shareData); return; } catch(_){} }
  // Fallback: copy ke clipboard
  try { await navigator.clipboard.writeText(window.location.href); showToast('🔗 Link disalin!'); }
  catch(_){ showToast('Share tidak tersedia di browser ini'); }
}

// ── COMMENTS (Realtime) ───────────────────────────────────────
let _commentEpKey = null;

function unsubscribeComments(){
  if (_realtimeSub){ sb?.removeChannel(_realtimeSub); _realtimeSub=null; }
  _commentEpKey=null;
}

function initComments(epKey){
  _commentEpKey=epKey;
  renderCommentBox(epKey);
  fetchComments(epKey);

  // NEW: Realtime subscription supaya komentar baru langsung muncul
  if (SB_READY && sb) {
    unsubscribeComments();
    _commentEpKey=epKey;
    _realtimeSub = sb.channel(`comments:${epKey}`)
      .on('postgres_changes', { event:'INSERT', schema:'public', table:'comments', filter:`episode_key=eq.${epKey}` },
        payload => { prependComment(payload.new); updateCommentCount(1); }
      )
      .subscribe();
  }
}

function renderCommentBox(epKey){
  const sec=document.getElementById('commentsSection'); if(!sec) return;
  sec.innerHTML=`
    <div class="comments-section">
      <div class="comments-header">
        <div class="comments-count" id="commentsCount">Komentar</div>
        <div class="comment-tabs">
          <button class="comment-tab active" id="ctabNew" onclick="switchCommentSort('new',this)">Terbaru</button>
          <button class="comment-tab" id="ctabTop" onclick="switchCommentSort('top',this)">Top</button>
        </div>
      </div>
      ${currentUser
        ?`<div class="comment-input-row">
            <div class="comment-avatar">${currentUser.user_metadata?.avatar_url?`<img src="${currentUser.user_metadata.avatar_url}" alt="">`:'😊'}</div>
            <textarea class="comment-input" id="commentInput" placeholder="Tulis komentar..." rows="1" oninput="autoResizeTA(this)"></textarea>
            <button class="comment-send" onclick="submitComment(this.dataset.key)" data-key="${esc(epKey)}">Kirim</button>
          </div>`
        :`<div class="comment-login-prompt"><p>Login untuk berkomentar</p><button class="login-cta-btn" onclick="handleAuthClick()">Login</button></div>`
      }
      <div class="comment-list" id="commentList"><div class="comment-loading">Memuat komentar...</div></div>
    </div>`;
}

let _commentSort = 'new';
function switchCommentSort(sort, btn){
  _commentSort = sort;
  document.querySelectorAll('.comment-tab').forEach(b=>b.classList.remove('active'));
  btn.classList.add('active');
  if (_commentEpKey) fetchComments(_commentEpKey);
}

async function fetchComments(epKey){
  const list=document.getElementById('commentList'); if(!list) return;
  if (!SB_READY || !sb) { list.innerHTML='<div class="comment-loading">Aktifkan Supabase untuk komentar</div>'; return; }

  list.innerHTML='<div class="comment-loading">Memuat...</div>';
  const col = sb.from('comments').select('*').eq('episode_key',epKey).limit(60);
  const {data} = _commentSort==='top'
    ? await col.order('likes',{ascending:false})
    : await col.order('created_at',{ascending:false});

  const cnt=document.getElementById('commentsCount');
  if (cnt) cnt.textContent=`${(data||[]).length} Komentar`;
  if (!data?.length) { list.innerHTML='<div class="comment-loading">Belum ada komentar. Jadilah yang pertama!</div>'; return; }
  list.innerHTML=data.map(commentHtml).join('');
}

function commentHtml(c){
  return `<div class="comment-item" data-id="${c.id}">
    <div class="comment-avatar">${c.avatar_url?`<img src="${esc(c.avatar_url)}" alt="">`:'😊'}</div>
    <div class="comment-body">
      <div class="comment-meta">
        <span class="comment-name">${esc(c.username||'Anonim')}</span>
        <span class="comment-time">${timeAgo(new Date(c.created_at).getTime())}</span>
      </div>
      <div class="comment-text">${esc(c.text||'')}</div>
      <button class="comment-like-btn" onclick="likeComment(this.dataset.id,${c.likes||0},this)" data-id="${c.id}">
        👍 ${c.likes||0}
      </button>
    </div>
  </div>`;
}

function prependComment(c){
  const list=document.getElementById('commentList'); if(!list) return;
  const el=document.createElement('div');
  el.innerHTML=commentHtml(c);
  const first=list.firstChild;
  if (first) list.insertBefore(el.firstChild, first);
  else list.appendChild(el.firstChild);
}
function updateCommentCount(delta){
  const cnt=document.getElementById('commentsCount'); if(!cnt) return;
  const n=parseInt(cnt.textContent)||0;
  cnt.textContent=`${n+delta} Komentar`;
}

async function submitComment(epKey){
  if(!currentUser){showToast('Login dulu ya!');return;}
  if(!SB_READY||!sb){showToast('Supabase belum dikonfigurasi');return;}
  const inp=document.getElementById('commentInput');
  const text=inp?.value.trim(); if(!text){showToast('Komentar tidak boleh kosong');return;}
  if(text.length>1000){showToast('Komentar terlalu panjang (max 1000 karakter)');return;}
  const btn=document.querySelector('.comment-send');
  if(btn){btn.textContent='Mengirim...';btn.disabled=true;}
  const username=currentUser.user_metadata?.username||currentUser.email?.split('@')[0]||'User';
  const{error}=await sb.from('comments').insert({
    episode_key:epKey, user_id:currentUser.id,
    username, avatar_url:currentUser.user_metadata?.avatar_url||'', text
  });
  if(btn){btn.textContent='Kirim';btn.disabled=false;}
  if(error){showToast('Gagal kirim komentar: '+error.message);return;}
  if(inp) inp.value='';
  showToast('Komentar terkirim! 💬');
  // Jika tidak ada realtime, refresh manual
  if (!_realtimeSub) fetchComments(epKey);
}

async function likeComment(commentId, currentLikes, btn){
  if (!SB_READY||!sb){showToast('Login dulu');return;}
  const newLikes=currentLikes+1;
  await sb.from('comments').update({likes:newLikes}).eq('id',commentId);
  if(btn){btn.textContent=`👍 ${newLikes}`;}
}

function autoResizeTA(el){
  el.style.height='auto';
  el.style.height=Math.min(el.scrollHeight,120)+'px';
}

// ── SETTINGS ──────────────────────────────────────────────────
function renderSettings(){
  const c=document.getElementById('settings-content');
  const isLight=document.documentElement.hasAttribute('data-theme');
  c.innerHTML=`
    ${currentUser
      ?`<div class="user-profile-card">
          <div class="profile-avatar">${currentUser.user_metadata?.avatar_url?`<img src="${currentUser.user_metadata.avatar_url}" alt="">`:(currentUser.email||'U')[0].toUpperCase()}</div>
          <div><div class="profile-name">${esc(currentUser.user_metadata?.username||currentUser.email?.split('@')[0]||'User')}</div><div class="profile-email">${esc(currentUser.email||'')}</div></div>
          <button class="profile-logout-btn" onclick="doLogout()">Logout</button>
        </div>`
      :`<div class="settings-section" style="margin-top:16px"><button class="login-cta-btn" style="width:calc(100% - 32px);margin:0 16px;justify-content:center;padding:14px;border-radius:12px;display:flex;align-items:center;gap:8px" onclick="handleAuthClick()"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>Login / Daftar</button></div>`}
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
        <div class="settings-item"><div class="settings-item-left"><div class="settings-item-icon">⚡</div><div><div class="settings-item-title">NimeStream</div><div class="settings-item-sub">v12.0 — Powered by Samehadaku</div></div></div></div>
        <div class="settings-item"><div class="settings-item-left"><div class="settings-item-icon">🛢️</div><div><div class="settings-item-title">Supabase</div><div class="settings-item-sub">${SB_READY?'✅ Terhubung':'⚠️ Belum dikonfigurasi'}</div></div></div></div>
        <div class="settings-item">
          <div class="settings-item-left"><div class="settings-item-icon">🤖</div><div><div class="settings-item-title">Bot Telegram</div><div class="settings-item-sub">Daftar akun via @NimeStreamBot</div></div></div>
          <a href="https://t.me/NimeStreamBot" target="_blank" class="see-all-btn" style="padding:0 12px">Buka ›</a>
        </div>
        ${_pwaPrompt?`<div class="settings-item" onclick="installPWA()"><div class="settings-item-left"><div class="settings-item-icon">📱</div><div><div class="settings-item-title">Install Aplikasi</div><div class="settings-item-sub">Tambahkan ke layar utama</div></div></div><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" stroke-width="2"><path d="M9 18l6-6-6-6"/></svg></div>`:''}
      </div>
      <div class="settings-section" style="margin-top:12px">
        <div class="settings-section-title">Data</div>
        <div class="settings-item" onclick="doClearHistory()"><div class="settings-item-left"><div class="settings-item-icon">🗑️</div><div><div class="settings-item-title">Hapus Semua Riwayat</div></div></div><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" stroke-width="2"><path d="M9 18l6-6-6-6"/></svg></div>
      </div>
    </div>`;
}
async function doLogout(){if(SB_READY&&sb)await sb.auth.signOut();currentUser=null;renderAuthBtn();renderSettings();showToast('Logout berhasil');}
async function doClearHistory(){
  if(!confirm('Hapus semua riwayat?'))return;
  await idbClear('history');
  if(SB_READY&&sb&&currentUser)await sb.from('watch_history').delete().eq('user_id',currentUser.id);
  document.getElementById('home-view').innerHTML=''; showToast('Riwayat dihapus');
}

// ── PWA INSTALL ───────────────────────────────────────────────
let _pwaPrompt=null;
window.addEventListener('beforeinstallprompt',e=>{
  e.preventDefault(); _pwaPrompt=e;
  // Tampilkan banner install
  const banner=document.getElementById('pwa-banner');
  if(banner) banner.classList.remove('hidden');
});
async function installPWA(){
  if(!_pwaPrompt){showToast('Sudah terinstall atau tidak didukung browser ini');return;}
  _pwaPrompt.prompt();
  const{outcome}=await _pwaPrompt.userChoice;
  if(outcome==='accepted'){showToast('Aplikasi berhasil diinstall! 🎉');_pwaPrompt=null;document.getElementById('pwa-banner')?.classList.add('hidden');}
}

// ── OFFLINE INDICATOR ─────────────────────────────────────────
function updateOnlineStatus(){
  const el=document.getElementById('offline-bar');
  if(!el) return;
  if(navigator.onLine){ el.classList.add('hidden'); }
  else { el.classList.remove('hidden'); }
}
window.addEventListener('online', updateOnlineStatus);
window.addEventListener('offline', updateOnlineStatus);

// ── SCROLL TO TOP ─────────────────────────────────────────────
window.addEventListener('scroll',()=>{
  const btn=document.getElementById('scrollTopBtn');
  if(!btn) return;
  btn.classList.toggle('visible', window.scrollY > 300);
},{passive:true});
function scrollToTop(){ window.scrollTo({top:0,behavior:'smooth'}); }

// ── INIT ──────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded',()=>{
  switchTab('home');
  renderAuthBtn();
  updateOnlineStatus();
});
