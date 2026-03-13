// ══════════════════════════════════════════════════════════
// LoanDesk CRM v2.0 — app.js
// Dual Module: Business Loan + Doctor Loan
// ══════════════════════════════════════════════════════════

const CONFIG = {
  // 🔧 Replace with your Google Apps Script Web App URL
  BIZ_API_URL:  'YOUR_BUSINESS_SHEET_API_URL',
  DOC_API_URL:  'YOUR_DOCTOR_SHEET_API_URL',

  AUTH: { username: 'admin', password: 'doctor@2024' },
  SESSION_KEY:  'loandesk_session',
  BIZ_KEY:      'loandesk_biz_leads',
  DOC_KEY:      'loandesk_doc_leads',
  BIZ_PEND:     'loandesk_biz_pending',
  DOC_PEND:     'loandesk_doc_pending',
  SESSION_TTL:  8 * 60 * 60 * 1000
};

// ── State ────────────────────────────────────────────────
let state = {
  module: null,        // 'biz' | 'doc'
  leads: [],
  pending: [],
  isOnline: navigator.onLine,
  filterStatus: 'All',
  searchQuery: '',
  editingId: null,
  deleteTargetId: null
};

// ── DOM Helper ───────────────────────────────────────────
const $ = id => document.getElementById(id);

// ── Utils ────────────────────────────────────────────────
function genId() { return Date.now().toString(36) + Math.random().toString(36).substr(2,5); }
function fmtDate(d) {
  if (!d) return '';
  return new Date(d).toLocaleDateString('en-IN', { day:'2-digit', month:'short', year:'numeric' });
}
function fmtMoney(n) {
  if (!n) return '';
  return '₹' + Number(n).toLocaleString('en-IN');
}
function initials(name) {
  return (name||'?').split(' ').slice(0,2).map(w=>w[0]||'').join('').toUpperCase();
}
function safe(s) {
  const d = document.createElement('div');
  d.textContent = s || '';
  return d.innerHTML;
}

// ── Toast ────────────────────────────────────────────────
function showToast(msg, type='info') {
  const t = $('toast');
  t.textContent = msg;
  t.className = `toast ${type} show`;
  setTimeout(() => t.classList.remove('show'), 3000);
}

// ── Storage ──────────────────────────────────────────────
function leadsKey() { return state.module === 'biz' ? CONFIG.BIZ_KEY : CONFIG.DOC_KEY; }
function pendKey()  { return state.module === 'biz' ? CONFIG.BIZ_PEND : CONFIG.DOC_PEND; }

function saveLocal() {
  try {
    localStorage.setItem(leadsKey(), JSON.stringify(state.leads));
    localStorage.setItem(pendKey(), JSON.stringify(state.pending));
  } catch(e) { console.warn('Storage error'); }
}

function loadLocal() {
  try {
    state.leads   = JSON.parse(localStorage.getItem(leadsKey()) || '[]');
    state.pending = JSON.parse(localStorage.getItem(pendKey())  || '[]');
  } catch(e) { state.leads = []; state.pending = []; }
}

// ── Auth ─────────────────────────────────────────────────
function checkSession() {
  try {
    const s = JSON.parse(localStorage.getItem(CONFIG.SESSION_KEY) || 'null');
    return s && s.valid && (Date.now() - s.time < CONFIG.SESSION_TTL);
  } catch { return false; }
}
function saveSession() { localStorage.setItem(CONFIG.SESSION_KEY, JSON.stringify({ valid:true, time:Date.now() })); }
function clearSession() { localStorage.removeItem(CONFIG.SESSION_KEY); }

function handleLogin(e) {
  e.preventDefault();
  const u = $('loginUser').value.trim();
  const p = $('loginPass').value;
  if (u === CONFIG.AUTH.username && p === CONFIG.AUTH.password) {
    saveSession();
    $('loginScreen').classList.add('hidden');
    $('homeScreen').classList.remove('hidden');
  } else {
    const err = $('loginError');
    err.textContent = 'Invalid username or password';
    err.classList.remove('hidden');
    $('loginPass').value = '';
    setTimeout(() => err.classList.add('hidden'), 3000);
  }
}

