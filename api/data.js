// Общая база для всех устройств: заявки, телефоны и аккаунты лежат в Upstash Redis (Vercel → Storage).
// Без настроек Redis (локальный npm run dev) данные живут в памяти до перезапуска.
import { Redis } from '@upstash/redis';
import { createLocalData, DATA_KEY } from '../public/local-data.js';
import { createLocalAuth, USERS_KEY, SESSIONS_KEY } from '../public/local-auth.js';

const KEYS = [DATA_KEY, USERS_KEY, SESSIONS_KEY];
const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
const redis = url && token ? new Redis({ url, token, automaticDeserialization: false }) : null;
const memory = new Map();

async function load() {
  if (!redis) return new Map(memory);
  const values = await redis.mget(...KEYS);
  return new Map(KEYS.map((k, i) => [k, values[i]]).filter(([, v]) => v != null));
}
async function save(changed) {
  if (!changed.size) return;
  if (!redis) return changed.forEach((v, k) => memory.set(k, v));
  await redis.mset(Object.fromEntries(changed));
}
// ponytail: один общий замок на всю базу — хватает для небольшой команды; при росте — отдельные ключи на заявку.
async function locked(fn) {
  if (!redis) return fn();
  for (let i = 0; i < 50; i++) {
    if (await redis.set('iphone-zayavki:lock', '1', { nx: true, px: 10000 })) {
      try { return await fn(); } finally { await redis.del('iphone-zayavki:lock'); }
    }
    await new Promise(r => setTimeout(r, 100));
  }
  throw new Error('База занята, попробуйте ещё раз');
}

export async function handle(method, path, body, sessionToken) {
  if (!redis && process.env.VERCEL) throw new Error('Подключите Upstash Redis: Vercel → Storage');
  return locked(async () => {
    const values = await load(), changed = new Map();
    const storage = { getItem: k => values.get(k) ?? null, setItem: (k, v) => { values.set(k, v); changed.set(k, v); } };
    const auth = createLocalAuth(storage, process.env.ADMIN_PASSWORD || (process.env.VERCEL ? '' : 'admin'));
    const data = createLocalData(storage, p => (p === '/users' ? auth('/users', {}, sessionToken) : []));
    const opts = { method, body };
    const [, resource, id] = path.split(/[/?]/);
    let result;
    if (['products', 'orders', 'sellers'].includes(resource)) {
      result = await data.request(path, opts, await auth('/me', {}, sessionToken));
    } else if (resource === 'export') {
      await auth('/me', {}, sessionToken);
      result = JSON.parse(await data.exportData());
    } else if (resource === 'import') {
      if ((await auth('/me', {}, sessionToken)).role !== 'admin') throw new Error('Только для админа');
      data.importData(JSON.stringify(body));
      result = { ok: true };
    } else {
      const previous = resource === 'users' && method === 'PUT'
        && (await auth('/users', {}, sessionToken)).find(u => u.login === id)?.name;
      result = await auth(path, opts, sessionToken);
      if (previous) await data.renameSeller(previous, String(body.name ?? '').trim());
    }
    await save(changed);
    return result;
  });
}

export default async function handler(req, res) {
  try {
    res.status(200).json(await handle(req.method, String(req.query.path || ''), req.body, req.headers['x-token']));
  } catch (err) {
    res.status(err.message === 'auth' ? 401 : 400).json({ error: err.message });
  }
}
