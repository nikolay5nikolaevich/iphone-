import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';

test('exported Express app serves assets, authenticates and manages accounts', async t => {
  process.env.DB_FILE = ':memory:';
  process.env.ADMIN_PASSWORD = 'test-admin-password';
  process.env.ADMIN_LOGIN = 'owner';
  delete process.env.TURSO_DATABASE_URL;
  delete process.env.TURSO_AUTH_TOKEN;
  delete process.env.VERCEL;
  const { default: app } = await import('./server.js');
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise((resolve, reject) => server.close(err => err ? reject(err) : resolve())));
  const base = `http://127.0.0.1:${server.address().port}`;
  async function request(url, { method = 'GET', token, body } = {}) {
    const response = await fetch(base + url, { method, headers: { 'Content-Type': 'application/json', 'x-token': token || '' }, body: body ? JSON.stringify(body) : undefined });
    return { status: response.status, headers: response.headers, data: await response.json() };
  }
  for (const file of ['/', '/icon.svg', '/app.js', '/local-data.js']) assert.equal((await fetch(base + file)).status, 200);
  assert.equal((await request('/api/users')).status, 401);
  assert.equal((await request('/api/login', { method: 'POST', body: { login: 'owner', password: 'admin' } })).status, 401);
  const login = await request('/api/login', { method: 'POST', body: { login: 'owner', password: 'test-admin-password' } });
  assert.equal(login.status, 200);
  assert.equal(login.headers.get('cache-control'), 'no-store');
  const token = login.data.token;
  assert.equal((await request('/api/me', { token })).data.role, 'admin');
  assert.equal((await request('/api/users', { token, method: 'POST', body: { login: 'anna', name: 'Анна', password: 'seller-password' } })).status, 200);
  const sellerLogin = await request('/api/login', { method: 'POST', body: { login: 'anna', password: 'seller-password' } });
  assert.equal(sellerLogin.status, 200);
  assert.equal((await request('/api/users', { token: sellerLogin.data.token, method: 'POST', body: {} })).status, 403);
  assert.equal((await request('/api/products', { token })).data.length, 0);
  assert.equal((await request('/api/orders', { token })).data.length, 0);
  const product = await request('/api/products', { token, method: 'POST', body: { model: 'iPhone 17', storage: '256 ГБ', color: 'Black', sim: 'eSIM', qty: 2 } });
  assert.equal(product.status, 200);
  assert.equal(typeof product.data.id, 'number');
  assert.equal((await request('/api/sellers', { token })).data.includes('Анна'), true);
  await request('/api/users/anna', { token, method: 'PUT', body: { name: 'Мария', password: 'new-seller-password' } });
  assert.equal((await request('/api/me', { token: sellerLogin.data.token })).status, 401);
  assert.equal((await request('/api/users', { token })).data.find(u => u.login === 'anna').name, 'Мария');
  assert.equal((await request('/api/unknown', { token })).status, 404);
  await request('/api/users/anna', { token, method: 'DELETE' });
  assert.equal((await request('/api/users', { token })).data.length, 1);
  await request('/api/logout', { token, method: 'POST' });
  assert.equal((await request('/api/me', { token })).status, 401);
});