function logout() {
  clearSession();
  state.module = null;
  $('appShell').classList.add('hidden');
  $('homeScreen').classList.add('hidden');
  $('loginScreen').classList.remove('hidden');
  $('loginUser').value = '';
  $('loginPass').value = '';
  document.body.className = '';
}

function goHome() {
  $('appShell').classList.add('hidden');
  $('homeScreen').classList.remove('hidden');
  document.body.className = '';
  state.module = null;
}

// ── Module Entry ─────────────────────────────────────────
function enterModule(mod) {
  state.module = mod;
  document.body.className = `mode-${mod}`;
  $('homeScreen').classList.add('hidden');
  $('appShell').classList.remove('hidden');

  // Update UI for module
  const isBiz = mod === 'biz';
  $('moduleLabel').textContent = isBiz ? '🏢 Business Loan CRM' : '🩺 Doctors Loan CRM';
  $('dashSubtitle').textContent = isBiz ? 'Business loan lead overview' : 'Doctor loan lead overview';
  $('totalIcon').textContent = isBiz ? '🏢' : '🩺';
  $('addQuickIcon').style.background = isBiz ? 'rgba(245,158,11,0.1)' : 'rgba(99,102,241,0.1)';
  $('addQuickIcon').style.color = isBiz ? 'var(--biz)' : 'var(--doc)';
  $('addQuickLabel').textContent = isBiz ? 'Add Business Lead' : 'Add Doctor Lead';
  $('formTitle').textContent = isBiz ? 'New Business Lead' : 'New Doctor Lead';

  loadLocal();
  render();
  switchView('dashboard');
  setTimeout(syncToSheets, 800);
}

// ── Google Sheets Sync ───────────────────────────────────
function apiUrl() { return state.module === 'biz' ? CONFIG.BIZ_API_URL : CONFIG.DOC_API_URL; }

async function syncToSheets() {
  const url = apiUrl();
  if (!url || url.includes('YOUR_')) return;
  if (!state.isOnline || state.pending.length === 0) return;
  updateSyncUI('syncing');
  try {
    for (const op of [...state.pending]) {
      await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain' },
        body: JSON.stringify(op)
      });
      state.pending = state.pending.filter(p => p._id !== op._id);
    }
    saveLocal();
    updateSyncUI('online');
    showToast('✅ Synced to Google Sheets', 'success');
  } catch(err) {
    updateSyncUI('offline');
  }
}

function queueSync(action, data) {
  state.pending.push({ _id: genId(), action, data, ts: Date.now() });
  saveLocal();
  updatePendingBadge();
  if (state.isOnline) syncToSheets();
}

function updateSyncUI(status) {
  const dot = $('syncDot'), lbl = $('syncLabel');
  if (!dot) return;
  dot.className = `sync-dot${status === 'online' ? '' : ' ' + status}`;
  lbl.textContent = status === 'syncing' ? 'Syncing…' : status === 'online' ? 'Synced' : 'Offline';
}

function updatePendingBadge() {
  const b = $('pendingBadge');
  if (!b) return;
  b.textContent = `${state.pending.length} pending`;
  b.classList.toggle('hidden', state.pending.length === 0);
}

// ── CRUD ─────────────────────────────────────────────────
function addLead(data) {
  const lead = { id: genId(), dateAdded: new Date().toISOString(), module: state.module, ...data };
  state.leads.unshift(lead);
  saveLocal();
  queueSync('ADD_LEAD', { lead });
  showToast('✅ Lead added!', 'success');
  return lead;
}

function updateLead(id, data) {
  const i = state.leads.findIndex(l => l.id === id);
  if (i < 0) return;
  state.leads[i] = { ...state.leads[i], ...data, updatedAt: new Date().toISOString() };
  saveLocal();
  queueSync('UPDATE_LEAD', { lead: state.leads[i] });
  showToast('✅ Lead updated', 'success');
}

function deleteLead(id) {
  state.leads = state.leads.filter(l => l.id !== id);
  saveLocal();
  queueSync('DELETE_LEAD', { id });
  showToast('🗑️ Lead deleted', 'info');
}

