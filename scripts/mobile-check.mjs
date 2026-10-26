import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { access, mkdtemp, readFile, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';

// Изолированные аккаунты и профиль: проверка не затрагивает рабочую базу и браузер.
process.env.DB_FILE = ':memory:';
process.env.ADMIN_LOGIN = 'mobile-test';
process.env.ADMIN_PASSWORD = 'mobile-test-password';
delete process.env.TURSO_DATABASE_URL;
delete process.env.TURSO_AUTH_TOKEN;
delete process.env.VERCEL;
const { default: app } = await import('../server.js');
const server = app.listen(0, '127.0.0.1');
await once(server, 'listening');
const base = `http://127.0.0.1:${server.address().port}`;
const profile = await mkdtemp(path.join(tmpdir(), 'iphone-mobile-'));
const artifacts = path.resolve('.artifacts/mobile');
await mkdir(artifacts, { recursive: true });
const candidates = [process.env.CHROME_PATH,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  '/usr/bin/chromium', '/usr/bin/google-chrome'].filter(Boolean);
let executable;
for (const file of candidates) { try { await access(file); executable = file; break; } catch {} }
if (!executable) {
  await new Promise(resolve => server.close(resolve));
  await rm(profile, { recursive: true, force: true });
  throw new Error('Укажите путь к Chrome/Chromium в CHROME_PATH');
}
const browser = spawn(executable, ['--headless=new', '--disable-gpu', '--no-first-run',
  '--no-default-browser-check', '--disable-background-networking', '--remote-debugging-port=0',
  `--user-data-dir=${profile}`, 'about:blank'], { windowsHide: true, stdio: 'ignore' });
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
let socket;
try {
  let debugPort;
  for (let i = 0; i < 100; i++) {
    try { debugPort = (await readFile(path.join(profile, 'DevToolsActivePort'), 'utf8')).split('\n')[0]; break; }
    catch { await pause(100); }
  }
  if (!debugPort) throw new Error('Chrome не запустил DevTools');
  const targets = await (await fetch(`http://127.0.0.1:${debugPort}/json/list`)).json();
  socket = new WebSocket(targets.find(t => t.type === 'page').webSocketDebuggerUrl);
  await once(socket, 'open');
  let id = 0;
  const pending = new Map(), errors = [];
  function send(method, params = {}) {
    const key = ++id;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { pending.delete(key); reject(new Error('CDP timeout: ' + method)); }, 15000);
      pending.set(key, { resolve, reject, timer });
      socket.send(JSON.stringify({ id: key, method, params }));
    });
  }
  socket.addEventListener('message', event => {
    const message = JSON.parse(event.data);
    if (message.id) {
      const p = pending.get(message.id);
      if (!p) return;
      pending.delete(message.id); clearTimeout(p.timer);
      message.error ? p.reject(new Error(JSON.stringify(message.error))) : p.resolve(message.result);
    } else if (message.method === 'Runtime.exceptionThrown') errors.push(message.params.exceptionDetails.text + ': ' + (message.params.exceptionDetails.exception?.description || ''));
    else if (message.method === 'Fetch.requestPaused') {
      const { requestId, request } = message.params;
      send(request.url.startsWith(base) ? 'Fetch.continueRequest' : 'Fetch.failRequest', request.url.startsWith(base)
        ? { requestId } : { requestId, errorReason: 'Aborted' }).catch(() => {});
    }
  });
  const evaluate = async expression => {
    const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
    return result.result.value;
  };
  const waitFor = async expression => {
    for (let i = 0; i < 100; i++) { if (await evaluate(expression)) return; await pause(60); }
    throw new Error('Не дождались: ' + expression);
  };
  await send('Page.enable'); await send('Runtime.enable');
  await send('Fetch.enable', { patterns: [{ urlPattern: '*' }] });
  const login = await (await fetch(base + '/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ login: 'mobile-test', password: 'mobile-test-password' }) })).json();
  const today = new Date();
  const iso = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const products = [{ id: 1, model: 'iPhone 17 Pro Max', storage: '256 ГБ', color: 'Desert Titanium', sim: 'SIM + eSIM', qty: 20, price: 175000 },
    { id: 2, model: 'iPhone 16 Pro', storage: '1 ТБ', color: 'Natural Titanium', sim: '2 SIM', qty: 10, price: 149990 }];
  const orders = Array.from({ length: 9 }, (_, i) => ({ id: 'mobile-' + i, date: iso(new Date(today.getFullYear(), today.getMonth(), today.getDate() - (i % 3))),
    time: `${10 + i}:30`, client: i === 0 ? 'Александр Константинопольский' : 'Клиент ' + i, phone: '+7 (900) 123-45-67',
    product_id: 1, model: products[0].model, storage: '256 ГБ', color: products[0].color, sim: products[0].sim,
    price: 175000, seller: 'Александра', comment: 'Перед приездом позвонить. Нужны фотографии коробки и проверка комплектации.',
    status: i % 4 === 0 ? 'sold' : i % 4 === 1 ? 'cancel' : 'new', created_at: new Date().toISOString() }));
  await send('Page.addScriptToEvaluateOnNewDocument', { source: `if (!localStorage.getItem('token')) localStorage.setItem('token', ${JSON.stringify(login.token)}); if (!localStorage.getItem('sellerName')) localStorage.setItem('sellerName', 'Александра'); if (!localStorage.getItem('iphone-zayavki:data:v1')) localStorage.setItem('iphone-zayavki:data:v1', ${JSON.stringify(JSON.stringify({ version: 1, products, orders }))});` });
  const baseline = process.argv.includes('--baseline');
  const report = [];
  for (const width of baseline ? [390] : [320, 360, 390, 430, 768, 1280]) {
    await send('Emulation.setDeviceMetricsOverride', { width, height: 844, deviceScaleFactor: 1, mobile: width < 641 });
    await send('Page.navigate', { url: base });
    await waitFor(`!!document.querySelector('#week .card')`);
    for (const stage of baseline ? ['week', 'mine', 'stats', 'admin'] : ['week', 'mine', 'stats', 'stats-month', 'stats-all', 'admin', 'admin-users', 'admin-stock']) {
      const view = stage.split('-')[0];
      await evaluate(`document.querySelector('[data-view="${view}"]').click()`);
      await waitFor(`!document.querySelector('#${view}View').classList.contains('hidden')`);
      if (stage.startsWith('stats')) await evaluate(`document.querySelector('[data-p="${stage.split('-')[1] || 'week'}"]').click()`);
      if (stage === 'admin-users') await evaluate(`document.querySelector('[data-a="users"]').click()`);
      if (stage === 'admin-stock') {
        await evaluate(`document.querySelector('[data-a="products"]').click()`);
        await pause(120);
        await evaluate(`document.querySelector('#productsList').scrollIntoView({block:'start'})`);
      }
      await pause(120);
      const measurement = await evaluate(`(() => {
        const nav = document.querySelector('.tabs').getBoundingClientRect();
        const visible = [...document.querySelectorAll('button, input, select, textarea')].filter(el => el.getClientRects().length && !el.disabled && !el.closest('dialog:not([open])'));
        return {width: innerWidth, scrollWidth: document.documentElement.scrollWidth, navTop: nav.top, navBottom: nav.bottom,
          smallInputs: visible.filter(el => el.matches('input,select,textarea') && parseFloat(getComputedStyle(el).fontSize) < 16).map(el => el.id || el.name),
          smallTargets: visible.filter(el => el.tagName === 'BUTTON' && (el.offsetHeight < 44 || el.offsetWidth < 44)).map(el => el.id || el.className),
          overflow: [...document.querySelectorAll('body *')].filter(el => el.getClientRects().length && el.getBoundingClientRect().right > innerWidth + 1).slice(0,8).map(el => el.className || el.tagName)};
      })()`);
      report.push({ viewport: width, view: stage, ...measurement });
      if (!baseline) {
        assert.ok(measurement.scrollWidth <= width + 1, `${width}/${view}: горизонтальная прокрутка ${JSON.stringify(measurement)}`);
        if (width <= 640) {
          assert.ok(Math.abs(measurement.navBottom - 844) <= 1, `${width}/${view}: навигация не внизу`);
          assert.deepEqual(measurement.smallInputs, [], `${width}/${view}: мелкий текст ввода`);
          assert.deepEqual(measurement.smallTargets, [], `${width}/${view}: маленькие кнопки`);
        }
      }
      if (width === 390) {
        const shot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
        await writeFile(path.join(artifacts, `${baseline ? 'before-' : ''}${stage}.png`), Buffer.from(shot.data, 'base64'));
      }
    }
    await evaluate(`document.querySelector('[data-view="week"]').click()`);
    await pause(150);
    await evaluate(`document.querySelector('#newBtn').click()`);
    const modal = await evaluate(`(() => { const d=document.querySelector('#dlg'), r=d.getBoundingClientRect();return {open:d.open,width:r.width,left:r.left,height:r.height,scrollWidth:d.scrollWidth,clientWidth:d.clientWidth,inputs:[...d.querySelectorAll('input,select,textarea')].filter(el=>el.getClientRects().length).map(el=>parseFloat(getComputedStyle(el).fontSize))}; })()`);
    if (!baseline) {
      assert.equal(modal.open, true);
      assert.ok(modal.scrollWidth <= modal.clientWidth + 1, `${width}: диалог шире экрана`);
      assert.ok(modal.left >= -1 && modal.width <= width + 1);
      if (width <= 640) assert.ok(modal.inputs.every(size => size >= 16), 'Мелкий текст в форме');
    }
    if (width === 390) {
      const shot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
      await writeFile(path.join(artifacts, `${baseline ? 'before-' : ''}form.png`), Buffer.from(shot.data, 'base64'));
      if (!baseline) {
        await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 430, deviceScaleFactor: 1, mobile: true });
        await pause(150);
        const short = await evaluate(`(() => { const r=document.querySelector('#saveBtn').getBoundingClientRect();return {height:document.querySelector('#dlg').getBoundingClientRect().height,top:r.top,bottom:r.bottom}; })()`);
        assert.ok(short.height <= 431 && short.top >= 0 && short.bottom <= 431, 'Кнопка сохранения недоступна на коротком экране');
        const shot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
        await writeFile(path.join(artifacts, 'form-short.png'), Buffer.from(shot.data, 'base64'));
        await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
        await pause(100);
        await evaluate(`document.querySelector('#orderForm [name=client]').focus()`);
        await send('Input.insertText', { text: 'Мобильная проверка' });
        await evaluate(`document.querySelector('#orderForm [name=seller]').value='Александра'; document.querySelector('#saveBtn').click()`);
        await waitFor(`!document.querySelector('#dlg').open`);
        const created = await evaluate(`JSON.parse(localStorage.getItem('iphone-zayavki:data:v1')).orders.find(o=>o.client==='Мобильная проверка')`);
        assert.ok(created?.id, 'Заявка не сохранилась');
        await send('Page.navigate', { url: base });
        await waitFor(`!!document.querySelector('[data-id="${created.id}"]')`);
        await evaluate(`document.querySelector('[data-id="${created.id}"]').click()`);
        await waitFor(`document.querySelector('#dlg').open`);
        assert.equal(await evaluate(`document.querySelector('#orderForm [name=client]').value`), 'Мобильная проверка');
        await evaluate(`document.querySelector('#orderForm [name=comment]').value='Изменено на мобильном экране'; document.querySelector('#saveBtn').click()`);
        await waitFor(`!document.querySelector('#dlg').open`);
        assert.equal(await evaluate(`JSON.parse(localStorage.getItem('iphone-zayavki:data:v1')).orders.find(o=>o.id==='${created.id}').comment`), 'Изменено на мобильном экране');
      }
    }
    await evaluate(`document.querySelector('#dlg').close()`);
  }
  if (!baseline) {
    await fetch(base + '/api/users', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-token': login.token },
      body: JSON.stringify({ login: 'mobile-seller', name: 'Александра', password: 'seller-password' }) });
    const seller = await (await fetch(base + '/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ login: 'mobile-seller', password: 'seller-password' }) })).json();
    await evaluate(`localStorage.setItem('token', ${JSON.stringify(seller.token)})`);
    await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
    await send('Page.navigate', { url: base });
    await waitFor(`document.querySelector('#adminTitle')?.textContent==='Наличие'`);
    await evaluate(`document.querySelector('[data-view=admin]').click()`);
    await waitFor(`!!document.querySelector('.prow.ro:not(.th)')`);
    assert.ok(await evaluate(`document.documentElement.scrollWidth <= innerWidth`), 'Переполнение склада продавца');
    assert.equal(await evaluate(`document.querySelectorAll('.prow.ro [data-label]').length > 0`), true);
    const shot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    await writeFile(path.join(artifacts, 'seller-stock.png'), Buffer.from(shot.data, 'base64'));
    await evaluate(`localStorage.setItem('iphone-zayavki:data:v1', JSON.stringify({version:1,products:[],orders:[]}))`);
    await send('Page.navigate', { url: base });
    await waitFor(`document.querySelectorAll('#week .ag.blank').length===7`);
    assert.equal(await evaluate(`document.documentElement.scrollWidth <= innerWidth`), true, 'Переполнение пустой недели');
    assert.equal(await evaluate(`!!document.querySelector('#weekSide .chart-empty')`), true);
    const emptyShot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    await writeFile(path.join(artifacts, 'empty-week.png'), Buffer.from(emptyShot.data, 'base64'));
  }
  assert.deepEqual(errors, [], 'Ошибки JavaScript в браузере');
  await writeFile(path.join(artifacts, baseline ? 'before.json' : 'report.json'), JSON.stringify(report, null, 2));
  console.log(`${report.length} screen checks passed; no horizontal overflow or JavaScript errors. Mobile inputs >=16px; buttons >=44px. Create, reload, edit and short-screen form checks passed.`);
  console.log('Screenshots: ' + artifacts);
  await send('Browser.close');
} finally {
  socket?.close();
  browser.kill();
  await new Promise(resolve => server.close(resolve));
  for (let i = 0; i < 15; i++) { try { await rm(profile, { recursive: true, force: true }); break; } catch { await pause(100); } }
}
