import test from 'node:test';
import assert from 'node:assert/strict';
import { createLocalData, DATA_KEY } from './public/local-data.js';

const admin = { login: 'admin', role: 'admin' };
const seller = { login: 'seller', role: 'seller' };
const product = { id: 1, model: 'iPhone 17', storage: '256 ГБ', color: 'Black', sim: 'eSIM', qty: 1, price: 100000 };
const order = { product_id: 1, date: '2026-10-25', client: 'Клиент', seller: 'Анна', status: 'new' };
function setup() {
  const values = new Map(), calls = [];
  const storage = { getItem: k => values.get(k) ?? null, setItem: (k, v) => values.set(k, v) };
  const remote = async path => {
    calls.push(path);
    if (path === '/products') return [{ ...product, reserved: 0 }];
    if (path === '/orders') return [];
    if (path === '/users') return [{ name: 'Админ' }];
    throw new Error('Unexpected server mutation: ' + path);
  };
  const data = createLocalData(storage, remote, []);
  const request = (path, method = 'GET', body, user = admin) => data.request(path, { method, body }, user);
  return { values, storage, remote, calls, data, request };
}

test('exports localhost data and imports it into another site', async () => {
  const source = setup();
  await source.request('/orders', 'POST', order);
  const backup = await source.data.exportData();
  const target = setup();
  target.data.importData(backup);
  assert.equal((await target.request('/orders')).length, 1);
  assert.equal((await target.request('/products'))[0].reserved, 1);
  assert.deepEqual(target.calls, []);
  assert.throws(() => target.data.importData('{broken'), /неверный формат/);
  const malformed = JSON.parse(backup);
  malformed.products[0].qty = 'not a number';
  assert.throws(() => target.data.importData(JSON.stringify(malformed)), /неверный формат/);
  assert.equal((await target.request('/orders')).length, 1);
});

test('imports once and preserves browser changes after a reload', async () => {
  const s = setup();
  await s.request('/products');
  await s.request('/products/1', 'PUT', { ...product, price: '95 000' });
  const reloaded = createLocalData(s.storage, s.remote, []);
  assert.equal((await reloaded.request('/products', {}, admin))[0].price, 95000);
  assert.deepEqual(s.calls, ['/products', '/orders']);
  assert.equal(JSON.parse(s.values.get(DATA_KEY)).products[0].reserved, undefined);
});

test('reservations, sale transitions and deletion preserve stock', async () => {
  const { request } = setup();
  const { id } = await request('/orders', 'POST', order, seller);
  assert.equal((await request('/products'))[0].reserved, 1);
  await assert.rejects(request('/orders', 'POST', order), /нет в наличии/);
  await request('/orders/' + id, 'PUT', { ...order, status: 'sold' });
  let [p] = await request('/products');
  assert.equal(p.qty, 0);
  assert.equal(p.reserved, 0);
  await request('/orders/' + id, 'PUT', { ...order, status: 'sold' });
  assert.equal((await request('/products'))[0].qty, 0);
  await request('/orders/' + id, 'PUT', { ...order, status: 'new' });
  assert.equal((await request('/products'))[0].qty, 1);
  await request('/orders/' + id, 'PUT', { ...order, status: 'sold' });
  await request('/orders/' + id, 'DELETE');
  assert.equal((await request('/products'))[0].qty, 1);
  assert.deepEqual(await request('/orders'), []);
});

test('deleted product remains on old orders and product IDs are not reused', async () => {
  const { request } = setup();
  await request('/products', 'POST', product);
  const { id } = await request('/orders', 'POST', { ...order, product_id: 2 });
  await request('/products/2', 'DELETE');
  const next = await request('/products', 'POST', product);
  assert.equal(next.id, 3);
  await request('/orders/' + id, 'PUT', { ...order, product_id: 2, client: 'Новое имя' });
  assert.equal((await request('/orders'))[0].model, product.model);
});

