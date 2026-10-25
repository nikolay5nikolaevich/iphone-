import express from 'express';
import crypto from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';

const PORT = process.env.PORT || 3000;
const db = new DatabaseSync(process.env.DB_FILE || 'data.db');
const all = (sql, ...p) => db.prepare(sql).all(...p);
const get = (sql, ...p) => db.prepare(sql).get(...p);
const run = (sql, ...p) => db.prepare(sql).run(...p);

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  login TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  pass TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'seller'
);
CREATE TABLE IF NOT EXISTS sessions (token TEXT PRIMARY KEY, login TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS products (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  model TEXT NOT NULL,
  storage TEXT NOT NULL,
  color TEXT NOT NULL,
  sim TEXT NOT NULL,
  price INTEGER
);
CREATE TABLE IF NOT EXISTS orders (
  id TEXT PRIMARY KEY,
  date TEXT NOT NULL,
  time TEXT,
  client TEXT NOT NULL,
  phone TEXT,
  product_id INTEGER,
  model TEXT, storage TEXT, color TEXT, sim TEXT,
  price INTEGER,
  comment TEXT,
  seller TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'new',
  created_at TEXT NOT NULL
);`);

// Пароли храним хешем (scrypt + соль)
function hash(pw) {
  const salt = crypto.randomBytes(16).toString('hex');
  return salt + ':' + crypto.scryptSync(pw, salt, 32).toString('hex');
}
function check(pw, stored) {
  const [salt, h] = stored.split(':');
  return crypto.timingSafeEqual(Buffer.from(h, 'hex'), crypto.scryptSync(pw, salt, 32));
}
if (!get('SELECT 1 FROM users WHERE role = ?', 'admin')) {
  run('INSERT OR REPLACE INTO users (login, name, pass, role) VALUES (?, ?, ?, ?)', 'admin', 'Админ', hash('admin'), 'admin');
}

// Склад: qty — сколько штук физически есть (включая забронированные). Колонку добавляем и в старые базы.
if (!all('PRAGMA table_info(products)').some(c => c.name === 'qty')) db.exec('ALTER TABLE products ADD COLUMN qty INTEGER NOT NULL DEFAULT 0');

const str = v => (v == null ? '' : String(v).trim().slice(0, 500));
const num = v => Number(String(v ?? '').replace(/\D/g, '')) || null;
const STATUSES = ['new', 'sold', 'cancel'];
const PUBLIC_USER = 'SELECT login, name, role FROM users';

const app = express();
app.use(express.json());
app.use(express.static('public'));

// ---------- вход ----------
app.post('/api/login', (req, res) => {
  const login = str(req.body?.login).toLowerCase();
  const u = get('SELECT * FROM users WHERE login = ?', login);
  if (!u || !check(String(req.body?.password ?? ''), u.pass)) return res.status(401).json({ error: 'Неверный логин или пароль' });
  const token = crypto.randomBytes(24).toString('hex');
  run('INSERT INTO sessions (token, login) VALUES (?, ?)', token, login);
  res.json({ token, user: { login: u.login, name: u.name, role: u.role } });
});

app.use('/api', (req, res, next) => {
  const s = get('SELECT login FROM sessions WHERE token = ?', req.get('x-token') || '');
  const u = s && get(PUBLIC_USER + ' WHERE login = ?', s.login);
  if (!u) return res.status(401).json({ error: 'Нужен вход' });
  req.user = u;
  next();
});
const adminOnly = (req, res, next) => (req.user.role === 'admin' ? next() : res.status(403).json({ error: 'Только для админа' }));

app.get('/api/me', (req, res) => res.json(req.user));
app.post('/api/logout', (req, res) => { run('DELETE FROM sessions WHERE token = ?', req.get('x-token')); res.json({ ok: true }); });

// ---------- база позиций ----------
// reserved — сколько штук сейчас в брони (заявки «В работе» на эту позицию)
app.get('/api/products', (req, res) => res.json(all(
  `SELECT p.*, (SELECT COUNT(*) FROM orders o WHERE o.product_id = p.id AND o.status = 'new') AS reserved
   FROM products p ORDER BY model, storage, color, sim`)));

function productBody(b) {
  const p = { model: str(b.model), storage: str(b.storage), color: str(b.color), sim: str(b.sim), price: num(b.price), qty: num(b.qty) ?? 0 };
  return p.model && p.storage && p.color && p.sim ? p : null;
}
app.post('/api/products', adminOnly, (req, res) => {
  const p = productBody(req.body);
  if (!p) return res.status(400).json({ error: 'Заполните модель, память, цвет и SIM' });
  const r = run('INSERT INTO products (model, storage, color, sim, price, qty) VALUES (?, ?, ?, ?, ?, ?)', p.model, p.storage, p.color, p.sim, p.price, p.qty);
  res.json({ id: Number(r.lastInsertRowid) });
});
app.put('/api/products/:id', adminOnly, (req, res) => {
  const p = productBody(req.body);
  if (!p) return res.status(400).json({ error: 'Заполните модель, память, цвет и SIM' });
  run('UPDATE products SET model = ?, storage = ?, color = ?, sim = ?, price = ?, qty = ? WHERE id = ?', p.model, p.storage, p.color, p.sim, p.price, p.qty, req.params.id);
  res.json({ ok: true });
});
app.delete('/api/products/:id', adminOnly, (req, res) => {
  run('DELETE FROM products WHERE id = ?', req.params.id);
  res.json({ ok: true });
});

// ---------- продавцы ----------
app.get('/api/users', (req, res) => res.json(all(PUBLIC_USER + ' ORDER BY role, name')));
app.post('/api/users', adminOnly, (req, res) => {
  const login = str(req.body.login).toLowerCase(), name = str(req.body.name), pw = String(req.body.password ?? '');
  if (!login || !name || pw.length < 4) return res.status(400).json({ error: 'Логин, имя и пароль (от 4 символов) обязательны' });
  if (get('SELECT 1 FROM users WHERE login = ?', login)) return res.status(400).json({ error: 'Такой логин уже есть' });
  run('INSERT INTO users (login, name, pass, role) VALUES (?, ?, ?, ?)', login, name, hash(pw), req.body.role === 'admin' ? 'admin' : 'seller');
  res.json({ ok: true });
});
app.put('/api/users/:login', adminOnly, (req, res) => {
  const u = get('SELECT * FROM users WHERE login = ?', req.params.login);
  if (!u) return res.status(404).json({ error: 'Нет такого пользователя' });
  const name = str(req.body.name) || u.name;
  const pass = req.body.password ? (String(req.body.password).length < 4 ? null : hash(String(req.body.password))) : u.pass;
  if (!pass) return res.status(400).json({ error: 'Пароль от 4 символов' });
  run('UPDATE users SET name = ?, pass = ? WHERE login = ?', name, pass, u.login);
  if (name !== u.name) run('UPDATE orders SET seller = ? WHERE seller = ?', name, u.name);
  if (req.body.password) run('DELETE FROM sessions WHERE login = ? AND token != ?', u.login, req.get('x-token'));
  res.json({ ok: true });
});
app.delete('/api/users/:login', adminOnly, (req, res) => {
  if (req.params.login === req.user.login) return res.status(400).json({ error: 'Нельзя удалить себя' });
  run('DELETE FROM users WHERE login = ?', req.params.login);
  run('DELETE FROM sessions WHERE login = ?', req.params.login);
  res.json({ ok: true });
});

// Все имена продавцов: вписанные в заявки и имена аккаунтов — для подсказок и фильтра
app.get('/api/sellers', (req, res) => res.json(all('SELECT seller AS name FROM orders UNION SELECT name FROM users ORDER BY 1').map(r => r.name)));

// ---------- заявки ----------
app.get('/api/orders', (req, res) => {
  const { from, to } = req.query;
  res.json(from && to
    ? all('SELECT * FROM orders WHERE date >= ? AND date <= ? ORDER BY date, time', from, to)
    : all('SELECT * FROM orders ORDER BY date DESC, time DESC'));
});

// Телефон в заявке — только позиция из базы; продавец — имя, которое вписали (аккаунт общий на несколько продавцов).
// old — текущая заявка при редактировании: если её позицию удалили из базы, телефон остаётся прежним.
function orderBody(b, old) {
  let product = get('SELECT * FROM products WHERE id = ?', Number(b.product_id));
  if (!product && old && Number(b.product_id) === old.product_id) product = { ...old, id: old.product_id };
  if (!product) return { error: 'Выберите телефон из базы' };
  const date = str(b.date), client = str(b.client);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !client) return { error: 'Дата и имя клиента обязательны' };
  const seller = str(b.seller);
  if (!seller) return { error: 'Впишите продавца — чей это телефон' };
  return {
    date, time: str(b.time), client, phone: str(b.phone),
    product_id: product.id, model: product.model, storage: product.storage, color: product.color, sim: product.sim,
    price: num(b.price) ?? product.price, comment: str(b.comment), seller,
    status: STATUSES.includes(b.status) ? b.status : 'new',
  };
}

// Бронь и продажа держат штуку: «В работе» — бронь, «Продано» — штука списана из qty.
// Проверяем наличие, только когда заявка начинает держать штуку этой позиции.
const holds = s => s === 'new' || s === 'sold';
function stockError(o, old) {
  if (!holds(o.status) || (old && holds(old.status) && old.product_id === o.product_id)) return null;
  const p = get('SELECT qty FROM products WHERE id = ?', o.product_id);
  if (!p) return null; // позицию удалили из базы — складом не управляем
  const reserved = get(`SELECT COUNT(*) AS n FROM orders WHERE product_id = ? AND status = 'new' AND id != ?`, o.product_id, old?.id ?? '').n;
  return Number(p.qty) - Number(reserved) >= 1 ? null : 'Этого телефона нет в наличии — все штуки проданы или в брони';
}
// После записи: снятая продажа возвращает штуку, новая — списывает
function moveStock(old, o) {
  if (old?.status === 'sold') run('UPDATE products SET qty = qty + 1 WHERE id = ?', old.product_id);
  if (o?.status === 'sold') run('UPDATE products SET qty = MAX(qty - 1, 0) WHERE id = ?', o.product_id);
}

app.post('/api/orders', (req, res) => {
  const o = orderBody(req.body);
  if (o.error) return res.status(400).json(o);
  const stock = stockError(o);
  if (stock) return res.status(400).json({ error: stock });
  const id = crypto.randomUUID(), cols = Object.keys(o);
  run(`INSERT INTO orders (id, created_at, ${cols.join(', ')}) VALUES (?, ?, ${cols.map(() => '?').join(', ')})`,
    id, new Date().toISOString(), ...Object.values(o));
  moveStock(null, o);
  res.json({ id });
});

app.put('/api/orders/:id', (req, res) => {
  const old = get('SELECT * FROM orders WHERE id = ?', req.params.id);
  if (!old) return res.status(404).json({ error: 'Заявка не найдена' });
  const o = orderBody(req.body, old);
  if (o.error) return res.status(400).json(o);
  const stock = stockError(o, old);
  if (stock) return res.status(400).json({ error: stock });
  const cols = Object.keys(o);
  run(`UPDATE orders SET ${cols.map(c => c + ' = ?').join(', ')} WHERE id = ?`, ...Object.values(o), req.params.id);
  moveStock(old, o);
  res.json({ ok: true });
});

app.delete('/api/orders/:id', (req, res) => {
  const old = get('SELECT * FROM orders WHERE id = ?', req.params.id);
  run('DELETE FROM orders WHERE id = ?', req.params.id);
  moveStock(old, null);
  res.json({ ok: true });
});

app.listen(PORT, () => console.log(`Заявки: http://localhost:${PORT}  (первый вход: admin / admin)`));
