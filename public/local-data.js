// Заявки и склад общие для аккаунтов в пределах этого браузера и адреса сайта.
import { STOCK } from './stock.js';

export const DATA_KEY = 'iphone-zayavki:data:v1';
export const ACTIVATIONS = ['Не актив', 'Актив'];
export const CITIES = ['Москва', 'Питер'];

export function createLocalData(storage, remote, stock = STOCK) {
  let initializing;
  const text = v => String(v ?? '').trim().slice(0, 500);
  const number = v => Number(String(v ?? '').replace(/\D/g, '')) || null;
  const holds = status => status === 'new' || status === 'sold';
  const error = message => { throw new Error(message); };
  // Все телефоны заявки: основной + extras
  const phonesOf = o => (o ? [o, ...(o.extras || [])] : []);
  const countIn = (o, id) => phonesOf(o).filter(x => x.product_id === id).length;
  function decode(raw) {
    const data = JSON.parse(raw);
    if (data?.version !== 1 || !Array.isArray(data.products) || !Array.isArray(data.orders)
      || !data.products.every(p => p && Number.isSafeInteger(p.id) && p.id > 0
        && ['model', 'storage', 'color', 'sim'].every(k => typeof p[k] === 'string')
        && Number.isSafeInteger(p.qty) && p.qty >= 0 && (p.price === null || Number.isFinite(p.price)))
      || !data.orders.every(o => o && typeof o.id === 'string'
        && ['date', 'client', 'seller', 'model', 'storage', 'color', 'sim'].every(k => typeof o[k] === 'string')
        && /^(\d{4}-\d{2}-\d{2})?$/.test(o.date) && ['new', 'sold', 'cancel'].includes(o.status)
        && (o.price === null || Number.isFinite(o.price)) && (o.extras === undefined || Array.isArray(o.extras)))
      || new Set(data.products.map(p => p.id)).size !== data.products.length
      || new Set(data.orders.map(o => o.id)).size !== data.orders.length
      || (data.nextProductId !== undefined && (!Number.isSafeInteger(data.nextProductId) || data.nextProductId < 1))) {
      throw new Error('Неверный формат базы');
    }
    // Старые копии без активации считаем неактивированными.
    for (const p of data.products) if (!ACTIVATIONS.includes(p.activation)) p.activation = ACTIVATIONS[0];
    // До разделения по городам всё наличие было московским.
    for (const p of data.products) if (!CITIES.includes(p.city)) p.city = CITIES[0];
    return data;
  }
  function read() {
    let raw;
    try { raw = storage.getItem(DATA_KEY); }
    catch { error('Не удалось прочитать данные браузера. Разрешите localStorage.'); }
    if (raw === null) return null;
    try {
      return decode(raw);
    } catch { error('Сохранённые данные повреждены. Не очищайте хранилище: сначала сохраните его копию.'); }
  }
  function write(data) {
    try { storage.setItem(DATA_KEY, JSON.stringify(data)); }
    catch { error('Данные не сохранены: хранилище браузера недоступно или заполнено.'); }
  }
  // Один раз дописываем стартовое наличие в уже существующую базу браузера, без дублей.
  function addStock() {
    const data = read();
    if (data.stockAdded) return;
    const key = p => [p.city, p.model, p.storage, p.color, p.sim, p.activation].join('|');
    const have = new Set(data.products.map(key));
    let id = Math.max(data.nextProductId || 1, ...data.products.map(p => p.id + 1));
    for (const [model, storage, color, sim, activation, qty] of stock) {
      const p = { city: CITIES[0], model, storage, color, sim, activation, price: null, qty };
      if (!have.has(key(p))) data.products.push({ id: id++, ...p });
    }
    Object.assign(data, { nextProductId: id, stockAdded: true });
    write(data);
  }
  async function ready() {
    if (read()) return addStock();
    if (!initializing) {
      initializing = (async () => {
        const [products, orders] = await Promise.all([remote('/products'), remote('/orders')]);
        // Другая вкладка могла завершить перенос, пока загружались данные.
        if (!read()) write({ version: 1, products: products.map(({ reserved, ...p }) => p), orders });
      })().finally(() => { initializing = null; });
    }
    await initializing;
    addStock();
  }
  function moveStock(data, old, order) {
    for (const x of old?.status === 'sold' ? phonesOf(old) : []) { const p = data.products.find(p => p.id === x.product_id); if (p) p.qty += 1; }
    for (const x of order?.status === 'sold' ? phonesOf(order) : []) { const p = data.products.find(p => p.id === x.product_id); if (p) p.qty = Math.max(0, p.qty - 1); }
  }
  return {
    async exportData() {
      await ready();
      return JSON.stringify(read(), null, 2);
    },
    importData(raw) {
      let data;
      try { data = decode(raw); }
      catch { error('Не удалось импортировать файл: неверный формат базы.'); }
      write(data);
    },
    async request(path, opts = {}, user) {
      if (!user) error('Нужен вход');
      await ready();
      const data = read();
      const url = new URL(path, 'http://local');
      const [, resource, id] = url.pathname.split('/');
      const method = opts.method || 'GET';
      const body = opts.body || {};
      if (resource === 'sellers' && method === 'GET') {
        const users = await remote('/users');
        return [...new Set([...data.orders.map(o => o.seller), ...users.map(u => u.name)])].sort();
      }
      if (resource === 'products') {
        if (method === 'GET') return data.products.map(p => ({ ...p,
          reserved: data.orders.reduce((n, o) => n + (o.status === 'new' ? countIn(o, p.id) : 0), 0),
        })).sort((a, b) => [a.city, a.model, a.storage, a.color, a.sim, a.activation].join().localeCompare([b.city, b.model, b.storage, b.color, b.sim, b.activation].join()));
        if (user.role !== 'admin') error('Только для админа');
        const index = data.products.findIndex(p => p.id === Number(id));
        if (method !== 'POST' && index < 0) error('Телефон не найден');
        if (method === 'DELETE') data.products.splice(index, 1);
        else if (method === 'POST' || method === 'PUT') {
          const product = Object.fromEntries(['model', 'storage', 'color', 'sim'].map(k => [k, text(body[k])]));
          if (Object.values(product).some(v => !v)) error('Заполните модель, память, цвет и SIM');
          Object.assign(product, { city: CITIES.includes(body.city) ? body.city : CITIES[0], activation: ACTIVATIONS.includes(body.activation) ? body.activation : ACTIVATIONS[0], price: number(body.price), qty: number(body.qty) ?? 0,
            id: method === 'POST' ? Math.max(data.nextProductId || 1, ...data.products.map(p => p.id + 1)) : Number(id) });
          if (method === 'POST') {
            data.products.push(product);
            data.nextProductId = product.id + 1;
          } else data.products[index] = product;
          write(data);
          return { id: product.id };
        } else error('Неизвестная операция');
      } else if (resource === 'orders') {
        if (method === 'GET') {
          const from = url.searchParams.get('from'), to = url.searchParams.get('to');
          // Заявки с плавающей датой (date === '') видны в любой неделе
          return data.orders.filter(o => !(from && to) || !o.date || (o.date >= from && o.date <= to))
            .sort((a, b) => (from && to ? 1 : -1) * (a.date.localeCompare(b.date) || (a.time || '').localeCompare(b.time || '')));
        }
        const index = data.orders.findIndex(o => o.id === id);
        const old = data.orders[index];
        if (method !== 'POST' && !old) error('Заявка не найдена');
        if (method === 'DELETE') {
          moveStock(data, old, null);
          data.orders.splice(index, 1);
        } else if (method === 'POST' || method === 'PUT') {
          // Телефон из базы, либо уже удалённый из базы, но записанный в этой заявке
          const pick = (pid, price) => {
            const product = data.products.find(p => p.id === Number(pid))
              || phonesOf(old).map(x => ({ ...x, id: x.product_id })).find(x => x.id === Number(pid));
            if (!product) error('Выберите телефон из базы');
            return { product_id: product.id, model: product.model, storage: product.storage, color: product.color, sim: product.sim, activation: product.activation, city: product.city,
              price: number(price) ?? product.price };
          };
          const order = Object.fromEntries(['date', 'time', 'client', 'phone', 'comment', 'seller'].map(k => [k, text(body[k])]));
          if (!/^(\d{4}-\d{2}-\d{2})?$/.test(order.date) || !order.client) error('Укажите имя клиента');
          if (!order.seller) error('Впишите продавца — чей это телефон');
          Object.assign(order, { id: old?.id || crypto.randomUUID(), created_at: old?.created_at || new Date().toISOString(),
            ...pick(body.product_id, body.price),
            extras: (Array.isArray(body.extras) ? body.extras : []).slice(0, 50).map(x => pick(x?.product_id, x?.price)),
            status: ['new', 'sold', 'cancel'].includes(body.status) ? body.status : 'new' });
          if (holds(order.status)) for (const pid of new Set(phonesOf(order).map(x => x.product_id))) {
            const need = countIn(order, pid), had = old && holds(old.status) ? countIn(old, pid) : 0;
            const current = data.products.find(p => p.id === pid);
            if (!current || need <= had) continue;
            const reserved = data.orders.reduce((n, o) => n + (o.status === 'new' && o.id !== old?.id ? countIn(o, pid) : 0), 0);
            const qty = current.qty + (old?.status === 'sold' ? had : 0);
            if (qty - reserved < need) error(`${current.model} ${current.storage} ${current.color}: нет в наличии — все штуки проданы или в брони`);
          }
          moveStock(data, old, order);
          if (method === 'POST') data.orders.push(order);
          else data.orders[index] = order;
          write(data);
          return { id: order.id };
        } else error('Неизвестная операция');
      } else error('Неизвестная операция');
      write(data);
      return { ok: true };
    },
    async renameSeller(previous, next) {
      if (!next || previous === next) return;
      await ready();
      const data = read();
      for (const order of data.orders) if (order.seller === previous) order.seller = next;
      write(data);
    },
  };
}
