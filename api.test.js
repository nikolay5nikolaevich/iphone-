import test from 'node:test';
import assert from 'node:assert/strict';
import { handle } from './api/data.js';

const login = async (l, password) => (await handle('POST', '/login', { login: l, password })).token;

test('shared API: accounts, sessions, roles and orders visible from another device', async () => {
  await assert.rejects(login('admin', 'wrong'), /Неверный/);
  const admin = await login('Admin', 'admin');
  await handle('POST', '/users', { login: 'anna', name: 'Анна', password: '1234' }, admin);
  const seller = await login('anna', '1234');
  await assert.rejects(handle('DELETE', '/users/admin', undefined, seller), /Только для админа/);
  const [product] = await handle('GET', '/products', undefined, seller);
  await handle('POST', '/orders', { product_id: product.id, date: '2026-10-27', client: 'Клиент', seller: 'Анна' }, seller);
  const phone = await login('admin', 'admin'); // второе устройство
  assert.equal((await handle('GET', '/orders', undefined, phone)).length, 1);
  await handle('PUT', '/users/anna', { name: 'Аня', password: '5678' }, admin);
  assert.equal((await handle('GET', '/orders', undefined, admin))[0].seller, 'Аня');
  await assert.rejects(handle('GET', '/me', undefined, seller), /auth/);
  await handle('POST', '/logout', undefined, phone);
  await assert.rejects(handle('GET', '/orders', undefined, phone), /auth/);
  await assert.rejects(handle('GET', '/orders', undefined, 'forged'), /auth/);
});
