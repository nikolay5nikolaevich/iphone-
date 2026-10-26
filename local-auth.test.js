import test from 'node:test';
import assert from 'node:assert/strict';
import { createLocalAuth } from './public/local-auth.js';

test('browser accounts: default admin, sellers, roles and passwords', async () => {
  const values = new Map();
  const api = createLocalAuth({ getItem: k => values.get(k) ?? null, setItem: (k, v) => values.set(k, v) });
  await assert.rejects(api('/login', { method: 'POST', body: { login: 'admin', password: 'wrong' } }), /Неверный/);
  const { token } = await api('/login', { method: 'POST', body: { login: 'Admin', password: 'admin' } });
  await api('/users', { method: 'POST', body: { login: 'anna', name: 'Анна', password: '1234' } }, token);
  const seller = (await api('/login', { method: 'POST', body: { login: 'anna', password: '1234' } })).token;
  await assert.rejects(api('/users/admin', { method: 'DELETE' }, seller), /Только для админа/);
  await api('/users/anna', { method: 'PUT', body: { name: 'Аня', password: '5678' } }, token);
  assert.deepEqual((await api('/users', {}, token)).map(u => u.name), ['Админ', 'Аня']);
  await assert.rejects(api('/login', { method: 'POST', body: { login: 'anna', password: '1234' } }), /Неверный/);
  await assert.rejects(api('/me', {}, 'nobody'), /auth/);
  await assert.rejects(api('/users/admin', { method: 'DELETE' }, token), /себя/);
});