test('filters dates, merges seller names and renames local orders', async () => {
  const { request, data } = setup();
  await request('/orders', 'POST', order);
  assert.deepEqual(await request('/orders?from=2026-11-01&to=2026-11-30'), []);
  assert.equal((await request('/orders?from=2026-10-01&to=2026-10-31')).length, 1);
  assert.deepEqual(await request('/sellers'), ['Админ', 'Анна']);
  await data.renameSeller('Анна', 'Мария');
  assert.equal((await request('/orders'))[0].seller, 'Мария');
});

test('rejects unauthorized operations and invalid orders without changing data', async () => {
  const { request, values } = setup();
  await request('/products');
  const before = values.get(DATA_KEY);
  await assert.rejects(request('/products', 'POST', product, seller), /Только для админа/);
  await assert.rejects(request('/orders', 'POST', { ...order, client: '' }), /обязательны/);
  await assert.rejects(request('/products', 'GET', null, null), /Нужен вход/);
  assert.equal(values.get(DATA_KEY), before);
});

test('reports storage failures, preserves corrupted data and retries failed migration', async () => {
  const s = setup();
  s.values.set(DATA_KEY, '{broken');
  await assert.rejects(s.request('/products'), /повреждены/);
  assert.equal(s.values.get(DATA_KEY), '{broken');
  s.values.delete(DATA_KEY);
  await s.request('/products');
  const before = s.values.get(DATA_KEY);
  s.storage.setItem = () => { throw new Error('QuotaExceededError'); };
  await assert.rejects(s.request('/orders', 'POST', order), /не сохранены/);
  assert.equal(s.values.get(DATA_KEY), before);
  const fresh = setup();
  let fail = true;
  const data = createLocalData(fresh.storage, async path => {
    if (fail) throw new Error('offline');
    return fresh.remote(path);
  }, []);
  await assert.rejects(data.request('/products', {}, admin), /offline/);
  assert.equal(fresh.values.has(DATA_KEY), false);
  fail = false;
  await data.request('/products', {}, admin);
  assert.equal(fresh.values.has(DATA_KEY), true);
});

test('activation is stored on products, copied to orders and defaults for old data', async () => {
  const { request, values } = setup();
  await request('/products');
  assert.equal((await request('/products'))[0].activation, 'Не актив');
  const { id } = await request('/products', 'POST', { ...product, activation: 'Актив' });
  await request('/orders', 'POST', { ...order, product_id: id });
  assert.equal((await request('/orders'))[0].activation, 'Актив');
  assert.equal(JSON.parse(values.get(DATA_KEY)).products.length, 2);
});

test('adds starting stock once to existing browser data without duplicates', async () => {
  const s = setup();
  await s.request('/products');
  const saved = JSON.parse(s.values.get(DATA_KEY));
  delete saved.stockAdded; // как у браузера, сохранившего базу до появления стартового наличия
  s.values.set(DATA_KEY, JSON.stringify(saved));
  const stock = [['iPhone 17', '256 ГБ', 'Black', 'eSIM', 'Не актив', 1], ['iPhone 15', '128 ГБ', 'Black', '2 SIM', 'Актив', 2]];
  const withStock = () => createLocalData(s.storage, s.remote, stock).request('/products', {}, admin);
  assert.equal((await withStock()).length, 2);
  await s.request('/products/2', 'DELETE');
  assert.equal((await withStock()).length, 1);
});

test('products belong to a city; old data is Moscow and orders keep the city', async () => {
  const { request } = setup();
  assert.equal((await request('/products'))[0].city, 'Москва');
  const { id } = await request('/products', 'POST', { ...product, city: 'Питер' });
  await request('/orders', 'POST', { ...order, product_id: id });
  assert.equal((await request('/orders'))[0].city, 'Питер');
  assert.equal((await request('/products', 'POST', { ...product, city: 'Казань' })).id, id + 1);
  assert.equal((await request('/products')).find(p => p.id === id + 1).city, 'Москва');
});
