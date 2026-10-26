import { DATA_KEY, ACTIVATIONS } from './local-data.js';

// Подсказки для админа при заполнении базы (в заявках выбор — только из базы)
const MODEL_HINTS = ['iPhone 17 Pro Max', 'iPhone 17 Pro', 'iPhone Air', 'iPhone 17', 'iPhone 16 Pro Max', 'iPhone 16 Pro',
  'iPhone 16 Plus', 'iPhone 16', 'iPhone 16e', 'iPhone 15 Pro Max', 'iPhone 15 Pro', 'iPhone 15 Plus', 'iPhone 15', 'iPhone 14', 'iPhone 13'];
const STORAGE_HINTS = ['128 ГБ', '256 ГБ', '512 ГБ', '1 ТБ', '2 ТБ'];
const COLOR_HINTS = ['Cosmic Orange', 'Deep Blue', 'Silver', 'Black', 'White', 'Lavender', 'Sage', 'Mist Blue', 'Sky Blue',
  'Light Gold', 'Space Black', 'Natural Titanium', 'Desert Titanium', 'Black Titanium', 'White Titanium', 'Ultramarine', 'Teal', 'Pink'];
const SIM_HINTS = ['SIM', '2 SIM', 'SIM + eSIM', 'eSIM'];
const STORAGE_ORDER = s => (parseInt(s) || 0) * (/ТБ|TB/i.test(s) ? 1024 : 1);

const DAYS = ['Понедельник', 'Вторник', 'Среда', 'Четверг', 'Пятница', 'Суббота', 'Воскресенье'];
const MONTHS = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
const STATUS_LABEL = { new: 'В работе', sold: 'Продано', cancel: 'Отказ' };
const DW = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];
const MON_SHORT = ['янв', 'фев', 'мар', 'апр', 'мая', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];
// Образцы цветов для базы и карточек; у неизвестного цвета кружка нет
const SWATCH = { 'cosmic orange': '#e8743b', orange: '#e8743b', blue: '#3b6fd8', 'deep blue': '#34466b', silver: '#d9dadc', black: '#1f1f22', white: '#f2f2f0',
  lavender: '#c9b8e8', sage: '#a9b89a', 'mist blue': '#a8c0d8', 'sky blue': '#b6d4ec', 'light gold': '#e8d8b0', 'space black': '#2b2b2e',
  'natural titanium': '#bdb6aa', 'desert titanium': '#c9ad8f', desert: '#c9ad8f', 'black titanium': '#3a3a3c', 'white titanium': '#e6e4df',
  ultramarine: '#5468d8', teal: '#5fa8a6', pink: '#f2b8c6' };

const $ = s => document.querySelector(s);
const tg = window.Telegram?.WebApp;
tg?.ready(); tg?.expand();

const store = {
  get: k => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k, v) => { try { localStorage.setItem(k, v); } catch {} },
};
const state = {
  token: store.get('token'),
  me: null,
  view: 'week',
  weekStart: mondayOf(new Date()),
  orders: [],
  products: [],
  users: [],
  sellers: [], // все имена продавцов из заявок и аккаунтов
  mineFilter: 'active',
  statsPeriod: 'week',
  adminPane: 'products',
  editing: null,
  flipped: new Set(), // дни недели, которые свернули/раскрыли вручную
  openModels: new Set(), // модели в «Базе», раскрытые вручную; остальные свёрнуты
};
const isAdmin = () => state.me?.role === 'admin';

// ---------- утилиты ----------
function iso(d) { return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; }
function parse(s) { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); }
function mondayOf(d) { const x = new Date(d.getFullYear(), d.getMonth(), d.getDate()); x.setDate(x.getDate() - (x.getDay() + 6) % 7); return x; }
function addDays(d, n) { const x = new Date(d); x.setDate(x.getDate() + n); return x; }
const money = n => (n || 0).toLocaleString('ru-RU') + ' ₽';
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const uniq = a => [...new Set(a)];
function sellerColor(name) {
  let h = 0; for (const c of name || '') h = (h * 31 + c.charCodeAt(0)) % 360;
  return `hsl(${h} 70% 60%)`;
}
function dayTitle(s) { const d = parse(s); return `${DAYS[(d.getDay() + 6) % 7]} · ${d.getDate()} ${MONTHS[d.getMonth()]}`; }
function toast(t) { const el = $('#toast'); el.textContent = t; el.classList.add('show'); clearTimeout(toast.t); toast.t = setTimeout(() => el.classList.remove('show'), 1800); }
const swatch = c => SWATCH[String(c || '').trim().toLowerCase()] || '';
const short = n => n >= 1e6 ? (n / 1e6).toFixed(1).replace('.0', '') + ' млн' : n >= 1000 ? Math.round(n / 1000) + 'к' : String(n || 0);
const sumOf = l => l.reduce((s, o) => s + (o.price || 0), 0);
const byTime = (a, b) => (a.time || '99').localeCompare(b.time || '99');
const isLate = o => o.status === 'new' && o.date < iso(new Date());
const plural = (n, one, few, many) => `${n} ${n % 10 === 1 && n % 100 !== 11 ? one : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 10 || n % 100 >= 20) ? few : many}`;
const fmtPrice = v => { const n = String(v ?? '').replace(/\D/g, ''); return n ? Number(n).toLocaleString('ru-RU') : ''; };

function formatPhone(v) {
  let d = v.replace(/\D/g, '');
  if (!d) return '';
  if (d[0] === '8') d = '7' + d.slice(1);
  if (d[0] !== '7') d = '7' + d;
  d = d.slice(0, 11);
  let r = '+7';
  if (d.length > 1) r += ' (' + d.slice(1, 4);
  if (d.length >= 4) r += ')';
  if (d.length > 4) r += ' ' + d.slice(4, 7);
  if (d.length > 7) r += '-' + d.slice(7, 9);
  if (d.length > 9) r += '-' + d.slice(9, 11);
  return r;
}