// ── Filtering ─────────────────────────────────────────────
function filtered() {
  let leads = [...state.leads];
  if (state.searchQuery) {
    const q = state.searchQuery.toLowerCase();
    leads = leads.filter(l =>
      (l.doctorName||l.bizName||'').toLowerCase().includes(q) ||
      (l.mobile||'').includes(q) ||
      (l.bankName||l.bizType||'').toLowerCase().includes(q) ||
      (l.natureOfBusiness||'').toLowerCase().includes(q)
    );
  }
  if (state.filterStatus !== 'All') leads = leads.filter(l => l.status === state.filterStatus);
  return leads;
}

// ── Stats ────────────────────────────────────────────────
function getStats() {
  const a = state.leads;
  return {
    total: a.length,
    int:   a.filter(l=>l.status==='Interested').length,
    proc:  a.filter(l=>l.status==='Loan Processing').length,
    dis:   a.filter(l=>l.status==='Loan Disbursed').length,
    cb:    a.filter(l=>l.status==='Call Back').length,
  };
}

// ── Render ───────────────────────────────────────────────
function render() {
  renderDashboard();
  renderLeads();
  updatePendingBadge();
}

function renderDashboard() {
  const s = getStats();
  $('statTotal').textContent = s.total;
  $('statInt').textContent   = s.int;
  $('statProc').textContent  = s.proc;
  $('statDis').textContent   = s.dis;
  $('statCb').textContent    = s.cb;
}

