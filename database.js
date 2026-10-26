// На Vercel используем удалённый SQLite, локально сохраняем существующий data.db.
export async function openDatabase(env = process.env) {
  if (env.TURSO_DATABASE_URL) {
    if (!env.TURSO_AUTH_TOKEN) throw new Error('Задайте TURSO_AUTH_TOKEN для подключения к базе.');
    if (!/^(libsql|https):\/\//.test(env.TURSO_DATABASE_URL)) {
      throw new Error('TURSO_DATABASE_URL должен начинаться с libsql:// или https://.');
    }
    const { createClient } = await import('@libsql/client/web');
    const client = createClient({ url: env.TURSO_DATABASE_URL, authToken: env.TURSO_AUTH_TOKEN });
    return {
      all: async (sql, ...args) => (await client.execute({ sql, args })).rows,
      get: async (sql, ...args) => (await client.execute({ sql, args })).rows[0],
      run: (sql, ...args) => client.execute({ sql, args }),
      exec: sql => client.executeMultiple(sql),
      close: () => client.close(),
    };
  }
  if (env.VERCEL) {
    throw new Error('Для Vercel задайте TURSO_DATABASE_URL и TURSO_AUTH_TOKEN. Локальный data.db здесь не сохраняется.');
  }
  const { DatabaseSync } = await import('node:sqlite');
  const db = new DatabaseSync(env.DB_FILE || 'data.db');
  return {
    all: async (sql, ...args) => db.prepare(sql).all(...args),
    get: async (sql, ...args) => db.prepare(sql).get(...args),
    run: async (sql, ...args) => db.prepare(sql).run(...args),
    exec: async sql => db.exec(sql),
    close: () => db.close(),
  };
}
