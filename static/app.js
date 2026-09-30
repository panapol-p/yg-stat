/* YG Stat – frontend (vanilla JS + Chart.js) */
'use strict';

const S = { characters: [], snapshots: [], vault: [], settings: {}, version: '' };
const UI = { tab: 'entry', expChar: null, expRange: 30, moneyRange: 30, conqChar: null, conqRange: 30, histChar: '' };
const charts = {};
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

/* ------------------------------------------------------------------ utils */
function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function addDays(ds, n) {
  const d = new Date(ds + 'T00:00:00');
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function daysBetween(a, b) {
  return Math.round((new Date(b + 'T00:00:00') - new Date(a + 'T00:00:00')) / 86400000);
}
function fmtDate(ds) { // 2026-09-26 -> 26/09/26
  if (!ds) return '—';
  const [y, m, d] = ds.split('-');
  return `${d}/${m}/${y.slice(2)}`;
}
function fmtInt(n) {
  if (n == null || isNaN(n)) return '—';
  return Math.round(n).toLocaleString('en-US');
}
const M = 1e6; // เงินเก็บในไฟล์เป็นจำนวนเต็ม แสดงผล/กรอกเป็น M (ล้าน)
function fmtM(n, d = 2) {
  if (n == null || isNaN(n)) return '—';
  return (n / M).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d }) + 'M';
}
function fmtSigned(n, d = 2) {
  if (n == null || isNaN(n)) return '—';
  return (n > 0 ? '+' : '') + fmtM(n, d);
}
function fmtShort(n) { return fmtM(n); }
function fmtSignedInt(n) { if (n == null || isNaN(n)) return '—'; return (n > 0 ? '+' : '') + fmtInt(n); }
function fmtAxisM(v) { return fmtM(v, Math.abs(v) >= 100 * M ? 0 : 1); }
// ค่าในช่องกรอก (หน่วย M) จาก gold ดิบ
function goldToInput(g) { if (g == null) return ''; const m = g / M; return String(+m.toFixed(3)); }
function fmtPct(n, d = 2) { return n == null || isNaN(n) ? '—' : n.toFixed(d) + '%'; }
function parseGold(str) {
  if (str == null) return null;
  let s = String(str).trim().toLowerCase().replace(/[,\s_]/g, '');
  if (!s) return null;
  let mul = null;
  const suf = s.slice(-1);
  if (suf === 'k') { mul = 1e3; s = s.slice(0, -1); }
  else if (suf === 'm') { mul = 1e6; s = s.slice(0, -1); }
  else if (suf === 'b') { mul = 1e9; s = s.slice(0, -1); }
  else if (suf === 'g') { mul = 1; s = s.slice(0, -1); } // g = เงินเต็มจำนวน
  const v = parseFloat(s);
  if (isNaN(v)) return null;
  if (mul == null) mul = Math.abs(v) >= 100000 ? 1 : M; // ไม่ใส่หน่วย = M ; ตัวเลขใหญ่มากถือว่าเป็นเงินเต็มจำนวน
  return Math.round(v * mul);
}
function numOrNull(v) {
  if (v === '' || v == null) return null;
  const n = parseFloat(v);
  return isNaN(n) ? null : n;
}
function cssVar(name) { return getComputedStyle(document.documentElement).getPropertyValue(name).trim(); }
function hexA(hex, a) {
  const h = hex.replace('#', '');
  const r = parseInt(h.slice(0, 2), 16), g = parseInt(h.slice(2, 4), 16), b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${a})`;
}
function esc(s) { return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function toast(msg, err = false) {
  const t = $('#toast');
  t.textContent = msg; t.className = 'toast' + (err ? ' err' : ''); t.hidden = false;
  clearTimeout(toast._t); toast._t = setTimeout(() => (t.hidden = true), 2600);
}

/* ------------------------------------------------------------------ data helpers */
function charById(id) { return S.characters.find(c => c.id === id); }
function activeChars() { return S.characters.filter(c => c.active); }
// สีตามตัวละคร: จัดตาม id (ไม่เปลี่ยนเมื่อสลับลำดับ/กรอง)
function colorOf(c) {
  const ids = [...S.characters].sort((a, b) => a.id - b.id).map(x => x.id);
  const slot = (ids.indexOf(c.id) % 8) + 1;
  return cssVar(`--s${slot}`);
}
const VAULT_COLOR = () => cssVar('--s7');
function snapsOf(charId) { return S.snapshots.filter(s => s.char_id === charId).sort((a, b) => a.date.localeCompare(b.date)); }
function lastSnapOf(charId, onOrBefore) {
  const arr = snapsOf(charId).filter(s => !onOrBefore || s.date <= onOrBefore);
  return arr.length ? arr[arr.length - 1] : null;
}
function hasExp(s) { return s && s.level != null && s.exp_pct != null; }
// ความคืบหน้า หน่วย: % — EXP ติดลบไม่ถูกนำมาหัก เพราะระหว่างติดลบ EXP% ยังขึ้นอยู่ (EXP ที่ได้แค่ถูกแบ่งไปใช้คืน)
function netExp(s) { return s.level * 100 + s.exp_pct; }
function netLv(s) { return netExp(s) / 100; }

// ชุดข้อมูล gain ระหว่าง snapshot ที่มี exp ครบ
function gainSeries(charId) {
  const arr = snapsOf(charId).filter(hasExp);
  const out = [];
  for (let i = 1; i < arr.length; i++) {
    const days = Math.max(1, daysBetween(arr[i - 1].date, arr[i].date));
    const gain = netExp(arr[i]) - netExp(arr[i - 1]);
    out.push({ date: arr[i].date, gain, days, perDay: gain / days });
  }
  return out;
}
// อัตรา/วัน จาก 7 วันล่าสุดที่มีข้อมูล
function rateRecent(charId, windowDays = 7) {
  const arr = snapsOf(charId).filter(hasExp);
  if (arr.length < 2) return null;
  const last = arr[arr.length - 1];
  let first = arr.find(s => s.date >= addDays(last.date, -windowDays));
  if (!first || first === last) first = arr[arr.length - 2];
  const days = Math.max(1, daysBetween(first.date, last.date));
  return { perDay: (netExp(last) - netExp(first)) / days, days, from: first.date, to: last.date };
}
function etaDays(charId) {
  const last = lastSnapOf(charId);
  const r = rateRecent(charId);
  if (!hasExp(last) || !r || r.perDay <= 0) return null;
  return (100 - last.exp_pct) / r.perDay;
}
// ---- EXP ติดลบ (จำนวน EXP ที่ยังต้องใช้คืน เช่น 500M) ----
function debtInfo(charId) {
  const arr = snapsOf(charId).filter(hasExp);
  if (!arr.length) return null;
  const last = arr[arr.length - 1], prev = arr[arr.length - 2];
  const debt = last.debt || 0;
  if (!prev) return { debt, change: null, payPerDay: null, clearDays: null };
  const days = Math.max(1, daysBetween(prev.date, last.date));
  const change = debt - (prev.debt || 0);
  const payPerDay = change < 0 ? -change / days : null; // ใช้คืนได้ต่อวัน (เฉพาะช่วงที่ยอดลดลง)
  return { debt, change, payPerDay, clearDays: payPerDay && debt > 0 ? debt / payPerDay : null };
}
// ---- เป้าหมายเลเวล: ประมาณจากอัตรา %/วัน ล่าสุด (เลเวลสูงขึ้นจริง ๆ จะช้าลง จึงเป็นค่าขั้นต่ำ) ----
function goalInfo(c) {
  if (!c.goal_level) return null;
  const arr = snapsOf(c.id).filter(hasExp);
  const last = arr[arr.length - 1];
  if (!last) return { goal: c.goal_level, remain: null, days: null, done: false };
  const remain = c.goal_level * 100 - netExp(last);
  if (remain <= 0) return { goal: c.goal_level, remain: 0, days: 0, done: true };
  const r = rateRecent(c.id);
  return { goal: c.goal_level, remain, days: r && r.perDay > 0 ? remain / r.perDay : null, done: false };
}
function fmtDays(d) { return d == null ? '—' : d < 1 ? '< 1 วัน' : `~${fmtInt(Math.ceil(d))} วัน`; }
// ---- เงินที่เปลี่ยนของแต่ละตัวตั้งแต่ from (เอาจุดก่อนหน้าช่วงมาเป็นฐาน 1 จุด) ----
function goldChange(entries, from) {
  const a = entries.filter(s => s.gold != null);
  let sub = a.filter(s => s.date >= from);
  const b = a.filter(s => s.date < from).pop(); if (b) sub = [b, ...sub];
  if (sub.length < 2) return null;
  const first = sub[0], last = sub[sub.length - 1];
  const days = Math.max(1, daysBetween(first.date, last.date));
  return { change: last.gold - first.gold, days, perDay: (last.gold - first.gold) / days };
}
// ---- ค่าพิชิตศัตรู (สะสม) ----
function hasConq(s) { return s && s.conquer != null; }
function conqSnaps(charId) { return snapsOf(charId).filter(hasConq); }
function lastConq(charId) { const a = conqSnaps(charId); return a.length ? a[a.length - 1] : null; }
function conqGainSeries(charId) {
  const arr = conqSnaps(charId), out = [];
  for (let i = 1; i < arr.length; i++) {
    const days = Math.max(1, daysBetween(arr[i - 1].date, arr[i].date));
    const gain = arr[i].conquer - arr[i - 1].conquer;
    out.push({ date: arr[i].date, gain, days, perDay: gain / days });
  }
  return out;
}
function conqRateRecent(charId, windowDays = 7) {
  const arr = conqSnaps(charId);
  if (arr.length < 2) return null;
  const last = arr[arr.length - 1];
  let first = arr.find(s => s.date >= addDays(last.date, -windowDays));
  if (!first || first === last) first = arr[arr.length - 2];
  const days = Math.max(1, daysBetween(first.date, last.date));
  return { perDay: (last.conquer - first.conquer) / days, days, from: first.date, to: last.date };
}
// ทรัพย์สินรวมรายวัน (forward-fill ค่าล่าสุดของแต่ละตัว)
function assetsSeries() {
  const chars = S.characters; // รวมตัวที่ปิด active ด้วย ถ้าเคยมีเงิน (จะ carry ค่าล่าสุดไว้)
  const dateSet = new Set();
  S.snapshots.forEach(s => { if (s.gold != null) dateSet.add(s.date); });
  S.vault.forEach(v => dateSet.add(v.date));
  const dates = [...dateSet].sort();
  const byChar = {};
  chars.forEach(c => (byChar[c.id] = []));
  const vaultArr = [], total = [];
  const cur = {}; let curVault = 0;
  const goldMap = {}; // date -> charId -> gold
  S.snapshots.forEach(s => { if (s.gold != null) ((goldMap[s.date] ??= {})[s.char_id] = s.gold); });
  const vaultMap = Object.fromEntries(S.vault.map(v => [v.date, v.gold]));
  for (const d of dates) {
    const g = goldMap[d] || {};
    for (const c of chars) { if (g[c.id] != null) cur[c.id] = g[c.id]; byChar[c.id].push(cur[c.id] ?? 0); }
    if (vaultMap[d] != null) curVault = vaultMap[d];
    vaultArr.push(curVault);
    total.push(chars.reduce((a, c) => a + (cur[c.id] ?? 0), 0) + curVault);
  }
  return { dates, byChar, vault: vaultArr, total };
}
function sliceRange(series, rangeDays) {
  if (!rangeDays || !series.dates.length) return series;
  const from = addDays(series.dates[series.dates.length - 1], -rangeDays);
  let i = series.dates.findIndex(d => d >= from);
  i = Math.max(0, i - 1); // เอาจุดก่อนหน้าช่วงมาด้วย 1 จุด เพื่อให้เห็น delta วันแรก
  const cut = a => a.slice(i);
  const byChar = {}; Object.keys(series.byChar).forEach(k => (byChar[k] = cut(series.byChar[k])));
  return { dates: cut(series.dates), byChar, vault: cut(series.vault), total: cut(series.total) };
}

/* ------------------------------------------------------------------ chart helpers */
function mkChart(id, cfg) {
  if (charts[id]) { charts[id].destroy(); delete charts[id]; }
  const el = document.getElementById(id);
  if (!el) return null;
  charts[id] = new Chart(el.getContext('2d'), cfg);
  return charts[id];
}
function baseOpts({ yFmt, legend = true, stacked = false, yMin, yMax, tooltipLabel } = {}) {
  const muted = cssVar('--muted'), grid = cssVar('--grid'), axis = cssVar('--axis');
  const surface = cssVar('--surface'), ink = cssVar('--ink');
  return {
    responsive: true, maintainAspectRatio: false, animation: { duration: 250 },
    interaction: { mode: 'index', intersect: false },
    plugins: {
      legend: { display: legend, position: 'top', align: 'end', labels: { usePointStyle: true, pointStyle: 'circle', boxWidth: 8, boxHeight: 8, color: cssVar('--ink-2'), font: { size: 12 } } },
      tooltip: {
        backgroundColor: ink, titleColor: surface, bodyColor: surface, padding: 10, cornerRadius: 8,
        usePointStyle: true, boxWidth: 8, boxHeight: 8, boxPadding: 4,
        callbacks: { label: tooltipLabel || (ctx => ` ${ctx.dataset.label}: ${yFmt ? yFmt(ctx.parsed.y) : ctx.parsed.y}`) },
      },
    },
    scales: {
      x: { grid: { display: false }, border: { color: axis }, ticks: { color: muted, maxRotation: 0, autoSkip: true, maxTicksLimit: 10, callback(v) { return fmtDate(this.getLabelForValue(v)); } } },
      y: { stacked, min: yMin, max: yMax, grid: { color: grid }, border: { display: false }, ticks: { color: muted, callback: v => (yFmt ? yFmt(v) : v) } },
    },
  };
}
function lineDs(label, data, color, extra = {}) {
  const many = data.length > 60;
  return { label, data, borderColor: color, backgroundColor: color, borderWidth: 2, pointRadius: many ? 0 : 3, pointHoverRadius: 5,
    pointBackgroundColor: color, pointBorderColor: cssVar('--surface'), pointBorderWidth: 2, tension: 0.2, spanGaps: true, ...extra };
}
function emptyChart(id, msg = 'ยังไม่มีข้อมูล') {
  if (charts[id]) { charts[id].destroy(); delete charts[id]; }
  const el = document.getElementById(id);
  if (!el) return;
  const ctx = el.getContext('2d');
  const box = el.parentElement.getBoundingClientRect();
  el.width = box.width * devicePixelRatio; el.height = box.height * devicePixelRatio;
  el.style.width = box.width + 'px'; el.style.height = box.height + 'px';
  ctx.scale(devicePixelRatio, devicePixelRatio);
  ctx.fillStyle = cssVar('--muted'); ctx.font = '13px system-ui'; ctx.textAlign = 'center';
  ctx.fillText(msg, box.width / 2, box.height / 2);
}

/* ------------------------------------------------------------------ API */
async function api(path, opt = {}) {
  const r = await fetch(path, { headers: { 'Content-Type': 'application/json' }, ...opt });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.ok === false) throw new Error(j.error || r.statusText);
  return j;
}
async function loadState() {
  const st = await api('/api/state');
  S.characters = st.characters || []; S.snapshots = st.snapshots || []; S.vault = st.vault || [];
  S.settings = st.settings || {}; S.version = st.version || '';
  $('#appVersion').textContent = S.version;
  const last = S.snapshots.map(s => s.date).concat(S.vault.map(v => v.date)).sort().pop();
  $('#lastUpdate').textContent = last ? `บันทึกล่าสุด ${fmtDate(last)} · ${S.snapshots.length} รายการ` : 'ยังไม่มีข้อมูล';
}

/* ------------------------------------------------------------------ tab: บันทึก */
function renderEntry() {
  const date = $('#entryDate').value || todayStr();
  $('#entryDate').value = date;
  const wrap = $('#entryRows');
  wrap.innerHTML = '';
  for (const c of activeChars()) {
    const cur = S.snapshots.find(s => s.char_id === c.id && s.date === date);
    const prev = lastSnapOf(c.id, addDays(date, -1));
    const src = cur || prev;
    const row = document.createElement('div');
    row.className = 'erow' + (cur ? ' exists' : '');
    row.dataset.charId = c.id;
    const lastTxt = cur ? `มีข้อมูลวันนี้แล้ว (แก้ไขได้)` : prev ? `ค่าล่าสุด ${fmtDate(prev.date)}` : 'ยังไม่เคยบันทึก';
    row.innerHTML = `
      <input type="checkbox" class="cb" ${cur ? 'checked' : ''} title="บันทึกตัวนี้">
      <div class="who"><b><span class="dot" style="background:${colorOf(c)}"></span>${esc(c.name)}</b><small>${esc(c.job)}${c.has_debt ? ' · มี EXP ติดลบ' : ''} · ${lastTxt}</small></div>
      <label>Lv<input type="number" name="level" min="1" step="1" value="${src?.level ?? ''}"></label>
      <label>EXP %<input type="number" name="exp_pct" min="0" max="100" step="0.01" value="${src?.exp_pct ?? ''}"></label>
      ${c.has_debt
        ? `<label>EXP ติดลบ (M)<input type="text" name="debt" inputmode="decimal" placeholder="เช่น 500" value="${goldToInput(src?.debt ?? 0)}"></label>`
        : `<span class="na">— ไม่มี EXP ติดลบ</span>`}
      <label>เงิน (M)<input type="text" name="gold" inputmode="decimal" placeholder="เช่น 713.11" value="${goldToInput(src?.gold)}"></label>
      <label>พิชิต<input type="number" name="conquer" min="0" step="1" placeholder="สะสม" value="${src?.conquer ?? ''}"></label>
      <label>ตาย (ครั้ง)<input type="number" name="deaths" min="0" step="1" placeholder="0" value="${cur?.deaths ?? ''}"></label>
      <label>โน้ต<input type="text" name="note" placeholder="ตาย 1 ครั้ง / ขายของ ..." value="${esc(cur?.note ?? '')}"></label>`;
    wrap.appendChild(row);
  }
  // คลัง
  const curV = S.vault.find(v => v.date === date);
  const prevV = [...S.vault].filter(v => v.date < date).sort((a, b) => a.date.localeCompare(b.date)).pop();
  const srcV = curV || prevV;
  const vrow = document.createElement('div');
  vrow.className = 'erow vault' + (curV ? ' exists' : '');
  vrow.dataset.vault = '1';
  vrow.innerHTML = `
    <input type="checkbox" class="cb" ${curV ? 'checked' : ''}>
    <div class="who"><b><span class="dot" style="background:${VAULT_COLOR()}"></span>คลัง/อื่นๆ</b><small>เงินที่ไม่ได้อยู่กับตัวละคร · ${curV ? 'มีข้อมูลวันนี้แล้ว' : prevV ? `ค่าล่าสุด ${fmtDate(prevV.date)}` : 'ยังไม่เคยบันทึก'}</small></div>
    <label>เงิน (M)<input type="text" name="gold" inputmode="decimal" placeholder="เช่น 1500" value="${srcV ? goldToInput(srcV.gold) : ''}"></label>
    <label>โน้ต<input type="text" name="note" value="${esc(curV?.note ?? '')}"></label>`;
  wrap.appendChild(vrow);

  wrap.oninput = e => {
    const row = e.target.closest('.erow');
    if (row && e.target.type !== 'checkbox') { row.querySelector('.cb').checked = true; row.classList.add('dirty'); }
  };
  wrap.onchange = e => {
    if (e.target.name === 'gold' || e.target.name === 'debt') { const v = parseGold(e.target.value); e.target.value = goldToInput(v); }
  };
  $('#saveMsg').textContent = '';
}
async function saveEntry() {
  const date = $('#entryDate').value;
  if (!date) return toast('เลือกวันที่ก่อน', true);
  const rows = [];
  let vault = null;
  for (const row of $$('#entryRows .erow')) {
    if (!row.querySelector('.cb').checked) continue;
    const g = n => row.querySelector(`[name=${n}]`);
    if (row.dataset.vault) {
      const gold = parseGold(g('gold').value);
      if (gold != null) vault = { gold, note: g('note').value };
      continue;
    }
    rows.push({
      char_id: +row.dataset.charId,
      level: numOrNull(g('level').value),
      exp_pct: numOrNull(g('exp_pct').value),
      debt: g('debt') ? parseGold(g('debt').value) ?? 0 : 0,
      gold: parseGold(g('gold').value),
      conquer: numOrNull(g('conquer').value),
      deaths: numOrNull(g('deaths').value),
      note: g('note').value,
    });
  }
  if (!rows.length && !vault) return toast('ยังไม่ได้ติ๊กแถวไหนเลย', true);
  try {
    const r = await api('/api/day', { method: 'POST', body: JSON.stringify({ date, rows, vault }) });
    await loadState();
    renderEntry();
    toast(`บันทึกแล้ว ${r.saved} รายการ (${fmtDate(date)})`);
  } catch (e) { toast('บันทึกไม่สำเร็จ: ' + e.message, true); }
}

/* ------------------------------------------------------------------ tab: ภาพรวม */
function tile(k, v, d = '', cls = '') {
  return `<div class="tile"><div class="k">${k}</div><div class="v ${cls}">${v}</div><div class="d">${d}</div></div>`;
}
function deltaCls(n) { return n > 0 ? 'up' : n < 0 ? 'down' : ''; }
function renderOverview() {
  const A = assetsSeries();
  const n = A.dates.length;
  const total = n ? A.total[n - 1] : null;
  const d1 = n > 1 ? total - A.total[n - 2] : null;
  let d7 = null;
  if (n > 1) {
    const from = addDays(A.dates[n - 1], -7);
    let i = A.dates.findIndex(d => d >= from); i = Math.max(0, i - 1);
    d7 = total - A.total[i];
  }
  const soon = activeChars().map(c => ({ c, eta: etaDays(c.id) })).filter(x => x.eta != null).sort((a, b) => a.eta - b.eta)[0];
  $('#ovTiles').innerHTML =
    tile('ทรัพย์สินรวม', fmtM(total), n ? `ณ ${fmtDate(A.dates[n - 1])} · เต็มจำนวน ${fmtInt(total)}` : 'ยังไม่มีข้อมูล') +
    tile('เปลี่ยนจากครั้งก่อน', fmtSigned(d1), n > 1 ? `${fmtDate(A.dates[n - 2])} → ${fmtDate(A.dates[n - 1])}` : '', deltaCls(d1)) +
    tile('เปลี่ยน 7 วัน', fmtSigned(d7), '', deltaCls(d7)) +
    tile('ใกล้อัปเลเวลที่สุด', soon ? esc(soon.c.name) : '—', soon ? `อีก ~${soon.eta < 1 ? '< 1' : Math.ceil(soon.eta)} วัน (Lv ${lastSnapOf(soon.c.id).level} → ${lastSnapOf(soon.c.id).level + 1})` : 'ต้องมีข้อมูลอย่างน้อย 2 วัน');

  const anyGoal = activeChars().some(c => c.goal_level);
  const rows = activeChars().map(c => {
    const s = lastSnapOf(c.id), r = rateRecent(c.id), eta = etaDays(c.id), cr = conqRateRecent(c.id), gi = goalInfo(c);
    const ago = s ? daysBetween(s.date, todayStr()) : null;
    return `<tr>
      <td><span class="dot" style="background:${colorOf(c)}"></span>${esc(c.name)}${c.has_debt ? '<span class="tag debt">ติดลบ</span>' : ''}</td>
      <td>${s?.level ?? '—'}</td>
      <td>${fmtPct(s?.exp_pct)}</td>
      <td class="${s?.debt > 0 ? 'down' : ''}">${c.has_debt ? fmtM(s?.debt) : '—'}</td>
      <td>${fmtM(s?.gold)}</td>
      <td>${fmtInt(lastConq(c.id)?.conquer)}</td>
      <td class="${deltaCls(cr?.perDay)}">${cr ? fmtSignedInt(cr.perDay) : '—'}</td>
      <td class="${deltaCls(r?.perDay)}">${r ? fmtPct(r.perDay, 2) : '—'}</td>
      <td>${eta == null ? '—' : eta < 1 ? '< 1 วัน' : Math.ceil(eta) + ' วัน'}</td>
      ${anyGoal ? `<td>${!gi ? '—' : gi.done ? `Lv ${gi.goal} <span class="up">ถึงแล้ว</span>` : `Lv ${gi.goal} · ${fmtDays(gi.days)}`}</td>` : ''}
      <td class="l">${s ? `${fmtDate(s.date)} <span class="hint">(${ago === 0 ? 'วันนี้' : ago + ' วันก่อน'})</span>` : '—'}</td>
    </tr>`;
  }).join('');
  $('#ovTable').innerHTML = `<thead><tr><th>ตัวละคร</th><th>Lv</th><th>EXP%</th><th>ติดลบ (M)</th><th>เงิน (M)</th><th>พิชิต</th><th>พิชิต/วัน</th><th>EXP/วัน</th><th>ถึง Lv ถัดไป</th>${anyGoal ? '<th>ถึงเป้า</th>' : ''}<th style="text-align:left">อัปเดต</th></tr></thead><tbody>${rows || '<tr><td colspan="11" class="empty">ยังไม่มีตัวละคร</td></tr>'}</tbody>`;

  const R = sliceRange(A, 30);
  if (R.dates.length < 1) return emptyChart('ovMoneyChart');
  const c1 = cssVar('--s1');
  mkChart('ovMoneyChart', { type: 'line', data: { labels: R.dates, datasets: [lineDs('ทรัพย์สินรวม', R.total, c1)] },
    options: baseOpts({ yFmt: fmtAxisM, legend: false, tooltipLabel: ctx => ` ${fmtM(ctx.parsed.y)}` }) });
}

/* ------------------------------------------------------------------ tab: EXP */
function renderExp() {
  const chars = activeChars();
  if (!chars.find(c => c.id === UI.expChar)) UI.expChar = chars[0]?.id ?? null;
  $('#expCharChips').innerHTML = chars.map(c =>
    `<button data-id="${c.id}" class="${c.id === UI.expChar ? 'on' : ''}"><span class="dot" style="background:${colorOf(c)}"></span>${esc(c.name)}</button>`).join('');
  $('#expCharChips').onclick = e => { const b = e.target.closest('button'); if (b) { UI.expChar = +b.dataset.id; renderExp(); } };
  const c = charById(UI.expChar);
  if (!c) { $('#expTiles').innerHTML = ''; ['expNetChart', 'expPctChart', 'expGainChart', 'expCompareChart'].forEach(id => emptyChart(id)); return; }

  const all = snapsOf(c.id).filter(hasExp);
  const lastDate = all.length ? all[all.length - 1].date : todayStr();
  const from = UI.expRange ? addDays(lastDate, -UI.expRange) : '0000';
  let arr = all.filter(s => s.date >= from);
  const before = all.filter(s => s.date < from).pop();
  if (before) arr = [before, ...arr];
  const last = all[all.length - 1], r = rateRecent(c.id), eta = etaDays(c.id);
  const di = c.has_debt ? debtInfo(c.id) : null;
  const debtSub = !di || !di.debt ? 'ไม่ติดลบ'
    : di.payPerDay ? `ใช้คืน ~${fmtM(di.payPerDay)}/วัน · หมดใน ~${Math.ceil(di.clearDays)} วัน`
    : di.change > 0 ? `เพิ่ม ${fmtSigned(di.change)} จากครั้งก่อน`
    : 'EXP ที่ได้ถูกแบ่งมาหักส่วนนี้';
  const gainRange = arr.length > 1 ? netExp(arr[arr.length - 1]) - netExp(arr[0]) : null;
  const lvUps = arr.length > 1 ? arr[arr.length - 1].level - arr[0].level : 0;
  const deathsByDate = Object.fromEntries(snapsOf(c.id).filter(s => s.deaths != null).map(s => [s.date, s.deaths]));
  const deathsRange = Object.entries(deathsByDate).filter(([d]) => d >= from).reduce((a, [, n]) => a + n, 0);
  const gi = goalInfo(c);
  $('#expTiles').innerHTML =
    tile('ตอนนี้', last ? `Lv ${last.level} · ${fmtPct(last.exp_pct)}` : '—', last ? `ณ ${fmtDate(last.date)}` : '') +
    (c.has_debt ? tile('EXP ติดลบ', fmtM(di?.debt ?? 0), debtSub, di?.debt > 0 ? 'down' : '') : '') +
    tile('อัตราล่าสุด', r ? fmtPct(r.perDay) + '/วัน' : '—', r ? `เฉลี่ย ${r.days} วัน (${fmtDate(r.from)}–${fmtDate(r.to)})` : '', deltaCls(r?.perDay)) +
    tile('ถึง Lv ถัดไป', eta == null ? '—' : eta < 1 ? '< 1 วัน' : `~${Math.ceil(eta)} วัน`, last ? `เหลือ ${fmtPct(100 - last.exp_pct)}` : '') +
    (gi ? tile(`ถึงเป้า Lv ${gi.goal}`, gi.done ? 'ถึงแล้ว' : fmtDays(gi.days), gi.done || gi.remain == null ? '' : `เหลือ ${(gi.remain / 100).toFixed(2)} เลเวล · คิดจากอัตราล่าสุด`, gi.done ? 'up' : '') : '') +
    tile('ได้ในช่วงที่เลือก', gainRange == null ? '—' : fmtPct(gainRange, 1), [lvUps ? `อัป ${lvUps} เลเวล` : '', deathsRange ? `ตาย ${deathsRange} ครั้ง` : ''].filter(Boolean).join(' · '), deltaCls(gainRange));

  const col = colorOf(c), debtCol = cssVar('--debt');
  if (arr.length < 1) { ['expNetChart', 'expPctChart', 'expGainChart'].forEach(id => emptyChart(id)); }
  else {
    const labels = arr.map(s => s.date);
    const lvFmt = v => `Lv ${Math.floor(v)} · ${Math.round((v - Math.floor(v)) * 100)}%`;
    mkChart('expNetChart', { type: 'line', data: { labels, datasets: [lineDs('ความคืบหน้า', arr.map(netLv), col)] },
      options: baseOpts({ legend: false, yFmt: lvFmt, tooltipLabel: ctx => { const s = arr[ctx.dataIndex]; return ` Lv ${s.level} · ${fmtPct(s.exp_pct)}${s.debt ? ` · ติดลบ ${fmtM(s.debt)}` : ''}`; } }) });
    const ds = [lineDs('EXP %', arr.map(s => s.exp_pct), col)];
    const pctOpts = baseOpts({ legend: c.has_debt, yFmt: v => v + '%', yMin: 0, yMax: 100,
      tooltipLabel: ctx => ` ${ctx.dataset.label}: ${ctx.dataset.yAxisID === 'y1' ? fmtM(ctx.parsed.y) : fmtPct(ctx.parsed.y)}` });
    if (c.has_debt) { // ติดลบเป็นจำนวน EXP (M) คนละหน่วยกับ EXP% -> แกนขวา
      ds.push(lineDs('EXP ติดลบ (M)', arr.map(s => s.debt || 0), debtCol, { yAxisID: 'y1' }));
      pctOpts.scales.y1 = { position: 'right', min: 0, suggestedMax: 100 * M, grid: { drawOnChartArea: false }, border: { display: false }, ticks: { color: debtCol, callback: v => fmtAxisM(v) } };
    }
    mkChart('expPctChart', { type: 'line', data: { labels, datasets: ds }, options: pctOpts });

    const gs = gainSeries(c.id).filter(g => g.date >= from);
    if (!gs.length) emptyChart('expGainChart', 'ต้องมีข้อมูลอย่างน้อย 2 วัน');
    else {
      const dd = gs.map(g => deathsByDate[g.date] || null), anyDeath = dd.some(Boolean), bad = cssVar('--bad');
      const gds = [{ label: 'EXP %/วัน', data: gs.map(g => g.perDay), backgroundColor: gs.map(g => (g.perDay < 0 ? bad : col)), borderRadius: 4, borderSkipped: 'bottom', maxBarThickness: 28 }];
      const gOpts = baseOpts({ legend: anyDeath, yFmt: v => v + '%', tooltipLabel: ctx => {
        if (ctx.dataset.yAxisID === 'y1') return ` ตาย ${ctx.parsed.y} ครั้ง`;
        const g = gs[ctx.dataIndex]; return ` ${fmtPct(g.perDay)}/วัน${g.days > 1 ? ` (รวม ${fmtPct(g.gain)} ใน ${g.days} วัน)` : ''}`; } });
      if (anyDeath) { // จำนวนครั้งที่ตาย = จุดกากบาท แกนขวา
        gds.push({ type: 'line', order: -1, label: 'ตาย (ครั้ง)', data: dd, yAxisID: 'y1', showLine: false, pointStyle: 'crossRot', pointRadius: 7, pointHoverRadius: 9, borderColor: bad, backgroundColor: bad, borderWidth: 2.5 });
        gOpts.scales.y1 = { position: 'right', min: 0, suggestedMax: 5, grid: { drawOnChartArea: false }, border: { display: false }, ticks: { color: bad, precision: 0 } };
      }
      mkChart('expGainChart', { type: 'bar', data: { labels: gs.map(g => g.date), datasets: gds }, options: gOpts });
    }
  }

  // เทียบทุกตัว: EXP สะสมในช่วง (เริ่ม 0 ที่จุดแรกของช่วง)
  const dateSet = new Set(); const per = {};
  for (const ch of chars) {
    const a = snapsOf(ch.id).filter(hasExp);
    const ld = a.length ? a[a.length - 1].date : null;
    const f = UI.expRange && ld ? addDays(ld > lastDate ? ld : lastDate, -UI.expRange) : '0000';
    let sub = a.filter(s => s.date >= f);
    const b = a.filter(s => s.date < f).pop(); if (b) sub = [b, ...sub];
    if (sub.length < 2) continue;
    const base = netExp(sub[0]);
    per[ch.id] = Object.fromEntries(sub.map(s => [s.date, netExp(s) - base]));
    sub.forEach(s => dateSet.add(s.date));
  }
  const cmpDates = [...dateSet].sort();
  const cmpDs = chars.filter(ch => per[ch.id]).map(ch => lineDs(ch.name, cmpDates.map(d => per[ch.id][d] ?? null), colorOf(ch)));
  if (!cmpDs.length) emptyChart('expCompareChart', 'ต้องมีข้อมูลอย่างน้อย 2 วัน');
  else mkChart('expCompareChart', { type: 'line', data: { labels: cmpDates, datasets: cmpDs }, options: baseOpts({ yFmt: v => v + '%' }) });
}

/* ------------------------------------------------------------------ tab: การเงิน */
function renderMoney() {
  const A = assetsSeries();
  const R = sliceRange(A, UI.moneyRange);
  const n = R.dates.length;
  const total = n ? R.total[n - 1] : null;
  const d1 = n > 1 ? total - R.total[n - 2] : null;
  const dr = n > 1 ? total - R.total[0] : null;
  const span = n > 1 ? Math.max(1, daysBetween(R.dates[0], R.dates[n - 1])) : null;
  const goal = S.settings.goal_gold;
  let goalTile = '';
  if (goal && n) {
    const remain = goal - total, perDay = span ? dr / span : 0;
    goalTile = remain <= 0 ? tile(`เป้า ${fmtM(goal, 0)}`, 'ถึงแล้ว', `เกินเป้า ${fmtM(-remain)}`, 'up')
      : tile(`ถึงเป้า ${fmtM(goal, 0)}`, perDay > 0 ? fmtDays(remain / perDay) : '—', `เหลือ ${fmtM(remain)} · คิดจากเฉลี่ยช่วงที่เลือก`);
  }
  $('#moneyTiles').innerHTML =
    tile('ทรัพย์สินรวม', fmtM(total), n ? `เต็มจำนวน ${fmtInt(total)}` : 'ยังไม่มีข้อมูล') +
    tile('เปลี่ยนจากครั้งก่อน', fmtSigned(d1), '', deltaCls(d1)) +
    tile('เปลี่ยนในช่วงที่เลือก', fmtSigned(dr), span ? `${span} วัน` : '', deltaCls(dr)) +
    tile('เฉลี่ยต่อวัน', span ? fmtSigned(dr / span) : '—', '', deltaCls(dr)) + goalTile;

  // เงินที่เปลี่ยนแยกรายตัวในช่วงที่เลือก
  const from = UI.moneyRange && A.dates.length ? addDays(A.dates[A.dates.length - 1], -UI.moneyRange) : '0000';
  const chg = {}; S.characters.forEach(c => (chg[c.id] = goldChange(snapsOf(c.id), from)));
  const chgVault = goldChange(S.vault, from);
  const bars = S.characters.filter(c => chg[c.id]).map(c => ({ name: c.name, color: colorOf(c), ...chg[c.id] }));
  if (chgVault) bars.push({ name: 'คลัง/อื่นๆ', color: VAULT_COLOR(), ...chgVault });
  if (!bars.length) emptyChart('moneyCharChart', 'ต้องมีข้อมูลอย่างน้อย 2 วัน');
  else {
    const o = baseOpts({ legend: false, yFmt: fmtAxisM, tooltipLabel: ctx => { const b = bars[ctx.dataIndex]; return ` ${fmtSigned(b.perDay)}/วัน (รวม ${fmtSigned(b.change)} ใน ${b.days} วัน)`; } });
    o.scales.x.ticks.callback = function (v) { return this.getLabelForValue(v); };
    mkChart('moneyCharChart', { type: 'bar', data: { labels: bars.map(b => b.name), datasets: [{ label: 'ต่อวัน', data: bars.map(b => b.perDay), backgroundColor: bars.map(b => (b.perDay < 0 ? cssVar('--bad') : b.color)), borderRadius: 4, borderSkipped: 'bottom', maxBarThickness: 44 }] }, options: o });
  }
  const chgCells = x => `<td class="${deltaCls(x?.change)}">${x ? fmtSigned(x.change) : '—'}</td><td class="${deltaCls(x?.perDay)}">${x ? fmtSigned(x.perDay) : '—'}</td>`;

  if (!n) { ['moneyTotalChart', 'moneyStackChart', 'moneyDeltaChart'].forEach(id => emptyChart(id)); }
  else {
    const c1 = cssVar('--s1');
    mkChart('moneyTotalChart', { type: 'line', data: { labels: R.dates, datasets: [lineDs('ทรัพย์สินรวม', R.total, c1)] },
      options: baseOpts({ yFmt: fmtAxisM, legend: false, tooltipLabel: ctx => ` ${fmtM(ctx.parsed.y)}` }) });

    const stackDs = S.characters.filter(c => R.byChar[c.id].some(v => v)).map(c => lineDs(c.name, R.byChar[c.id], colorOf(c), { fill: true, backgroundColor: hexA(colorOf(c), 0.55), pointRadius: 0, borderWidth: 1 }));
    if (R.vault.some(v => v)) stackDs.push(lineDs('คลัง/อื่นๆ', R.vault, VAULT_COLOR(), { fill: true, backgroundColor: hexA(VAULT_COLOR(), 0.55), pointRadius: 0, borderWidth: 1 }));
    mkChart('moneyStackChart', { type: 'line', data: { labels: R.dates, datasets: stackDs }, options: baseOpts({ yFmt: fmtAxisM, stacked: true, yMin: 0, tooltipLabel: ctx => ` ${ctx.dataset.label}: ${fmtM(ctx.parsed.y)}` }) });

    const dl = [], dd = [];
    for (let i = 1; i < n; i++) { dl.push(R.dates[i]); dd.push(R.total[i] - R.total[i - 1]); }
    if (!dd.length) emptyChart('moneyDeltaChart', 'ต้องมีข้อมูลอย่างน้อย 2 วัน');
    else mkChart('moneyDeltaChart', { type: 'bar', data: { labels: dl, datasets: [{ label: 'เปลี่ยนแปลง', data: dd, backgroundColor: dd.map(v => (v < 0 ? cssVar('--bad') : c1)), borderRadius: 4, borderSkipped: 'bottom', maxBarThickness: 28 }] },
      options: baseOpts({ legend: false, yFmt: fmtAxisM, tooltipLabel: ctx => ` ${fmtSigned(ctx.parsed.y)}` }) });
  }

  const latestTotal = A.total.length ? A.total[A.total.length - 1] : 0;
  const rows = S.characters.map(c => {
    const s = [...snapsOf(c.id)].reverse().find(x => x.gold != null);
    if (!s && !c.active) return '';
    const g = s?.gold ?? 0;
    return `<tr><td><span class="dot" style="background:${colorOf(c)}"></span>${esc(c.name)}${c.active ? '' : '<span class="tag">ปิดใช้</span>'}</td><td>${fmtM(g)}</td><td>${latestTotal ? fmtPct(g / latestTotal * 100, 1) : '—'}</td>${chgCells(chg[c.id])}<td class="l">${s ? fmtDate(s.date) : '—'}</td></tr>`;
  }).join('');
  const lv = S.vault[S.vault.length - 1];
  const vrow = lv ? `<tr><td><span class="dot" style="background:${VAULT_COLOR()}"></span>คลัง/อื่นๆ</td><td>${fmtM(lv.gold)}</td><td>${latestTotal ? fmtPct(lv.gold / latestTotal * 100, 1) : '—'}</td>${chgCells(chgVault)}<td class="l">${fmtDate(lv.date)}</td></tr>` : '';
  $('#moneyTable').innerHTML = `<thead><tr><th>ที่</th><th>เงิน (M)</th><th>สัดส่วน</th><th>เปลี่ยนในช่วง</th><th>เฉลี่ย/วัน</th><th style="text-align:left">ข้อมูล ณ</th></tr></thead><tbody>${rows + vrow}<tr><td><b>รวม</b></td><td><b>${fmtM(latestTotal)}</b></td><td>100%</td><td class="${deltaCls(dr)}"><b>${fmtSigned(dr)}</b></td><td class="${deltaCls(dr)}"><b>${span ? fmtSigned(dr / span) : '—'}</b></td><td></td></tr></tbody>`;
}

/* ------------------------------------------------------------------ tab: พิชิต */
function renderConq() {
  const chars = activeChars();
  if (!chars.find(c => c.id === UI.conqChar)) UI.conqChar = chars[0]?.id ?? null;
  $('#conqCharChips').innerHTML = chars.map(c =>
    `<button data-id="${c.id}" class="${c.id === UI.conqChar ? 'on' : ''}"><span class="dot" style="background:${colorOf(c)}"></span>${esc(c.name)}</button>`).join('');
  $('#conqCharChips').onclick = e => { const b = e.target.closest('button'); if (b) { UI.conqChar = +b.dataset.id; renderConq(); } };
  const c = charById(UI.conqChar);
  const ids = ['conqTotalChart', 'conqGainChart', 'conqCompareChart'];
  if (!c) { $('#conqTiles').innerHTML = ''; ids.forEach(id => emptyChart(id)); $('#conqTable').innerHTML = ''; return; }

  const all = conqSnaps(c.id);
  const lastDate = all.length ? all[all.length - 1].date : todayStr();
  const from = UI.conqRange ? addDays(lastDate, -UI.conqRange) : '0000';
  let arr = all.filter(s => s.date >= from);
  const before = all.filter(s => s.date < from).pop();
  if (before) arr = [before, ...arr];
  const last = all[all.length - 1], r = conqRateRecent(c.id);
  const gainRange = arr.length > 1 ? arr[arr.length - 1].conquer - arr[0].conquer : null;
  const spanDays = arr.length > 1 ? Math.max(1, daysBetween(arr[0].date, arr[arr.length - 1].date)) : null;
  const grand = chars.reduce((a, ch) => a + (lastConq(ch.id)?.conquer ?? 0), 0);
  $('#conqTiles').innerHTML =
    tile('พิชิตสะสม', fmtInt(last?.conquer), last ? `ณ ${fmtDate(last.date)}` : 'ยังไม่มีข้อมูล') +
    tile('อัตราล่าสุด', r ? fmtSignedInt(r.perDay) + '/วัน' : '—', r ? `เฉลี่ย ${r.days} วัน (${fmtDate(r.from)}–${fmtDate(r.to)})` : '', deltaCls(r?.perDay)) +
    tile('ได้ในช่วงที่เลือก', fmtSignedInt(gainRange), spanDays ? `${spanDays} วัน · เฉลี่ย ${fmtSignedInt(gainRange / spanDays)}/วัน` : '', deltaCls(gainRange)) +
    tile('รวมทุกตัว', fmtInt(grand), 'ผลรวมค่าล่าสุดของทุกตัว');

  const col = colorOf(c);
  if (!arr.length) { emptyChart('conqTotalChart'); emptyChart('conqGainChart'); }
  else {
    const labels = arr.map(s => s.date);
    mkChart('conqTotalChart', { type: 'line', data: { labels, datasets: [lineDs('พิชิตสะสม', arr.map(s => s.conquer), col)] },
      options: baseOpts({ legend: false, yFmt: v => fmtInt(v), tooltipLabel: ctx => ` ${fmtInt(ctx.parsed.y)}` }) });
    const gs = conqGainSeries(c.id).filter(g => g.date >= from);
    if (!gs.length) emptyChart('conqGainChart', 'ต้องมีข้อมูลอย่างน้อย 2 วัน');
    else mkChart('conqGainChart', { type: 'bar', data: { labels: gs.map(g => g.date), datasets: [{ label: '/วัน', data: gs.map(g => g.perDay), backgroundColor: gs.map(g => (g.perDay < 0 ? cssVar('--bad') : col)), borderRadius: 4, borderSkipped: 'bottom', maxBarThickness: 28 }] },
      options: baseOpts({ legend: false, yFmt: v => fmtInt(v), tooltipLabel: ctx => { const g = gs[ctx.dataIndex]; return ` ${fmtSignedInt(g.perDay)}/วัน${g.days > 1 ? ` (รวม ${fmtSignedInt(g.gain)} ใน ${g.days} วัน)` : ''}`; } }) });
  }

  // เทียบทุกตัว: ที่ได้เพิ่มในช่วง (เริ่ม 0 ที่จุดแรกของช่วง)
  const dateSet = new Set(); const per = {};
  for (const ch of chars) {
    const a = conqSnaps(ch.id);
    const ld = a.length ? a[a.length - 1].date : null;
    const f = UI.conqRange && ld ? addDays(ld > lastDate ? ld : lastDate, -UI.conqRange) : '0000';
    let sub = a.filter(s => s.date >= f);
    const b = a.filter(s => s.date < f).pop(); if (b) sub = [b, ...sub];
    if (sub.length < 2) continue;
    const base = sub[0].conquer;
    per[ch.id] = Object.fromEntries(sub.map(s => [s.date, s.conquer - base]));
    sub.forEach(s => dateSet.add(s.date));
  }
  const cmpDates = [...dateSet].sort();
  const cmpDs = chars.filter(ch => per[ch.id]).map(ch => lineDs(ch.name, cmpDates.map(d => per[ch.id][d] ?? null), colorOf(ch)));
  if (!cmpDs.length) emptyChart('conqCompareChart', 'ต้องมีข้อมูลอย่างน้อย 2 วัน');
  else mkChart('conqCompareChart', { type: 'line', data: { labels: cmpDates, datasets: cmpDs }, options: baseOpts({ yFmt: v => fmtInt(v), tooltipLabel: ctx => ` ${ctx.dataset.label}: ${fmtSignedInt(ctx.parsed.y)}` }) });

  const rows = chars.map(ch => {
    const l = lastConq(ch.id), cr = conqRateRecent(ch.id);
    return `<tr><td><span class="dot" style="background:${colorOf(ch)}"></span>${esc(ch.name)}</td><td>${fmtInt(l?.conquer)}</td><td class="${deltaCls(cr?.perDay)}">${cr ? fmtSignedInt(cr.perDay) : '—'}</td><td>${grand ? fmtPct((l?.conquer ?? 0) / grand * 100, 1) : '—'}</td><td class="l">${l ? fmtDate(l.date) : '—'}</td></tr>`;
  }).join('');
  $('#conqTable').innerHTML = `<thead><tr><th>ตัวละคร</th><th>พิชิตสะสม</th><th>ต่อวัน (7 วัน)</th><th>สัดส่วน</th><th style="text-align:left">ข้อมูล ณ</th></tr></thead><tbody>${rows}<tr><td><b>รวม</b></td><td><b>${fmtInt(grand)}</b></td><td></td><td>100%</td><td></td></tr></tbody>`;
}

/* ------------------------------------------------------------------ tab: ประวัติ */
function renderHistory() {
  const sel = $('#histChar');
  sel.innerHTML = '<option value="">ทั้งหมด</option>' + S.characters.map(c => `<option value="${c.id}" ${String(c.id) === UI.histChar ? 'selected' : ''}>${esc(c.name)}</option>`).join('');
  sel.onchange = () => { UI.histChar = sel.value; renderHistory(); };
  let rows = [...S.snapshots].sort((a, b) => b.date.localeCompare(a.date) || a.char_id - b.char_id);
  if (UI.histChar) rows = rows.filter(s => String(s.char_id) === UI.histChar);
  const body = rows.map(s => {
    const c = charById(s.char_id) || { name: '?', has_debt: false };
    return `<tr><td>${fmtDate(s.date)}</td><td class="l"><span class="dot" style="background:${colorOf(c)}"></span>${esc(c.name)}</td><td>${s.level ?? '—'}</td><td>${fmtPct(s.exp_pct)}</td><td>${c.has_debt ? fmtM(s.debt) : '—'}</td><td>${fmtM(s.gold)}</td><td>${fmtInt(s.conquer)}</td><td class="${s.deaths > 0 ? 'down' : ''}">${s.deaths ?? '—'}</td><td class="l hint">${esc(s.note)}</td><td><button class="small danger" data-del-snap="${s.id}">ลบ</button></td></tr>`;
  }).join('');
  $('#histTable').innerHTML = `<thead><tr><th>วันที่</th><th style="text-align:left">ตัวละคร</th><th>Lv</th><th>EXP%</th><th>ติดลบ (M)</th><th>เงิน (M)</th><th>พิชิต</th><th>ตาย</th><th style="text-align:left">โน้ต</th><th></th></tr></thead><tbody>${body || '<tr><td colspan="10" class="empty">ยังไม่มีข้อมูล</td></tr>'}</tbody>`;
  const vb = [...S.vault].reverse().map(v => `<tr><td>${fmtDate(v.date)}</td><td>${fmtM(v.gold)}</td><td class="l hint">${esc(v.note)}</td><td><button class="small danger" data-del-vault="${v.date}">ลบ</button></td></tr>`).join('');
  $('#vaultTable').innerHTML = `<thead><tr><th>วันที่</th><th>เงิน (M)</th><th style="text-align:left">โน้ต</th><th></th></tr></thead><tbody>${vb || '<tr><td colspan="4" class="empty">ยังไม่มีข้อมูล</td></tr>'}</tbody>`;
}
function confirmBtn(btn, fn) { // กด 2 ครั้งเพื่อยืนยัน
  if (btn.dataset.armed) return fn();
  btn.dataset.armed = '1'; const t = btn.textContent; btn.textContent = 'ยืนยัน?';
  setTimeout(() => { delete btn.dataset.armed; btn.textContent = t; }, 2500);
}

/* ------------------------------------------------------------------ tab: ตัวละคร */
function renderChars() {
  const rows = S.characters.map(c => charRow(c)).join('');
  $('#charTable').innerHTML = `<thead><tr><th style="text-align:left">ชื่อ</th><th style="text-align:left">อาชีพ</th><th>EXP ติดลบ</th><th>เป้า Lv</th><th>ลำดับ</th><th>ใช้งาน</th><th>บันทึกแล้ว</th><th></th></tr></thead><tbody>${rows}</tbody>`;
  $('#goalGold').value = goldToInput(S.settings.goal_gold);
}
async function saveGoalGold() {
  try {
    await api('/api/settings', { method: 'POST', body: JSON.stringify({ ...S.settings, goal_gold: parseGold($('#goalGold').value) }) });
    await loadState(); renderChars(); toast('บันทึกเป้าหมายแล้ว');
  } catch (e) { toast(e.message, true); }
}
async function importCSV(file) {
  try {
    const r = await api('/api/import', { method: 'POST', headers: { 'Content-Type': 'text/csv' }, body: await file.arrayBuffer() });
    await loadState(); render();
    const x = r.result;
    toast(`นำเข้าแล้ว ${x.snapshots} รายการ${x.vault ? ` · คลัง ${x.vault}` : ''}${x.new_characters ? ` · ตัวละครใหม่ ${x.new_characters}` : ''}${x.skipped ? ` · ข้าม ${x.skipped} แถว` : ''}`);
  } catch (e) { toast('นำเข้าไม่สำเร็จ: ' + e.message, true); }
}
function charRow(c) {
  const n = S.snapshots.filter(s => s.char_id === c.id).length;
  return `<tr data-char="${c.id || ''}">
    <td class="l"><span class="dot" style="background:${c.id ? colorOf(c) : cssVar('--muted')}"></span><input type="text" name="name" value="${esc(c.name)}" placeholder="ชื่อ"></td>
    <td class="l"><input type="text" name="job" value="${esc(c.job)}" placeholder="อาชีพ"></td>
    <td><input type="checkbox" name="has_debt" ${c.has_debt ? 'checked' : ''}></td>
    <td><input type="number" name="goal_level" min="1" step="1" placeholder="—" value="${c.goal_level ?? ''}" style="width:72px"></td>
    <td><input type="number" name="sort_order" value="${c.sort_order ?? 0}" style="width:64px"></td>
    <td><input type="checkbox" name="active" ${c.active ? 'checked' : ''}></td>
    <td>${n} รายการ</td>
    <td><button class="small" data-save-char>บันทึก</button> ${c.id ? `<button class="small danger" data-del-char="${c.id}" title="ลบพร้อมประวัติทั้งหมด">ลบ</button>` : ''}</td>
  </tr>`;
}
async function saveCharRow(tr) {
  const g = n => tr.querySelector(`[name=${n}]`);
  const payload = { id: +tr.dataset.char || 0, name: g('name').value, job: g('job').value, has_debt: g('has_debt').checked, goal_level: numOrNull(g('goal_level').value), sort_order: +g('sort_order').value || 0, active: g('active').checked };
  try { await api('/api/characters', { method: 'POST', body: JSON.stringify(payload) }); await loadState(); renderChars(); toast('บันทึกตัวละครแล้ว'); }
  catch (e) { toast(e.message, true); }
}

/* ------------------------------------------------------------------ router */
function render() {
  ({ entry: renderEntry, overview: renderOverview, exp: renderExp, money: renderMoney, conq: renderConq, history: renderHistory, chars: renderChars })[UI.tab]();
}
function switchTab(name) {
  UI.tab = name;
  history.replaceState(null, '', '#' + name);
  $$('#tabs button').forEach(b => b.classList.toggle('on', b.dataset.tab === name));
  $$('.tab').forEach(t => t.classList.toggle('on', t.id === 'tab-' + name));
  render();
}

document.addEventListener('DOMContentLoaded', async () => {
  $('#entryDate').value = todayStr();
  $('#tabs').onclick = e => { const b = e.target.closest('button'); if (b) switchTab(b.dataset.tab); };
  $('#entryDate').onchange = renderEntry;
  $('#btnToday').onclick = () => { $('#entryDate').value = todayStr(); renderEntry(); };
  $('#btnPrevDay').onclick = () => { $('#entryDate').value = addDays($('#entryDate').value, -1); renderEntry(); };
  $('#btnNextDay').onclick = () => { $('#entryDate').value = addDays($('#entryDate').value, 1); renderEntry(); };
  $('#btnSave').onclick = saveEntry;
  $('#btnSaveGoal').onclick = saveGoalGold;
  $('#goalGold').onchange = e => { e.target.value = goldToInput(parseGold(e.target.value)); };
  $('#btnImport').onclick = () => $('#importFile').click();
  $('#importFile').onchange = e => { const f = e.target.files[0]; e.target.value = ''; if (f) importCSV(f); };
  $$('.chips.range').forEach(box => box.onclick = e => {
    const b = e.target.closest('button'); if (!b) return;
    $$('button', box).forEach(x => x.classList.toggle('on', x === b));
    UI[{ exp: 'expRange', money: 'moneyRange', conq: 'conqRange' }[box.dataset.for]] = +b.dataset.range;
    render();
  });
  document.addEventListener('click', async e => {
    const t = e.target.closest('button'); if (!t) return;
    if (t.dataset.delSnap) confirmBtn(t, async () => { await api('/api/snapshots/' + t.dataset.delSnap, { method: 'DELETE' }); await loadState(); renderHistory(); toast('ลบแล้ว'); });
    if (t.dataset.delVault) confirmBtn(t, async () => { await api('/api/vault/' + t.dataset.delVault, { method: 'DELETE' }); await loadState(); renderHistory(); toast('ลบแล้ว'); });
    if (t.hasAttribute('data-save-char')) saveCharRow(t.closest('tr'));
    if (t.dataset.delChar) confirmBtn(t, async () => { await api('/api/characters/' + t.dataset.delChar, { method: 'DELETE' }); await loadState(); renderChars(); toast('ลบตัวละครแล้ว'); });
  });
  $('#btnAddChar').onclick = () => {
    const tb = $('#charTable tbody');
    tb.insertAdjacentHTML('beforeend', charRow({ id: 0, name: '', job: '', has_debt: false, sort_order: S.characters.length, active: true }));
    tb.lastElementChild.querySelector('[name=name]').focus();
  };
  document.addEventListener('keydown', e => { if ((e.ctrlKey || e.metaKey) && e.key === 's' && UI.tab === 'entry') { e.preventDefault(); saveEntry(); } });
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', render);
  try { await loadState(); } catch (e) { toast('โหลดข้อมูลไม่ได้: ' + e.message, true); }
  const qc = +new URLSearchParams(location.search).get('c'); if (qc) { UI.expChar = qc; UI.conqChar = qc; }
  const h = location.hash.replace('#', '');
  if (['entry', 'overview', 'exp', 'money', 'conq', 'history', 'chars'].includes(h)) switchTab(h); else render();
});