// Все данные — в общей базе на сервере, чтобы телефон и компьютер видели одно и то же.
async function api(path, opts = {}) {
  const res = await fetch('/api/data?path=' + encodeURIComponent(path), {
    ...opts,
    headers: { 'Content-Type': 'application/json', 'x-token': state.token || '' },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  if (res.status === 401 && path !== '/login') { showLogin(); throw new Error('auth'); }
  const data = await res.json().catch(() => ({ error: 'Сервер не отвечает' }));
  if (!res.ok) throw new Error(data.error || 'Ошибка');
  return data;
}
const fail = err => { if (err.message !== 'auth') toast(err.message); };

// ---------- вход / выход ----------
$('#loginForm').onsubmit = async e => {
  e.preventDefault();
  $('#loginErr').textContent = '';
  try {
    const { token, user } = await api('/login', { method: 'POST', body: { login: $('#loginName').value, password: $('#loginPass').value } });
    state.token = token; state.me = user;
    store.set('token', token); store.set('login', user.login);
    $('#loginPass').value = '';
    start();
  } catch (err) {
    $('#loginErr').textContent = err.message;
  }
};
function showLogin() {
  state.token = null; state.me = null; store.set('token', '');
  $('#app').classList.add('hidden'); $('#login').classList.remove('hidden');
  $('#loginName').value = store.get('login') || '';
}
$('#meBtn').onclick = async () => {
  if (!confirm(`Выйти из аккаунта «${state.me.name}»?`)) return;
  await api('/logout', { method: 'POST' }).catch(() => {});
  showLogin();
};

// ---------- загрузка ----------
async function loadRefs() {
  [state.products, state.users, state.sellers] = await Promise.all([api('/products'), api('/users'), api('/sellers')]);
  fillProductModels();
  const f = $('#sellerFilter'), cur = f.value;
  f.innerHTML = '<option value="">Все продавцы</option>' + state.sellers.map(n => `<option>${esc(n)}</option>`).join('');
  f.value = state.sellers.includes(cur) ? cur : '';
  $('#sellerList').innerHTML = state.sellers.map(n => `<option value="${esc(n)}">`).join('');
}

async function render() {
  $('#meBtn').innerHTML = `<span class="avatar" style="--seller:${sellerColor(state.me.name)}">${esc(state.me.name[0] || '?')}</span><span class="me-name">${esc(state.me.name)}</span>`;
  // Продавец видит базу только как остатки, без редактирования
  $('#adminTab span').textContent = $('#adminTitle').textContent = isAdmin() ? 'База' : 'Наличие';
  for (const t of document.querySelectorAll('.tab')) t.classList.toggle('active', t.dataset.view === state.view);
  for (const v of ['week', 'mine', 'stats', 'admin']) $(`#${v}View`).classList.toggle('hidden', state.view !== v);
  $('#fab').classList.toggle('hidden', state.view === 'admin' && isAdmin());
  $('#newBtn').classList.toggle('hidden', state.view === 'admin' && isAdmin());
  $('#importData').classList.toggle('hidden', !isAdmin());
  await loadRefs();
  if (state.view === 'stats') return renderStats();
  if (state.view === 'admin') return renderAdmin();
  const from = iso(state.weekStart), to = iso(addDays(state.weekStart, 6));
  state.orders = await api(state.view === 'week' ? `/orders?from=${from}&to=${to}` : '/orders');
  state.view === 'week' ? renderWeek() : renderMine();
}

// ---------- карточка ----------
// Карточка: время + статус → клиент → телефон-модель с параметрами → цена → комментарий → продавец.
// withDate — показать дату рядом со временем (для списков, где заявки не сгруппированы по дню)
function card(o, withDate = false) {
  const tel = (o.phone || '').replace(/[^\d+]/g, '');
  const late = isLate(o), d = parse(o.date);
  const when = withDate ? `${d.getDate()} ${MON_SHORT[d.getMonth()]}${o.time ? ' · ' + o.time : ''}` : o.time;
  const specs = [o.storage, o.color, o.sim, o.activation].filter(Boolean)
    .map(s => s === o.color && swatch(s) ? `<span><i class="sw" style="background:${swatch(s)}"></i>${esc(s)}</span>` : `<span>${esc(s)}</span>`);
  return `<div class="card ${o.status} ${late ? 'late' : ''}" data-id="${o.id}" style="--seller:${sellerColor(o.seller)}">
    <div class="c-head">
      <span class="c-time ${when ? '' : 'none'} ${withDate ? 'dated' : ''}">${when ? esc(when) : 'без времени'}</span>
      <span class="c-badge ${late ? 'late' : o.status}">${late ? 'Просрочена' : STATUS_LABEL[o.status]}</span>
    </div>
    <div class="c-client">
      <div class="c-name">${esc(o.client)}</div>
      ${o.phone ? `<a class="c-phone" href="tel:${esc(tel)}" onclick="event.stopPropagation()">${esc(o.phone)}</a>` : ''}
    </div>
    <div class="c-device">
      <div class="c-model">${esc(o.model || '—')}</div>
      ${specs.length ? `<div class="c-specs">${specs.join('')}</div>` : ''}
    </div>
    ${o.comment ? `<div class="c-comment">${esc(o.comment)}</div>` : ''}
    <div class="c-foot">
      <span class="c-seller"><span class="dot"></span>${esc(o.seller)}</span>
      <span class="c-price">${o.price ? money(o.price) : ''}</span>
    </div>
  </div>`;
}
document.addEventListener('click', e => {
  const c = e.target.closest('.card');
  if (c) return openForm(state.orders.find(o => o.id === c.dataset.id));
  const add = e.target.closest('.add-day');
  if (add) return openForm(null, add.dataset.date);
  const t = e.target.closest('[data-toggle]');
  if (t) { const k = t.dataset.toggle; state.flipped.has(k) ? state.flipped.delete(k) : state.flipped.add(k); return renderWeek(); }
  const l = e.target.closest('#weekSide .lead');
  if (l) { const f = $('#sellerFilter'); f.value = f.value === l.dataset.seller ? '' : l.dataset.seller; renderWeek(); }
});

// ---------- общие блоки: цифры, график, продавцы ----------
function kpis(list) {
  const sold = list.filter(o => o.status === 'sold'), work = list.filter(o => o.status === 'new');
  const cancel = list.filter(o => o.status === 'cancel').length, late = work.filter(isLate).length;
  return `<div class="kpis">
    <div class="kpi"><div class="l">Выручка</div><div class="v">${money(sumOf(sold))}</div><div class="s">${plural(sold.length, 'телефон продан', 'телефона продано', 'телефонов продано')}</div></div>
    <div class="kpi"><div class="l">В работе</div><div class="v amber">${work.length}</div><div class="s">на ${money(sumOf(work))}${late ? ` · <span class="red">${late} просрочено</span>` : ''}</div></div>
    <div class="kpi"><div class="l">Средний чек</div><div class="v">${money(sold.length ? Math.round(sumOf(sold) / sold.length) : 0)}</div><div class="s">по проданным</div></div>
    <div class="kpi"><div class="l">Конверсия</div><div class="v">${sold.length + cancel ? Math.round(sold.length / (sold.length + cancel) * 100) : 0}%</div><div class="s">продано из закрытых · ${plural(cancel, 'отказ', 'отказа', 'отказов')}</div></div>
  </div>`;
}

// items: [{ label, value, cls }], cls — 'today' | 'future'. Больше 12 столбиков — без подписей сумм.
function bars(items) {
  if (!items.some(it => it.value > 0)) return '<div class="chart-empty">За этот период продаж пока нет</div>';
  const max = Math.max(1, ...items.map(i => i.value)), dense = items.length > 12;
  return `<div class="bars ${dense ? 'dense' : ''}">${items.map((it, i) => `<div class="b ${it.cls || ''}" title="${esc(it.label)}: ${money(it.value)}">
    <em>${!dense && it.value ? short(it.value) : ''}</em>
    <div class="bw"><i style="height:${(it.value / max * 100).toFixed(1)}%"></i></div>
    <span>${!dense || i === 0 || (i + 1) % 5 === 0 ? esc(it.label) : ''}</span>
  </div>`).join('')}</div>`;
}

function sellerRows(list) {
  return uniq(list.map(o => o.seller)).map(name => {
    const all = list.filter(o => o.seller === name), sold = all.filter(o => o.status === 'sold');
    const closed = all.filter(o => o.status !== 'new').length;
    return { name, cnt: sold.length, sum: sumOf(sold), work: all.length - closed,
      avg: sold.length ? Math.round(sumOf(sold) / sold.length) : 0, conv: closed ? Math.round(sold.length / closed * 100) : null };
  }).sort((a, b) => b.sum - a.sum || b.work - a.work);
}

// ---------- неделя: повестка ----------
function renderWeek() {
  const ws = state.weekStart, we = addDays(ws, 6), now = new Date();
  $('#weekTitle').textContent = ws.getMonth() === we.getMonth()
    ? `${ws.getDate()}–${we.getDate()} ${MONTHS[we.getMonth()]}`
    : `${ws.getDate()} ${MONTHS[ws.getMonth()]} – ${we.getDate()} ${MONTHS[we.getMonth()]}`;
  const filter = $('#sellerFilter').value;
  const list = state.orders.filter(o => !filter || o.seller === filter);
  const today = iso(now), tomorrow = iso(addDays(now, 1)), yesterday = iso(addDays(now, -1));
  const keys = DAYS.map((_, i) => iso(addDays(ws, i))), hasToday = keys.includes(today);
  $('#weekSum').textContent = (list.length ? plural(list.length, 'заявка', 'заявки', 'заявок') : 'Заявок пока нет') + (filter ? ` · ${filter}` : '');
  $('#weekKpis').innerHTML = kpis(list);

  $('#week').innerHTML = keys.map((key, i) => {
    const d = parse(key), items = list.filter(o => o.date === key).sort(byTime);
    const rel = { [today]: 'Сегодня', [tomorrow]: 'Завтра', [yesterday]: 'Вчера' }[key];
    const name = rel ? `${rel}<span class="ag-dw">${DAYS[i].toLowerCase()}</span>` : DAYS[i];
    const cls = `${key === today ? 'today' : ''} ${key < today ? 'past' : ''}`;
    if (!items.length) return `<div class="ag blank ${cls}"><div class="ag-head">
      <span class="ag-num">${d.getDate()}</span><span class="ag-name">${name}</span><span class="ag-sub">заявок нет</span>
      <button class="add-day" data-date="${key}">+ Заявка</button></div></div>`;
    // На текущей неделе прошедшие дни свёрнуты в итог; клик по дню меняет это для него
    const open = !(hasToday && key < today) !== state.flipped.has(key);
    const sold = items.filter(o => o.status === 'sold'), late = items.filter(isLate).length;
    const sub = [plural(items.length, 'заявка', 'заявки', 'заявок'),
      sold.length && `продано ${sold.length} на ${money(sumOf(sold))}`,
      late && `<span class="red">${late} просрочено</span>`].filter(Boolean).join(' · ');
    const mix = ['sold', 'new', 'cancel'].map(s => { const n = items.filter(o => o.status === s).length; return n ? `<i class="${s}" style="flex:${n}"></i>` : ''; }).join('');
    return `<div class="ag ${cls} ${open ? 'open' : ''}">
      <button class="ag-head" data-toggle="${key}" aria-expanded="${open}">
        <span class="ag-num">${d.getDate()}</span>
        <span class="ag-title"><span class="ag-name">${name}</span><span class="ag-sub">${sub}</span></span>
        <span class="mix">${mix}</span><span class="chev">›</span>
      </button>
      ${open ? `<div class="ag-body">${items.map(o => card(o)).join('')}<button class="add-day" data-date="${key}">+ Добавить заявку</button></div>` : ''}
    </div>`;
  }).join('');

  const rows = sellerRows(state.orders), max = Math.max(1, ...rows.map(r => r.sum));
  $('#weekSide').innerHTML = `
    <div class="box"><h3>Выручка по дням</h3>${bars(keys.map((k, i) => ({
      label: DW[i], value: sumOf(list.filter(o => o.date === k && o.status === 'sold')), cls: k === today ? 'today' : k > today ? 'future' : '' })))}</div>
    <div class="box"><h3>Продавцы недели</h3>${rows.length ? rows.map(r => `<button class="lead ${r.name === filter ? 'on' : ''}" data-seller="${esc(r.name)}" style="--seller:${sellerColor(r.name)}">
        <span class="avatar sm">${esc(r.name[0] || '?')}</span>
        <span class="lead-main"><span class="lead-name">${esc(r.name)}</span><span class="lead-sub">${r.cnt} продано · ${r.work} в работе</span><span class="meter"><i style="width:${(r.sum / max * 100).toFixed(1)}%"></i></span></span>
        <b class="num">${money(r.sum)}</b></button>`).join('') + '<p class="hint">Нажмите на продавца, чтобы оставить только его заявки</p>'
      : '<div class="empty sm">Пока пусто</div>'}</div>`;
}
$('#prevWeek').onclick = () => { state.weekStart = addDays(state.weekStart, -7); render().catch(fail); };
$('#nextWeek').onclick = () => { state.weekStart = addDays(state.weekStart, 7); render().catch(fail); };
$('#todayBtn').onclick = async () => {
  state.weekStart = mondayOf(new Date());
  try {
    await render();
    $('#week .today')?.scrollIntoView({ block: 'start', behavior: 'instant' });
  } catch (err) { fail(err); }
};
$('#sellerFilter').onchange = renderWeek;

// ---------- мои заказы ----------
const MINE_TABS = { active: 'Активные', sold: 'Проданы', all: 'Все' };
const sameName = (a, b) => a.trim().toLowerCase() === b.trim().toLowerCase();
function renderMine() {
  const now = new Date(), today = iso(now), tomorrow = iso(addDays(now, 1));
  const name = $('#mineName').value.trim();
  if (!name) {
    for (const b of $('#mineSeg').children) b.textContent = MINE_TABS[b.dataset.f];
    $('#mineList').innerHTML = '<div class="empty">Впишите своё имя сверху — покажем все заявки, оформленные на него</div>';
    return;
  }
  const mine = state.orders.filter(o => sameName(o.seller, name));
  const work = mine.filter(o => o.status === 'new'), sold = mine.filter(o => o.status === 'sold');
  const late = work.filter(isLate), soldMonth = sold.filter(o => o.date.startsWith(today.slice(0, 7)));
  const counts = { active: work.length, sold: sold.length, all: mine.length };
  for (const b of $('#mineSeg').children) b.innerHTML = `${MINE_TABS[b.dataset.f]}<small>${counts[b.dataset.f]}</small>`;

  let html = `<div class="kpis three">
    <div class="kpi"><div class="l">В работе</div><div class="v amber">${work.length}</div><div class="s">на ${money(sumOf(work))}</div></div>
    <div class="kpi"><div class="l">Просрочено</div><div class="v ${late.length ? 'red' : ''}">${late.length}</div><div class="s">${late.length ? 'отметьте «Продано» или «Отказ»' : 'всё под контролем'}</div></div>
    <div class="kpi"><div class="l">Продано в этом месяце</div><div class="v">${money(sumOf(soldMonth))}</div><div class="s">${plural(soldMonth.length, 'телефон', 'телефона', 'телефонов')}</div></div>
  </div>`;

  const f = state.mineFilter, groups = [];
  let list = f === 'active' ? work : f === 'sold' ? sold : mine;
  if (f === 'active') {
    list = list.slice().sort((a, b) => (a.date + (a.time || '99')).localeCompare(b.date + (b.time || '99')));
    if (late.length) groups.push({ title: 'Просрочены — уточните у клиента', red: true, withDate: true, items: list.filter(isLate) });
    list = list.filter(o => !isLate(o));
  }
  for (const o of list) {
    let g = groups[groups.length - 1];
    if (!g || g.key !== o.date) groups.push(g = { key: o.date, items: [],
      title: o.date === today ? `Сегодня · ${dayTitle(o.date)}` : o.date === tomorrow ? `Завтра · ${dayTitle(o.date)}` : dayTitle(o.date) });
    g.items.push(o);
  }
  html += groups.length
    ? groups.map(g => `<section class="grp"><h3 class="grp-title ${g.red ? 'red' : ''}">${esc(g.title)}<span>${g.items.length}</span></h3>
        <div class="cards">${g.items.map(o => card(o, g.withDate)).join('')}</div></section>`).join('')
    : `<div class="empty">${f === 'active' ? 'Активных заявок нет — нажмите «Новая заявка»' : 'Заявок нет'}</div>`;
  $('#mineList').innerHTML = html;
}
$('#mineName').value = store.get('sellerName') || '';
$('#mineName').oninput = () => { store.set('sellerName', $('#mineName').value.trim()); renderMine(); };
$('#mineSeg').onclick = e => {
  const b = e.target.closest('button'); if (!b) return;
  state.mineFilter = b.dataset.f;
  for (const x of $('#mineSeg').children) x.classList.toggle('on', x === b);
  renderMine();
};

// ---------- продажи ----------
async function renderStats() {
  const now = new Date(), today = iso(now), p = state.statsPeriod;
  let from, to;
  if (p === 'week') { const m = mondayOf(now); from = iso(m); to = iso(addDays(m, 6)); }
  if (p === 'month') { from = iso(new Date(now.getFullYear(), now.getMonth(), 1)); to = iso(new Date(now.getFullYear(), now.getMonth() + 1, 0)); }
  const list = await api(from ? `/orders?from=${from}&to=${to}` : '/orders');
  const sold = list.filter(o => o.status === 'sold');
  const day = (k, label) => ({ label, value: sumOf(sold.filter(o => o.date === k)), cls: k === today ? 'today' : k > today ? 'future' : '' });
  const items = p === 'week' ? DW.map((l, i) => day(iso(addDays(parse(from), i)), l))
    : p === 'month' ? Array.from({ length: parse(to).getDate() }, (_, i) => day(iso(new Date(now.getFullYear(), now.getMonth(), i + 1)), String(i + 1)))
    : Array.from({ length: 12 }, (_, i) => {
      const d = new Date(now.getFullYear(), now.getMonth() - 11 + i, 1), pre = iso(d).slice(0, 7);
      return { label: MON_SHORT[d.getMonth()], value: sumOf(sold.filter(o => o.date.startsWith(pre))), cls: i === 11 ? 'today' : '' };
    });

  const rows = sellerRows(list), total = Math.max(1, sumOf(sold));
  const models = uniq(sold.map(o => o.model)).map(m => { const l = sold.filter(o => o.model === m); return { m, cnt: l.length, sum: sumOf(l) }; })
    .sort((a, b) => b.cnt - a.cnt || b.sum - a.sum).slice(0, 8);

  $('#statsBox').innerHTML = kpis(list) + `<div class="stats-grid">
    <div class="box wide"><h3>Выручка ${p === 'all' ? 'по месяцам' : 'по дням'}</h3>${bars(items)}</div>
    <div class="box"><h3>Продавцы</h3>${rows.length ? `
      <div class="trow th"><span>Продавец</span><span>Шт</span><span>Выручка</span><span class="hide-sm">Ср. чек</span><span class="hide-sm">Конв.</span></div>
      ${rows.map(r => `<div class="trow" style="--seller:${sellerColor(r.name)}">
        <span class="t-name"><span class="avatar sm">${esc(r.name[0] || '?')}</span><span>${esc(r.name)}<small>${Math.round(r.sum / total * 100)}% выручки · ${r.work} в работе</small></span></span>
        <span class="num">${r.cnt}</span><span class="num">${money(r.sum)}</span>
        <span class="num hide-sm">${r.avg ? money(r.avg) : '—'}</span><span class="num hide-sm">${r.conv == null ? '—' : r.conv + '%'}</span>
        <span class="meter"><i style="width:${(r.sum / total * 100).toFixed(1)}%"></i></span>
      </div>`).join('')}` : '<div class="empty sm">Заявок за период нет</div>'}</div>
    <div class="box"><h3>Что покупают</h3>${models.length ? models.map((m, i) => `<div class="mrow">
        <span><span class="rank">${i + 1}</span>${esc(m.m || '—')}</span><span class="muted">${m.cnt} шт</span><b class="num">${money(m.sum)}</b></div>`).join('')
      : '<div class="empty sm">Продаж за период нет. Отметьте заявку «✅ Продано».</div>'}</div>
  </div>`;
}
$('#statsSeg').onclick = e => {
  const b = e.target.closest('button'); if (!b) return;
  state.statsPeriod = b.dataset.p;
  for (const x of $('#statsSeg').children) x.classList.toggle('on', x === b);
  renderStats().catch(fail);
};

// ---------- база (только админ) ----------
function fillProductModels() {
  const select = $('#productModel'), current = select.value;
  const models = uniq([...MODEL_HINTS, ...state.products.map(p => p.model)]);
  select.innerHTML = '<option value="" disabled>Выберите модель</option>'
    + models.map(m => `<option value="${esc(m)}">${esc(m)}</option>`).join('')
    + '<option value="__custom__">Другая модель…</option>';
  select.value = current === '__custom__' || models.includes(current) ? current : '';
}
fillProductModels();
$('#productModel').onchange = () => {
  const custom = $('#customProductModel');
  const enabled = $('#productModel').value === '__custom__';
  custom.disabled = !enabled;
  custom.required = enabled;
  custom.classList.toggle('hidden', !enabled);
  if (enabled) custom.focus();
};
$('#modelList').innerHTML = MODEL_HINTS.map(v => `<option value="${v}">`).join('');
$('#storageList').innerHTML = STORAGE_HINTS.map(v => `<option value="${v}">`).join('');
$('#colorList').innerHTML = COLOR_HINTS.map(v => `<option value="${v}">`).join('');
$('#simList').innerHTML = SIM_HINTS.map(v => `<option value="${v}">`).join('');

function renderAdmin() {
  if (!isAdmin()) state.adminPane = 'products';
  $('#adminSeg').classList.toggle('hidden', !isAdmin());
  $('#productForm').classList.toggle('hidden', !isAdmin());
  $('#productsPane').classList.toggle('hidden', state.adminPane !== 'products');
  $('#usersPane').classList.toggle('hidden', state.adminPane !== 'users');
  return state.adminPane === 'products' ? renderProducts() : renderUsers();
}
$('#adminSeg').onclick = e => {
  const b = e.target.closest('button'); if (!b) return;
  state.adminPane = b.dataset.a;
  for (const x of $('#adminSeg').children) x.classList.toggle('on', x === b);
  Promise.resolve(renderAdmin()).catch(fail);
};

// Остатки: qty — всего штук, reserved — в брони, свободно = qty − reserved
const reservedOf = p => Number(p.reserved) || 0;
const freeOf = p => (p.qty || 0) - reservedOf(p);
function stockCell(p) {
  const f = freeOf(p), r = reservedOf(p);
  return `<span class="stock"><b class="${f > 0 ? 'green' : 'red'}">${f > 0 ? f + ' в наличии' : 'нет в наличии'}</b>${r ? `<small class="amber">${r} в брони</small>` : ''}</span>`;
}
function stockSum(ps) {
  const qty = ps.reduce((s, p) => s + (p.qty || 0), 0), r = ps.reduce((s, p) => s + reservedOf(p), 0);
  return `<span class="${qty - r > 0 ? 'green' : 'red'}">${Math.max(qty - r, 0)} в наличии</span> · <span class="amber">${r} в брони</span> · всего ${qty}`;
}

// Позиции сгруппированы по модели; у админа всё редактируется, продавец видит только остатки.
// Название в шапке группы (админ) переименовывает все позиции модели.
function renderProducts() {
  const q = $('#productSearch').value.trim().toLowerCase(), admin = isAdmin();
  const list = state.products.filter(p => !q || [p.model, p.storage, p.color, p.sim, p.activation].join(' ').toLowerCase().includes(q));
  $('#productsMeta').innerHTML = `${plural(state.products.length, 'позиция', 'позиции', 'позиций')} · ${plural(uniq(state.products.map(p => p.model)).length, 'модель', 'модели', 'моделей')} · ${stockSum(state.products)}`;
  if (!list.length) { $('#productsList').innerHTML = `<div class="empty">${state.products.length ? 'Ничего не найдено' : admin ? 'База пуста — добавьте первый телефон сверху' : 'База пуста — телефоны добавляет админ'}</div>`; return; }
  $('#productsList').innerHTML = uniq(list.map(p => p.model)).map(m => {
    // Сначала большие объёмы: 1 ТБ, 512 ГБ, 256 ГБ…
    const ps = list.filter(p => p.model === m).sort((a, b) => STORAGE_ORDER(b.storage) - STORAGE_ORDER(a.storage)), prices = ps.map(p => p.price).filter(Boolean);
    const lo = Math.min(...prices), hi = Math.max(...prices);
    const color = p => `<i class="sw" style="background:${swatch(p.color) || 'transparent'}"></i>`;
    // При поиске раскрываем всё найденное, иначе — только то, что открыли вручную
    const open = !!q || state.openModels.has(m), cls = `pgroup ${open ? 'open' : ''}`;
    const chev = `<span class="chev" aria-hidden="true">›</span>`;
    if (!admin) return `<section class="${cls}" data-model="${esc(m)}">
      <div class="pg-head" role="button" tabindex="0" aria-expanded="${open}"><h3 class="g-title">${esc(m)}</h3>${chev}</div>
      <div class="pg-stock">${stockSum(ps)}</div>
      ${open ? `<div class="prow ro th"><span>Память</span><span>Цвет</span><span>SIM</span><span>Активация</span><span>Наличие</span></div>
      ${ps.map(p => `<div class="prow ro"><span data-label="Память">${esc(p.storage)}</span><span data-label="Цвет">${color(p)} ${esc(p.color)}</span><span data-label="SIM">${esc(p.sim)}</span><span data-label="Активация">${esc(p.activation)}</span>${stockCell(p)}</div>`).join('')}` : ''}
    </section>`;
    return `<section class="${cls}" data-model="${esc(m)}">
      <div class="pg-head" role="button" tabindex="0" aria-expanded="${open}">
        <input class="g-model" value="${esc(m)}" data-model="${esc(m)}" list="modelList" autocomplete="off" spellcheck="false" aria-label="Название модели" title="Переименовать модель целиком">
        <span class="pg-meta">${plural(ps.length, 'вариант', 'варианта', 'вариантов')}${prices.length ? ' · ' + (lo === hi ? money(lo) : `${fmtPrice(lo)} – ${money(hi)}`) : ''}</span>${chev}
      </div>
      <div class="pg-stock">${stockSum(ps)}</div>
      ${open ? `<div class="prow th"><span>Память</span><span>Цвет</span><span>SIM</span><span>Активация</span><span>Цена, ₽</span><span>Всего, шт</span><span>Наличие</span><span></span></div>
      ${ps.map(p => `<form class="prow" data-id="${p.id}">
        <input type="hidden" name="model" value="${esc(p.model)}">
        <label class="product-field"><span class="field-label">Память</span><input name="storage" value="${esc(p.storage)}" list="storageList" required aria-label="Память"></label>
        <label class="product-field"><span class="field-label">Цвет</span><span class="color-cell">${color(p)}<input name="color" value="${esc(p.color)}" list="colorList" required aria-label="Цвет"></span></label>
        <label class="product-field"><span class="field-label">SIM</span><input name="sim" value="${esc(p.sim)}" list="simList" required aria-label="SIM"></label>
        <label class="product-field"><span class="field-label">Активация</span><select name="activation" aria-label="Активация">${ACTIVATIONS.map(a => `<option${a === p.activation ? ' selected' : ''}>${a}</option>`).join('')}</select></label>
        <label class="product-field"><span class="field-label">Цена, ₽</span><input name="price" value="${fmtPrice(p.price)}" placeholder="цена" inputmode="numeric" aria-label="Цена"></label>
        <label class="product-field"><span class="field-label">Всего, шт</span><input name="qty" value="${p.qty || 0}" inputmode="numeric" aria-label="Всего штук"></label>
        ${stockCell(p)}
        <div class="acts"><button type="button" class="del" title="Удалить" aria-label="Удалить вариант телефона">✕</button></div>
      </form>`).join('')}` : ''}
    </section>`;
  }).join('');
}
$('#productSearch').oninput = renderProducts;
$('#productForm').onsubmit = async e => {
  e.preventDefault();
  try {
    const body = Object.fromEntries(new FormData(e.target));
    if (body.model === '__custom__') body.model = (body.customModel || '').trim();
    delete body.customModel;
    if (!body.model) return toast('Выберите или введите модель телефона');
    await api('/products', { method: 'POST', body });
    // модель и цену оставляем — удобно добавлять подряд варианты одной модели
    e.target.color.value = ''; e.target.color.focus();
    toast('Добавлено'); await loadRefs(); renderProducts();
  } catch (err) { fail(err); }
};
$('#productsList').addEventListener('submit', async e => {
  e.preventDefault();
  try { await api('/products/' + e.target.dataset.id, { method: 'PUT', body: Object.fromEntries(new FormData(e.target)) }); toast('Сохранено'); await loadRefs(); renderProducts(); }
  catch (err) { fail(err); }
});
$('#productsList').addEventListener('change', async e => {
  // Изменения в строке позиции сохраняются сразу, без отдельной кнопки
  if (e.target.closest('form.prow')) return e.target.form.requestSubmit();
  const inp = e.target.closest('.g-model'); if (!inp) return;
  const name = inp.value.trim(), old = inp.dataset.model;
  if (!name || name === old) { inp.value = old; return; }
  try {
    for (const p of state.products.filter(p => p.model === old)) await api('/products/' + p.id, { method: 'PUT', body: { ...p, model: name } });
    toast('Модель переименована'); await loadRefs(); renderProducts();
  } catch (err) { fail(err); }
});
$('#productsList').addEventListener('keydown', e => { if (e.key === 'Enter' && e.target.matches('.g-model')) e.target.blur(); });
// Клик по шапке модели (кроме поля названия) сворачивает/раскрывает её варианты
function toggleModel(e) {
  const head = e.target.closest('.pg-head');
  if (!head || e.target.closest('.g-model')) return false;
  const m = head.closest('.pgroup').dataset.model;
  state.openModels.has(m) ? state.openModels.delete(m) : state.openModels.add(m);
  renderProducts();
  return true;
}
$('#productsList').addEventListener('keydown', e => { if ((e.key === 'Enter' || e.key === ' ') && e.target.matches('.pg-head')) { e.preventDefault(); toggleModel(e); } });
$('#productsList').addEventListener('click', async e => {
  if (toggleModel(e)) return;
  if (!e.target.closest('.del')) return;
  const f = e.target.closest('form');
  if (!confirm('Удалить позицию из базы? Старые заявки с ней сохранятся.')) return;
  await api('/products/' + f.dataset.id, { method: 'DELETE' }).catch(fail);
  await loadRefs(); renderProducts();
});
for (const el of [$('#productForm').price]) el.oninput = () => { el.value = fmtPrice(el.value); };
$('#productForm').qty.oninput = e => { e.target.value = e.target.value.replace(/\D/g, ''); };
$('#productsList').addEventListener('input', e => {
  if (e.target.name === 'price') e.target.value = fmtPrice(e.target.value);
  if (e.target.name === 'qty') e.target.value = e.target.value.replace(/\D/g, '');
});

// Карточка продавца: имя, роль, итоги текущего месяца, смена пароля
async function renderUsers() {
  const now = new Date();
  const month = await api(`/orders?from=${iso(new Date(now.getFullYear(), now.getMonth(), 1))}&to=${iso(new Date(now.getFullYear(), now.getMonth() + 1, 0))}`);
  $('#usersList').innerHTML = state.users.map(u => {
    const mine = month.filter(o => o.seller === u.name), sold = mine.filter(o => o.status === 'sold');
    return `<form class="ucard" data-login="${esc(u.login)}" style="--seller:${sellerColor(u.name)}">
      <div class="u-top">
        <span class="avatar">${esc(u.name[0] || '?')}</span>
        <div class="u-id"><input name="name" value="${esc(u.name)}" required aria-label="Имя">
          <div class="u-login">@${esc(u.login)} <span class="role ${u.role}">${u.role === 'admin' ? 'админ' : 'продавец'}</span>${u.login === state.me.login ? ' · это вы' : ''}</div></div>
        ${u.login === state.me.login ? '' : '<button type="button" class="icon del" title="Удалить">✕</button>'}
      </div>
      <div class="u-stats"><div class="u-cap">В этом месяце</div>
        <div><b>${sold.length}</b><span>продаж</span></div>
        <div><b>${short(sumOf(sold))}</b><span>выручка</span></div>
        <div><b>${mine.filter(o => o.status === 'new').length}</b><span>в работе</span></div>
      </div>
      <div class="u-pass"><input name="password" placeholder="Новый пароль" autocomplete="new-password"><button class="btn" type="submit">Сохранить</button></div>
    </form>`;
  }).join('');
}
$('#userForm').onsubmit = async e => {
  e.preventDefault();
  try { await api('/users', { method: 'POST', body: Object.fromEntries(new FormData(e.target)) }); e.target.reset(); toast('Продавец добавлен'); await loadRefs(); await renderUsers(); }
  catch (err) { fail(err); }
};
$('#usersList').addEventListener('submit', async e => {
  e.preventDefault();
  try {
    const previous = state.users.find(u => u.login === e.target.dataset.login)?.name;
    await api('/users/' + e.target.dataset.login, { method: 'PUT', body: Object.fromEntries(new FormData(e.target)) });
    if (e.target.dataset.login === state.me.login) state.me = await api('/me');
    toast('Сохранено'); render().catch(fail);
  } catch (err) { fail(err); }
});
$('#usersList').addEventListener('click', async e => {
  if (!e.target.closest('.del')) return;
  const f = e.target.closest('form');
  if (!confirm(`Удалить «${f.dataset.login}»? Его заявки останутся.`)) return;
  await api('/users/' + f.dataset.login, { method: 'DELETE' }).catch(fail);
  await loadRefs(); await renderUsers().catch(fail);
});

// ---------- форма заявки: телефон выбирается только из базы ----------
const form = $('#orderForm'), dlg = $('#dlg');
const sel = { model: $('#pModel'), storage: $('#pStorage'), color: $('#pColor'), sim: $('#pSim'), activation: $('#pActivation') };
const LEVELS = ['model', 'storage', 'color', 'sim', 'activation'];
let extraProduct = null; // позиция заявки, которую уже удалили из базы

function catalog() { return extraProduct ? [...state.products, extraProduct] : state.products; }
function fillLevel(i, want) {
  const k = LEVELS[i];
  const match = catalog().filter(p => LEVELS.slice(0, i).every(l => p[l] === sel[l].value));
  let opts = uniq(match.map(p => p[k]));
  if (k === 'storage') opts.sort((a, b) => STORAGE_ORDER(a) - STORAGE_ORDER(b));
  sel[k].innerHTML = opts.map(v => `<option>${esc(v)}</option>`).join('');
  sel[k].disabled = !opts.length;
  if (want != null && opts.includes(want)) sel[k].value = want;
}
function cascade(from, want = {}, setPrice = true) {
  for (let i = from; i < LEVELS.length; i++) fillLevel(i, want[LEVELS[i]]);
  const p = catalog().find(p => LEVELS.every(l => p[l] === sel[l].value));
  form.product_id.value = p ? p.id : '';
  if (setPrice && p?.price) form.price.value = fmtPrice(p.price);
  const hint = $('#stockHint'), e = state.editing;
  if (!p || p === extraProduct) { hint.textContent = ''; return; }
  const f = freeOf(p) + (e && e.product_id === p.id && (e.status === 'new' || e.status === 'sold') ? 1 : 0);
  hint.className = 'stock-hint ' + (f > 0 ? 'green' : 'red');
  hint.textContent = f > 0 ? `В наличии ${f} шт${reservedOf(p) ? ` · ${reservedOf(p)} в брони` : ''} · всего ${p.qty || 0}` : 'Нет в наличии — все штуки проданы или в брони';
}
LEVELS.forEach((k, i) => { sel[k].onchange = () => cascade(i + 1); });

form.phone.oninput = () => { form.phone.value = formatPhone(form.phone.value); };
form.price.oninput = () => { form.price.value = fmtPrice(form.price.value); };

function openForm(o, date) {
  state.editing = o || null;
  form.reset();
  $('#dlgTitle').textContent = o ? 'Заявка' : 'Новая заявка';
  $('#delBtn').classList.toggle('hidden', !o);
  $('#copyBtn').classList.toggle('hidden', !o);

  extraProduct = o && !state.products.some(p => p.id === o.product_id)
    ? { id: o.product_id, model: o.model, storage: o.storage, color: o.color, sim: o.sim, activation: o.activation || ACTIVATIONS[0], price: o.price } : null;
  $('#noProducts').classList.toggle('hidden', catalog().length > 0);
  $('#saveBtn').disabled = !catalog().length;
  cascade(0, o || {}, !o);

  // Продавец вписывается руками (аккаунт общий); по умолчанию — имя из «Моих заказов»
  form.seller.value = o ? o.seller : store.get('sellerName') || '';

  const v = o || { date: date || iso(new Date()), status: 'new' };
  for (const k of ['date', 'time', 'client', 'phone', 'comment']) if (v[k] != null) form[k].value = v[k];
  if (o) form.price.value = fmtPrice(o.price);
  form.querySelector(`input[name=status][value=${v.status || 'new'}]`).checked = true;
  dlg.showModal();
  dlg.scrollTop = 0;
}
$('#fab').onclick = $('#newBtn').onclick = () => openForm(null);
$('#dlgClose').onclick = () => dlg.close();

form.onsubmit = async e => {
  e.preventDefault();
  const body = Object.fromEntries(new FormData(form));
  if (!body.product_id) return toast('Выберите телефон из базы');
  try {
    if (state.editing) await api('/orders/' + state.editing.id, { method: 'PUT', body });
    else await api('/orders', { method: 'POST', body });
    dlg.close();
    toast(state.editing ? 'Сохранено' : 'Заявка добавлена');
    if (!state.editing && state.view === 'week') state.weekStart = mondayOf(parse(body.date));
    render().catch(fail);
  } catch (err) { fail(err); }
};
$('#delBtn').onclick = async () => {
  if (!state.editing || !confirm('Удалить заявку?')) return;
  await api('/orders/' + state.editing.id, { method: 'DELETE' }).catch(fail);
  dlg.close(); toast('Удалено'); render().catch(fail);
};
$('#copyBtn').onclick = async () => {
  const o = state.editing;
  const [dn, dd] = dayTitle(o.date).split(' · ');
  const text = [
    `📅 ${dn.toUpperCase()} · ${dd}${o.time ? ' · ' + o.time : ''}`,
    `👤 ${o.client}`,
    o.phone && `📞 ${o.phone}`,
    `📱 ${[o.model, o.storage, o.color, o.sim, o.activation].filter(Boolean).join(' · ')}`,
    o.price && `💰 ${money(o.price)}`,
    o.comment && `⚠️ ${o.comment}`,
    `🧑‍💼 от ${o.seller}`,
  ].filter(Boolean).join('\n');
  try { await navigator.clipboard.writeText(text); toast('Скопировано'); } catch { prompt('Скопируйте:', text); }
};

// ---------- навигация ----------
document.querySelector('.tabs').onclick = async e => {
  const b = e.target.closest('.tab'); if (!b) return;
  state.view = b.dataset.view;
  try { await render(); window.scrollTo({ top: 0, behavior: 'instant' }); } catch (err) { fail(err); }
};

// При открытой клавиатуре форма занимает видимую часть экрана, а нижняя панель не мешает вводу.
function updateViewport() {
  const viewport = window.visualViewport;
  const height = viewport?.height || window.innerHeight;
  document.documentElement.style.setProperty('--viewport-height', `${height}px`);
  document.documentElement.style.setProperty('--viewport-top', `${viewport?.offsetTop || 0}px`);
  document.body.classList.toggle('keyboard-open', window.innerHeight - height > 120
    && document.activeElement?.matches('input, textarea, select'));
}
window.visualViewport?.addEventListener('resize', updateViewport);
window.visualViewport?.addEventListener('scroll', updateViewport);
window.addEventListener('resize', updateViewport);
document.addEventListener('focusin', updateViewport);
document.addEventListener('focusout', () => requestAnimationFrame(updateViewport));
updateViewport();

async function start() {
  $('#login').classList.add('hidden'); $('#app').classList.remove('hidden');
  // Раньше данные жили только в браузере — один раз предлагаем перенести их в общую базу
  const old = store.get(DATA_KEY);
  if (old && isAdmin() && confirm('В этом браузере остались заявки и телефоны из старой версии. Перенести их в общую базу? Текущие общие данные будут заменены.')) {
    await api('/import', { method: 'POST', body: JSON.parse(old) }).then(() => toast('Данные перенесены')).catch(fail);
  }
  if (old && isAdmin()) try { localStorage.removeItem(DATA_KEY); } catch {}
  render().catch(fail);
}
if (state.token) api('/me').then(u => { state.me = u; start(); }).catch(() => showLogin());
else showLogin();

// Подтягиваем изменения коллег, когда возвращаемся на вкладку
document.addEventListener('visibilitychange', () => {
  if (!document.hidden && state.me && !dlg.open) render().catch(fail);
});

$('#exportData').onclick = async () => {
  try {
    const snapshot = JSON.stringify(await api('/export'), null, 2);
    const url = URL.createObjectURL(new Blob([snapshot], { type: 'application/json' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `iphone-zayavki-${iso(new Date())}.json`;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  } catch (err) { fail(err); }
};
$('#importData').onclick = () => { if (isAdmin()) $('#importFile').click(); };
$('#importFile').onchange = async e => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file || !isAdmin()) return;
  if (!confirm('Заменить общие заявки и телефоны данными из файла? Перед заменой можно сделать экспорт базы.')) return;
  try {
    const raw = await file.text();
    await api('/import', { method: 'POST', body: JSON.parse(raw) });
    if (dlg.open) dlg.close();
    toast('База импортирована');
    await render();
  } catch (err) { fail(err); }
};
