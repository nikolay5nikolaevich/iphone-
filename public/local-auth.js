// Аккаунты хранятся в браузере: сервер не нужен, но и защиты от владельца устройства нет.
export const USERS_KEY = 'iphone-zayavki:users:v1';

export function createLocalAuth(storage) {
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
      users.push({ login: 'admin', name: 'Админ', role: 'admin', pass: await hash('admin') });
      write(users);
    }
    return users;
  }
  const write = users => storage.setItem(USERS_KEY, JSON.stringify(users));

  // token — логин вошедшего пользователя
  return async function request(path, opts = {}, token) {
    const users = await read();
    const method = opts.method || 'GET', body = opts.body || {};
    const [, resource, id] = path.split('/');
    if (resource === 'login') {
      const u = users.find(u => u.login === str(body.login).toLowerCase());
      if (!u || await hash(String(body.password ?? ''), u.pass.split(':')[0]) !== u.pass) error('Неверный логин или пароль');
      return { token: u.login, user: pub(u) };
    }
    const me = users.find(u => u.login === token);
    if (!me) error('auth');
    if (resource === 'me') return pub(me);
    if (resource === 'logout') return { ok: true };
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
      } else {
        const u = users[index];
        if (body.password && String(body.password).length < 4) error('Пароль от 4 символов');
        users[index] = { ...u, name: str(body.name) || u.name, pass: body.password ? await hash(String(body.password)) : u.pass };
      }
    }
    write(users);
    return { ok: true };
  };
}
