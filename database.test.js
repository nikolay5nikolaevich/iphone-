import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { openDatabase } from './database.js';

test('database preserves accounts and sessions across connections', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'iphone-db-'));
  const env = { DB_FILE: path.join(directory, 'test.db') };
  let db;
  try {
    db = await openDatabase(env);
    await db.exec('CREATE TABLE users (login TEXT PRIMARY KEY, name TEXT); CREATE TABLE sessions (token TEXT, login TEXT);');
    await db.run('INSERT INTO users VALUES (?, ?)', 'seller', 'Анна');
    await db.run('INSERT INTO sessions VALUES (?, ?)', 'test-token', 'seller');
    db.close();
    db = await openDatabase(env);
    assert.equal((await db.get('SELECT * FROM users WHERE login = ?', 'seller')).name, 'Анна');
    assert.equal((await db.all('SELECT * FROM sessions')).length, 1);
  } finally {
    db?.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test('Vercel requires persistent remote storage and complete configuration', async () => {
  await assert.rejects(openDatabase({ VERCEL: '1' }), /TURSO_DATABASE_URL/);
  await assert.rejects(openDatabase({ TURSO_DATABASE_URL: 'libsql://example.turso.io' }), /TURSO_AUTH_TOKEN/);
  await assert.rejects(openDatabase({ TURSO_DATABASE_URL: 'file:data.db', TURSO_AUTH_TOKEN: 'test' }), /libsql/);
  const db = await openDatabase({ VERCEL: '1', TURSO_DATABASE_URL: 'https://example.turso.io', TURSO_AUTH_TOKEN: 'test' });
  db.close();
});
