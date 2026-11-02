// Ende-zu-Ende-Test der Werbefrei-Zentrale gegen eine nachgebaute Surge-Schnittstelle.
// Braucht Playwright mit Chromium. Aufruf: node tests/app-e2e.cjs [ordner-für-bildschirmfotos]
'use strict';

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

const APP_DIR = path.join(__dirname, '..', 'app');
const SHOT_DIR = process.argv[2];
const KEY = 'testSchluessel123';
const MODULE = 'YouTube werbefrei';

let fehler = 0;
function ok(cond, text) {
  console.log(`${cond ? 'OK    ' : 'FEHLER'} ${text}`);
  if (!cond) fehler++;
}

// ---------- Nachgebaute Surge-Schnittstelle ----------
const surge = { enabled: [MODULE], available: [MODULE, 'Anderes Modul'], mitm: true, scripting: true, calls: [] };
function surgeHandler(req, res) {
  const cors = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'X-Key, Content-Type',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  };
  if (req.method === 'OPTIONS') { res.writeHead(204, cors); res.end(); return; }
  if (req.headers['x-key'] !== KEY) { res.writeHead(401, cors); res.end('{"error":"unauthorized"}'); return; }
  let body = '';
  req.on('data', (c) => { body += c; });
  req.on('end', () => {
    const data = body ? JSON.parse(body) : {};
    surge.calls.push(`${req.method} ${req.url} ${body}`);
    const send = (obj) => { res.writeHead(200, { ...cors, 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)); };
    const url = req.url.split('?')[0];
    if (url === '/v1/modules') {
      if (req.method === 'POST') {
        for (const [name, on] of Object.entries(data)) {
          surge.enabled = on ? [...new Set([...surge.enabled, name])] : surge.enabled.filter((n) => n !== name);
        }
        return send({});
      }
      return send({ enabled: surge.enabled, available: surge.available });
    }
    const feature = url.match(/^\/v1\/features\/(mitm|scripting)$/);
    if (feature) {
      if (req.method === 'POST') surge[feature[1]] = data.enabled === true;
      return send({ enabled: surge[feature[1]] });
    }
    if (url === '/v1/profiles/reload' || url === '/v1/dns/flush') return send({});
    res.writeHead(404, cors);
    res.end('{}');
  });
}

// ---------- Statischer Server für die App ----------
const TYPES = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };
function appHandler(req, res) {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p.endsWith('/')) p += 'index.html';
  const file = path.join(APP_DIR, p);
  if (!file.startsWith(APP_DIR) || !fs.existsSync(file)) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
}

const listen = (server, port, host) => new Promise((r) => server.listen(port, host, r));