function renderLeads() {
  const cont = $('leadsContainer');
  if (!cont) return;
  const leads = filtered();
  const cnt = $('leadsCount');
  if (cnt) cnt.textContent = `${leads.length} lead${leads.length!==1?'s':''}`;

  if (!leads.length) {
    cont.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon" style="font-size:28px">${state.module==='biz'?'🏢':'🩺'}</div>
        <h3 style="font-family:'Syne',sans-serif;font-size:18px;font-weight:700">No leads found</h3>
        <p style="font-size:14px;color:var(--muted);max-width:220px">
          ${state.searchQuery||state.filterStatus!=='All' ? 'Try a different search or filter' : 'Tap + to add your first lead'}
        </p>
      </div>`;
    return;
  }

  cont.innerHTML = leads.map(l => state.module === 'biz' ? renderBizCard(l) : renderDocCard(l)).join('');
}

function renderBizCard(l) {
  const sc = 's-' + (l.status||'Interested').replace(/\s+/g,'-');
  const ini = initials(l.bizName || l.doctorName || 'BL');
  const waMsg = encodeURIComponent(`Hi, I'm calling from our bank regarding your business loan inquiry.`);
  return `
  <div class="lead-card" data-id="${l.id}">
    <div style="padding:14px 14px 10px;display:flex;align-items:flex-start;justify-content:space-between;gap:10px">
      <div style="display:flex;gap:12px;align-items:flex-start;flex:1;min-width:0">
        <div class="lead-avatar">${safe(ini)}</div>
        <div style="min-width:0">
          <div class="lead-name">${safe(l.bizName||'—')}</div>
          <div class="lead-sub">${safe(l.bizType||'')}${l.gstAvailable?' · GST: '+safe(l.gstAvailable):''}</div>
          <div class="lead-sub" style="margin-top:2px">${safe(l.natureOfBusiness||'')}</div>
        </div>
      </div>
      <span class="status-badge ${sc}">${safe(l.status)}</span>
    </div>
    <div style="padding:0 14px 10px;display:flex;flex-direction:column;gap:4px">
      ${l.mobile ? `<div class="info-row"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07A19.5 19.5 0 013.07 9.81a2 2 0 011.72-2h3a2 2 0 012 1.72c.127.96.361 1.903.7 2.81a2 2 0 01-.45 2.11L8.09 7.91a16 16 0 006 6z"/></svg><span>${safe(l.mobile)}</span></div>` : ''}
      ${l.address ? `<div class="info-row"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z"/><circle cx="12" cy="10" r="3"/></svg><span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${safe(l.address)}</span></div>` : ''}
      ${l.itrTurnover1||l.itrTurnover2 ? `<div class="info-row"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6"/></svg><span>ITR: ${l.itrTurnover1?'AY24-25 T:'+fmtMoney(l.itrTurnover1):''}${l.itrTurnover2?' | AY25-26 T:'+fmtMoney(l.itrTurnover2):''}</span></div>` : ''}
      ${l.existingLoan==='Yes' ? `<div class="info-row"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 21V5a2 2 0 00-2-2h-4a2 2 0 00-2 2v16"/></svg><span style="color:#fbbf24">Existing Loan: ${fmtMoney(l.loanAmount)} @ ${safe(l.loanCompany||'')}</span></div>` : ''}
      ${l.ownHouse ? `<div class="info-row"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg><span>Own House: <strong style="color:var(--text)">${safe(l.ownHouse)}</strong></span></div>` : ''}
      ${l.dateAdded ? `<div class="info-row"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg><span>${fmtDate(l.dateAdded)}</span></div>` : ''}
    </div>
    ${l.notes ? `<div class="notes-preview">"${safe(l.notes)}"</div>` : ''}
    <div class="lead-actions">
      <a href="tel:${safe(l.mobile)}" class="btn-call">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07A19.5 19.5 0 013.07 9.81a2 2 0 011.72-2h3a2 2 0 012 1.72c.127.96.361 1.903.7 2.81a2 2 0 01-.45 2.11z"/></svg>Call
      </a>
      <a href="https://wa.me/${(l.mobile||'').replace(/\D/g,'')}?text=${waMsg}" target="_blank" class="btn-wa">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/></svg>WhatsApp
      </a>
      <button class="btn-edit" onclick="openEditModal('${l.id}')">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
      </button>
      <button class="btn-del" onclick="confirmDelete('${l.id}')">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/></svg>
      </button>
    </div>
  </div>`;
}

function renderDocCard(l) {
  const sc = 's-' + (l.status||'Interested').replace(/\s+/g,'-');
  const ini = initials(l.doctorName || 'DL');
  const waMsg = encodeURIComponent(`Hi Dr. ${l.doctorName}, I'm calling from our bank regarding your doctor loan inquiry.`);
  return `
  <div class="lead-card" data-id="${l.id}">
    <div style="padding:14px 14px 10px;display:flex;align-items:flex-start;justify-content:space-between;gap:10px">
      <div style="display:flex;gap:12px;align-items:flex-start;flex:1;min-width:0">
        <div class="lead-avatar">${safe(ini)}</div>
        <div style="min-width:0">
          <div class="lead-name">${safe(l.doctorName||'—')}</div>
          <div class="lead-sub">${safe(l.degree||'')}</div>
          ${l.dateAdded ? `<div class="lead-sub" style="margin-top:2px">${fmtDate(l.dateAdded)}</div>` : ''}
        </div>
      </div>
      <span class="status-badge ${sc}">${safe(l.status)}</span>
    </div>
    <div style="padding:0 14px 10px;display:flex;flex-direction:column;gap:4px">
      ${l.mobile ? `<div class="info-row"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07A19.5 19.5 0 013.07 9.81a2 2 0 011.72-2h3a2 2 0 012 1.72c.127.96.361 1.903.7 2.81a2 2 0 01-.45 2.11z"/></svg><span>${safe(l.mobile)}</span></div>` : ''}
      ${l.bankName ? `<div class="info-row"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 21V5a2 2 0 00-2-2h-4a2 2 0 00-2 2v16"/></svg><span>Bank: <strong style="color:var(--text)">${safe(l.bankName)}</strong></span></div>` : ''}
      ${l.previousLoan==='Yes' ? `<div class="info-row"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6"/></svg><span style="color:#fbbf24">Prev Loan: ${safe(l.loanDetails||'Yes')}</span></div>` : ''}
      ${l.address ? `<div class="info-row"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z"/><circle cx="12" cy="10" r="3"/></svg><span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${safe(l.address)}</span></div>` : ''}
    </div>
    ${l.notes ? `<div class="notes-preview">"${safe(l.notes)}"</div>` : ''}
    <div class="lead-actions">
      <a href="tel:${safe(l.mobile)}" class="btn-call">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07A19.5 19.5 0 013.07 9.81a2 2 0 011.72-2h3a2 2 0 012 1.72c.127.96.361 1.903.7 2.81a2 2 0 01-.45 2.11z"/></svg>Call
      </a>
      <a href="https://wa.me/${(l.mobile||'').replace(/\D/g,'')}?text=${waMsg}" target="_blank" class="btn-wa">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/></svg>WhatsApp
      </a>
      <button class="btn-edit" onclick="openEditModal('${l.id}')">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
      </button>
      <button class="btn-del" onclick="confirmDelete('${l.id}')">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/></svg>
      </button>
    </div>
  </div>`;
}

// ── Views ────────────────────────────────────────────────
function switchView(view) {
  ['viewDashboard','viewLeads','viewAdd'].forEach(v => $(v)?.classList.add('hidden'));
  $(`view${view.charAt(0).toUpperCase()+view.slice(1)}`)?.classList.remove('hidden');
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
  $(`nav${view.charAt(0).toUpperCase()+view.slice(1)}`)?.classList.add('active');

  if (view === 'dashboard') renderDashboard();
  if (view === 'leads') renderLeads();
  if (view === 'add') {
    state.editingId = null;
    $('formTitle').textContent = state.module === 'biz' ? 'New Business Lead' : 'New Doctor Lead';
    $('leadForm').reset();
    // Show correct form
    $('bizForm').classList.toggle('hidden', state.module !== 'biz');
    $('docForm').classList.toggle('hidden', state.module !== 'doc');
    // Set today
    const today = new Date().toISOString().split('T')[0];
    if (state.module === 'biz') { $('bDateAdded').value = today; $('gstWrap').classList.add('hidden'); $('bizLoanDetailsWrap').classList.add('hidden'); }
    if (state.module === 'doc') { $('dDateAdded').value = today; $('docLoanDetailsWrap').classList.add('hidden'); }
  }
}

function quickFilter(status) {
  state.filterStatus = status;
  document.querySelectorAll('.filter-pill').forEach(p => p.classList.toggle('active', p.dataset.status === status));
  switchView('leads');
}

// ── Form Toggles ─────────────────────────────────────────
function onBizTypeChange() {
  $('gstWrap').classList.toggle('hidden', $('bBizType').value !== 'Proprietorship');
}
function toggleBizLoanDetails() {
  $('bizLoanDetailsWrap').classList.toggle('hidden', $('bExistingLoan').value !== 'Yes');
}
function toggleDocLoanDetails() {
  $('docLoanDetailsWrap').classList.toggle('hidden', $('dPrevLoan').value !== 'Yes');
}
function onEditBizTypeChange() {
  $('eGstWrap').classList.toggle('hidden', $('ebBizType').value !== 'Proprietorship');
}
function toggleEditBizLoan() {
  $('eBizLoanWrap').classList.toggle('hidden', $('ebExistingLoan').value !== 'Yes');
}
function toggleEditDocLoan() {
  $('eDocLoanWrap').classList.toggle('hidden', $('edPrevLoan').value !== 'Yes');
}

// ── Form Submit ───────────────────────────────────────────
function handleFormSubmit(e) {
  e.preventDefault();

  let data;
  if (state.module === 'biz') {
    if (!$('bBizName').value.trim()) { showToast('Business name is required', 'error'); return; }
    if (!$('bMobile').value.trim()) { showToast('Mobile number is required', 'error'); return; }
    if (!$('bStatus').value) { showToast('Please select a status', 'error'); return; }

    data = {
      bizType:         $('bBizType').value,
      gstAvailable:    $('bBizType').value === 'Proprietorship' ? $('bGst').value : '',
      natureOfBusiness:$('bNature').value.trim(),
      bizName:         $('bBizName').value.trim(),
      address:         $('bAddress').value.trim(),
      officeNo:        $('bOfficeNo').value.trim(),
      mobile:          $('bMobile').value.trim(),
      email:           $('bEmail').value.trim(),
      itrTurnover1:    $('bTurnover1').value,
      itrProfit1:      $('bProfit1').value,
      itrTurnover2:    $('bTurnover2').value,
      itrProfit2:      $('bProfit2').value,
      existingLoan:    $('bExistingLoan').value,
      loanAmount:      $('bExistingLoan').value === 'Yes' ? $('bLoanAmt').value : '',
      loanCompany:     $('bExistingLoan').value === 'Yes' ? $('bLoanCompany').value.trim() : '',
      loanType:        $('bExistingLoan').value === 'Yes' ? $('bLoanType').value.trim() : '',
      loanTenure:      $('bExistingLoan').value === 'Yes' ? $('bLoanTenure').value.trim() : '',
      loanEmi:         $('bExistingLoan').value === 'Yes' ? $('bLoanEmi').value : '',
      ownHouse:        $('bOwnHouse').value,
      status:          $('bStatus').value,
      notes:           $('bNotes').value.trim(),
      dateAdded:       $('bDateAdded').value
    };
  } else {
    if (!$('dName').value.trim()) { showToast('Doctor name is required', 'error'); return; }
    if (!$('dMobile').value.trim()) { showToast('Mobile number is required', 'error'); return; }
    if (!$('dStatus').value) { showToast('Please select a status', 'error'); return; }

    data = {
      doctorName:   $('dName').value.trim(),
      degree:       $('dDegree').value.trim(),
      mobile:       $('dMobile').value.trim(),
      email:        $('dEmail').value.trim(),
      address:      $('dAddress').value.trim(),
      bankName:     $('dBank').value.trim(),
      previousLoan: $('dPrevLoan').value,
      loanDetails:  $('dPrevLoan').value === 'Yes' ? $('dLoanDetails').value.trim() : '',
      status:       $('dStatus').value,
      notes:        $('dNotes').value.trim(),
      dateAdded:    $('dDateAdded').value
    };
  }

  addLead(data);
  $('leadForm').reset();
  render();
  switchView('leads');
}

// ── Edit Modal ────────────────────────────────────────────
function openEditModal(id) {
  const l = state.leads.find(x => x.id === id);
  if (!l) return;
  state.editingId = id;

  // Show correct edit form
  $('editBizForm').classList.toggle('hidden', state.module !== 'biz');
  $('editDocForm').classList.toggle('hidden', state.module !== 'doc');

  if (state.module === 'biz') {
    $('ebBizType').value     = l.bizType || '';
    $('eGstWrap').classList.toggle('hidden', l.bizType !== 'Proprietorship');
    $('ebGst').value         = l.gstAvailable || 'No';
    $('ebNature').value      = l.natureOfBusiness || '';
    $('ebBizName').value     = l.bizName || '';
    $('ebAddress').value     = l.address || '';
    $('ebOfficeNo').value    = l.officeNo || '';
    $('ebMobile').value      = l.mobile || '';
    $('ebEmail').value       = l.email || '';
    $('ebTurnover1').value   = l.itrTurnover1 || '';
    $('ebProfit1').value     = l.itrProfit1 || '';
    $('ebTurnover2').value   = l.itrTurnover2 || '';
    $('ebProfit2').value     = l.itrProfit2 || '';
    $('ebExistingLoan').value= l.existingLoan || 'No';
    $('eBizLoanWrap').classList.toggle('hidden', l.existingLoan !== 'Yes');
    $('ebLoanAmt').value     = l.loanAmount || '';
    $('ebLoanCompany').value = l.loanCompany || '';
    $('ebLoanType').value    = l.loanType || '';
    $('ebLoanTenure').value  = l.loanTenure || '';
    $('ebLoanEmi').value     = l.loanEmi || '';
    $('ebOwnHouse').value    = l.ownHouse || 'No';
    $('ebStatus').value      = l.status || 'Interested';
    $('ebNotes').value       = l.notes || '';
  } else {
    $('edName').value        = l.doctorName || '';
    $('edDegree').value      = l.degree || '';
    $('edMobile').value      = l.mobile || '';
    $('edEmail').value       = l.email || '';
    $('edAddress').value     = l.address || '';
    $('edBank').value        = l.bankName || '';
    $('edPrevLoan').value    = l.previousLoan || 'No';
    $('eDocLoanWrap').classList.toggle('hidden', l.previousLoan !== 'Yes');
    $('edLoanDetails').value = l.loanDetails || '';
    $('edStatus').value      = l.status || 'Interested';
    $('edNotes').value       = l.notes || '';
  }

  openModal('editModal');
}

function handleEditSubmit(e) {
  e.preventDefault();
  let data;

  if (state.module === 'biz') {
    data = {
      bizType:         $('ebBizType').value,
      gstAvailable:    $('ebBizType').value === 'Proprietorship' ? $('ebGst').value : '',
      natureOfBusiness:$('ebNature').value.trim(),
      bizName:         $('ebBizName').value.trim(),
      address:         $('ebAddress').value.trim(),
      officeNo:        $('ebOfficeNo').value.trim(),
      mobile:          $('ebMobile').value.trim(),
      email:           $('ebEmail').value.trim(),
      itrTurnover1:    $('ebTurnover1').value,
      itrProfit1:      $('ebProfit1').value,
      itrTurnover2:    $('ebTurnover2').value,
      itrProfit2:      $('ebProfit2').value,
      existingLoan:    $('ebExistingLoan').value,
      loanAmount:      $('ebExistingLoan').value === 'Yes' ? $('ebLoanAmt').value : '',
      loanCompany:     $('ebExistingLoan').value === 'Yes' ? $('ebLoanCompany').value.trim() : '',
      loanType:        $('ebExistingLoan').value === 'Yes' ? $('ebLoanType').value.trim() : '',
      loanTenure:      $('ebExistingLoan').value === 'Yes' ? $('ebLoanTenure').value.trim() : '',
      loanEmi:         $('ebExistingLoan').value === 'Yes' ? $('ebLoanEmi').value : '',
      ownHouse:        $('ebOwnHouse').value,
      status:          $('ebStatus').value,
      notes:           $('ebNotes').value.trim()
    };
  } else {
    data = {
      doctorName:   $('edName').value.trim(),
      degree:       $('edDegree').value.trim(),
      mobile:       $('edMobile').value.trim(),
      email:        $('edEmail').value.trim(),
      address:      $('edAddress').value.trim(),
      bankName:     $('edBank').value.trim(),
      previousLoan: $('edPrevLoan').value,
      loanDetails:  $('edPrevLoan').value === 'Yes' ? $('edLoanDetails').value.trim() : '',
      status:       $('edStatus').value,
      notes:        $('edNotes').value.trim()
    };
  }

  updateLead(state.editingId, data);
  closeModal('editModal');
  render();
}

// ── Delete ────────────────────────────────────────────────
function confirmDelete(id) {
  state.deleteTargetId = id;
  const l = state.leads.find(x => x.id === id);
  $('deleteLeadName').textContent = l?.bizName || l?.doctorName || 'this lead';
  $('confirmOverlay').classList.add('open');
}
function executeDelete() {
  if (state.deleteTargetId) { deleteLead(state.deleteTargetId); state.deleteTargetId = null; }
  $('confirmOverlay').classList.remove('open');
  render();
}

// ── Modal Helpers ─────────────────────────────────────────
function openModal(id) { $(id)?.classList.add('open'); document.body.style.overflow = 'hidden'; }
function closeModal(id) { $(id)?.classList.remove('open'); document.body.style.overflow = ''; state.editingId = null; }

// ── Network ───────────────────────────────────────────────
window.addEventListener('online',  () => { state.isOnline = true; $('offlineBanner')?.classList.remove('show'); updateSyncUI('online'); syncToSheets(); });
window.addEventListener('offline', () => { state.isOnline = false; $('offlineBanner')?.classList.add('show'); updateSyncUI('offline'); });

// ── Init ──────────────────────────────────────────────────
function init() {
  if (checkSession()) {
    $('loginScreen').classList.add('hidden');
    $('homeScreen').classList.remove('hidden');
  }

  $('loginForm')?.addEventListener('submit', handleLogin);
  $('leadForm')?.addEventListener('submit', handleFormSubmit);
  $('editForm')?.addEventListener('submit', handleEditSubmit);

  $('searchInput')?.addEventListener('input', e => { state.searchQuery = e.target.value; renderLeads(); });

  document.querySelectorAll('.filter-pill').forEach(pill => {
    pill.addEventListener('click', () => {
      document.querySelectorAll('.filter-pill').forEach(p => p.classList.remove('active'));
      pill.classList.add('active');
      state.filterStatus = pill.dataset.status;
      renderLeads();
    });
  });

  document.querySelectorAll('.modal-overlay').forEach(o => {
    o.addEventListener('click', e => { if (e.target === o) closeModal(o.id); });
  });

  updateSyncUI(navigator.onLine ? 'online' : 'offline');
}

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./service-worker.js').catch(e => console.warn('[SW]', e));
  });
}

document.addEventListener('DOMContentLoaded', init);
