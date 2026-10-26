// Аккаунты и сессии. Хранилище передаётся снаружи: на сервере это общая база.
export const USERS_KEY = 'iphone-zayavki:users:v1';
export const SESSIONS_KEY = 'iphone-zayavki:sessions:v1';

// adminPassword — пароль первого администратора; без него админ не создаётся.
export function createLocalAuth(storage, adminPassword = 'admin') {
  const error = message => { throw new Error(message); };
  const str = v => String(v ?? '').trim().slice(0, 500);
  const pub = ({ login, name, role }) => ({ login, name, role });
  async function hash(pw, salt = crypto.randomUUID()) {
    const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(salt + pw));
    return salt + ':' + [...new Uint8Array(bytes)].map(b => b.toString(16).padStart(2, '0')).join('');
  }
  async function read() {
    const users = JSON.parse(storage.getItem(USERS_KEY) || '[]');
    if (!users.some(u => u.role === 'admin')) {
      if (!adminPassword) error('Задайте ADMIN_PASSWORD для первого администратора');
      users.push({ login: 'admin', name: 'Админ', role: 'admin', pass: await hash(adminPassword) });
      write(users);
    }
    return users;
  }
  const write = users => storage.setItem(USERS_KEY, JSON.stringify(users));
  const sessions = () => JSON.parse(storage.getItem(SESSIONS_KEY) || '{}');
  const saveSessions = s => storage.setItem(SESSIONS_KEY, JSON.stringify(s));
  // Удаляет сессии пользователя, кроме keep
  function dropSessions(login, keep) {
    const s = sessions();
    for (const t of Object.keys(s)) if (s[t] === login && t !== keep) delete s[t];
    saveSessions(s);
  }

  return async function request(path, opts = {}, token) {
    const users = await read();
    const method = opts.method || 'GET', body = opts.body || {};
    const [, resource, id] = path.split('/');
    if (resource === 'login') {
      const u = users.find(u => u.login === str(body.login).toLowerCase());
      if (!u || await hash(String(body.password ?? ''), u.pass.split(':')[0]) !== u.pass) error('Неверный логин или пароль');
      const t = crypto.randomUUID() + crypto.randomUUID();
      saveSessions({ ...sessions(), [t]: u.login });
      return { token: t, user: pub(u) };
    }
    const me = users.find(u => u.login === sessions()[token]);
    if (!me) error('auth');
    if (resource === 'me') return pub(me);
    if (resource === 'logout') {
      const s = sessions(); delete s[token]; saveSessions(s);
      return { ok: true };
    }
    if (resource !== 'users') error('Неизвестная операция');
    if (method === 'GET') return users.map(pub).sort((a, b) => a.role.localeCompare(b.role) || a.name.localeCompare(b.name));
    if (me.role !== 'admin') error('Только для админа');
    if (method === 'POST') {
      const login = str(body.login).toLowerCase(), name = str(body.name), pw = String(body.password ?? '');
      if (!login || !name || pw.length < 4) error('Логин, имя и пароль (от 4 символов) обязательны');
      if (users.some(u => u.login === login)) error('Такой логин уже есть');
      users.push({ login, name, role: body.role === 'admin' ? 'admin' : 'seller', pass: await hash(pw) });
    } else {
      const index = users.findIndex(u => u.login === id);
      if (index < 0) error('Нет такого пользователя');
      if (method === 'DELETE') {
        if (id === me.login) error('Нельзя удалить себя');
        users.splice(index, 1);
        dropSessions(id);
      } else {
        const u = users[index];
        if (body.password && String(body.password).length < 4) error('Пароль от 4 символов');
        users[index] = { ...u, name: str(body.name) || u.name, pass: body.password ? await hash(String(body.password)) : u.pass };
        if (body.password) dropSessions(id, token);
      }
    }
    write(users);
    return { ok: true };
  };
}