(async () => {
  const appServer = http.createServer(appHandler);
  let surgeServer = http.createServer(surgeHandler);
  await listen(appServer, 8765, '127.0.0.1');
  await listen(surgeServer, 6171, '127.0.0.1');
  const APP = 'http://localhost:8765/';

  const browser = await chromium.launch();
  const settings = { base: 'http://127.0.0.1:6171', key: KEY, module: MODULE, nextdnsId: '', demo: false };

  async function newPage(colorScheme, extraSettings = {}) {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, colorScheme });
    await ctx.addInitScript((s) => {
      if (!sessionStorage.getItem('init')) {
        localStorage.setItem('wf.settings', JSON.stringify(s));
        sessionStorage.setItem('init', '1');
      }
    }, { ...settings, ...extraSettings });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => { if (m.type() === 'error' && !/ERR_UNKNOWN_URL_SCHEME|ERR_ABORTED|ERR_CONNECTION_REFUSED|status of 401/.test(m.text())) errors.push(m.text()); });
    await page.goto(APP);
    return { ctx, page, errors };
  }
  const titleIs = (page, text) => page.waitForFunction((t) => document.getElementById('status-title').textContent === t, text, { timeout: 8000 }).then(() => true, () => false);
  const shot = async (page, name) => { if (SHOT_DIR) await page.screenshot({ path: path.join(SHOT_DIR, name), fullPage: false }); };

  // --- Hell: Normalbetrieb ---
  const { ctx, page, errors } = await newPage('light');
  ok(await titleIs(page, 'Schutz aktiv'), 'Startet verbunden: „Schutz aktiv“');
  ok(await page.getAttribute('#sw-surge', 'aria-checked') === 'true', 'Hauptschalter steht auf AN');
  ok(await page.getAttribute('#sw-module', 'aria-checked') === 'true', 'Modulschalter steht auf AN');
  await shot(page, '1-hell-aktiv.png');

  await page.click('#sw-module');
  ok(await titleIs(page, 'Teilweise aktiv'), 'Modul aus: „Teilweise aktiv“');
  ok(!surge.enabled.includes(MODULE), 'Surge hat das Modul wirklich ausgeschaltet');
  ok(surge.calls.some((c) => c.startsWith('POST /v1/modules') && c.includes('"YouTube werbefrei":false')), 'Richtige Anfrage an /v1/modules');

  await page.click('#btn-pause');
  ok(await titleIs(page, 'Pausiert'), 'Alles pausieren: „Pausiert“');
  ok(!surge.mitm && !surge.scripting, 'MitM und Skripte sind in Surge aus');
  await shot(page, '2-hell-pausiert.png');

  await page.click('#btn-resume');
  ok(await titleIs(page, 'Schutz aktiv'), 'Alles an: wieder „Schutz aktiv“');
  ok(surge.mitm && surge.scripting && surge.enabled.includes(MODULE), 'In Surge wieder alles an');

  await page.click('#btn-notaus');
  const url = await page.evaluate(() => window.__letzteExterneUrl);
  ok(url === 'surge:///stop?autoclose=true', `NOTAUS ruft ${url} auf`);

  // Surge aus: Server stoppen
  await new Promise((r) => surgeServer.close(r));
  surgeServer.closeAllConnections?.();
  ok(await titleIs(page, 'Surge ist aus'), 'Surge nicht erreichbar: „Surge ist aus“');
  ok(await page.getAttribute('#sw-module', 'disabled') !== null, 'Filterschalter sind gesperrt, solange Surge aus ist');
  await page.click('#sw-surge');
  ok(await page.evaluate(() => window.__letzteExterneUrl) === 'surge:///start?autoclose=true', 'Hauptschalter startet Surge über surge:///start');
  surgeServer = http.createServer(surgeHandler);
  await listen(surgeServer, 6171, '127.0.0.1');
  ok(await titleIs(page, 'Schutz aktiv'), 'Nach dem Start wieder „Schutz aktiv“');

  // Startmenü
  await page.click('#btn-start');
  ok(await page.isVisible('#start-menu'), 'Startmenü öffnet sich');
  await shot(page, '3-hell-menue.png');
  await page.click('.sm-item[data-action="settings"]');
  ok(await page.isVisible('#dlg-settings'), 'Einstellungen öffnen sich aus dem Menü');
  const lines = await page.textContent('#f-lines');
  ok(lines === `http-api = ${KEY}@127.0.0.1:6171\nhttp-api-tls = false`, 'Zeilen fürs Surge-Profil stimmen');
  await shot(page, '4-hell-einstellungen.png');
  await page.click('#dlg-settings [data-close].btn');
  ok(errors.length === 0, `Keine JavaScript-Fehler ${errors.join(' | ')}`);
  await ctx.close();

  // --- Falscher Schlüssel ---
  const wrong = await newPage('light', { key: 'falscherSchluessel' });
  ok(await titleIs(wrong.page, 'Schlüssel passt nicht'), 'Falscher Schlüssel: „Schlüssel passt nicht“');
  await wrong.ctx.close();

  // --- Erster Start ohne Einrichtung ---
  const fresh = await newPage('light', { key: '' });
  ok(await titleIs(fresh.page, 'Einrichtung nötig'), 'Ohne Schlüssel: „Einrichtung nötig“');
  ok(await fresh.page.isVisible('#btn-setup'), 'Knopf „Jetzt einrichten“ ist sichtbar');

  // Einrichtungs-Assistent
  await fresh.page.click('#btn-setup');
  ok(await fresh.page.isVisible('#dlg-setup'), 'Assistent öffnet sich über „Jetzt einrichten“');
  const genKey = await fresh.page.evaluate(() => JSON.parse(localStorage.getItem('wf.settings')).key);
  ok(/^[A-Za-z0-9]{20}$/.test(genKey), 'Assistent erzeugt automatisch einen Schlüssel');
  await fresh.page.fill('#s-nextdns', 'abc123');
  const setupText = await fresh.page.textContent('#s-lines');
  ok(setupText === `encrypted-dns-server = https://dns.nextdns.io/abc123/Surge-iPhone\nhttp-api = ${genKey}@127.0.0.1:6171\nhttp-api-tls = false`,
    'Drei Zeilen fürs Surge-Profil enthalten NextDNS-ID und Schlüssel');
  const moduleHref = await fresh.page.getAttribute('#s-module-link', 'href');
  ok(decodeURIComponent(moduleHref.split('url=')[1]) === 'https://raw.githubusercontent.com/r9dfd8pypz-bit/adblock-regeln/main/modules/youtube-werbefrei.sgmodule',
    'Modul-Knopf zeigt auf das Repo');
  await fresh.page.click('.step[data-step="verbinden"] [data-setup="test"]');
  await fresh.page.waitForSelector('#balloon:not([hidden])');
  const balloonOnTop = await fresh.page.evaluate(() => {
    const b = document.getElementById('balloon');
    const r = b.getBoundingClientRect();
    const top = document.elementFromPoint(r.left + r.width / 2, r.top + 12);
    return b.closest('dialog[open]') !== null && b.contains(top);
  });
  ok(balloonOnTop, 'Sprechblase liegt bei offenem Assistenten sichtbar oben');
  await fresh.page.click('#balloon-close');
  await fresh.page.click('.step[data-step="nextdns-konto"] .step-check');
  ok(await fresh.page.textContent('#setup-progress') === '1 von 9 Schritten erledigt', 'Abhaken zählt den Fortschritt');
  await shot(fresh.page, '7-hell-einrichtung.png');
  await fresh.page.reload();
  await fresh.page.click('#btn-start');
  await fresh.page.click('.sm-item[data-action="setup"]');
  ok(await fresh.page.textContent('#setup-progress') === '1 von 9 Schritten erledigt', 'Fortschritt bleibt nach Neustart erhalten');
  ok(await fresh.page.inputValue('#s-nextdns') === 'abc123', 'NextDNS-ID bleibt gespeichert');
  ok(fresh.errors.length === 0, `Keine JavaScript-Fehler (Einrichtung) ${fresh.errors.join(' | ')}`);
  await fresh.ctx.close();

  // --- Dunkel ---
  const dark = await newPage('dark');
  ok(await titleIs(dark.page, 'Schutz aktiv'), 'Dunkelmodus: verbunden');
  const bg = await dark.page.evaluate(() => getComputedStyle(document.querySelector('.window')).backgroundColor);
  ok(bg === 'rgb(35, 39, 46)', `Dunkles Fenster (${bg})`);
  await shot(dark.page, '5-dunkel-aktiv.png');
  await dark.page.click('#sw-scripting');
  ok(await titleIs(dark.page, 'Teilweise aktiv'), 'Dunkel: Skripte aus → „Teilweise aktiv“');
  await shot(dark.page, '6-dunkel-teilweise.png');
  await dark.page.click('#btn-theme'); // auto -> hell
  const themed = await dark.page.evaluate(() => document.documentElement.dataset.theme);
  ok(themed === 'light', 'Design-Knopf schaltet auf Hell, obwohl das iPhone dunkel ist');
  const scroll = await dark.page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
  ok(scroll, 'Kein seitliches Scrollen');
  ok(dark.errors.length === 0, `Keine JavaScript-Fehler (dunkel) ${dark.errors.join(' | ')}`);
  await dark.ctx.close();

  // --- Demo ---
  const demo = await newPage('light', { demo: true, key: '' });
  ok(await titleIs(demo.page, 'Schutz aktiv'), 'Demo-Modus funktioniert ohne Surge');
  await demo.ctx.close();

  await browser.close();
  appServer.close();
  surgeServer.close();
  console.log(fehler ? `\n${fehler} Fehler gefunden.` : '\nAlles in Ordnung.');
  process.exit(fehler ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
