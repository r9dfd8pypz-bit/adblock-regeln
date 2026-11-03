// Ende-zu-Ende-Test der Werbefrei-Zentrale gegen eine nachgebaute Surge-Schnittstelle.
// Braucht Playwright mit Chromium. Aufruf: node tests/app-e2e.cjs [ordner-für-bildschirmfotos]
'use strict';

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
const vm = require('node:vm');

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
const surge = { enabled: [MODULE], available: [MODULE, 'Anderes Modul'], mitm: true, scripting: true, calls: [], notes: [],
  store: new Map([
    ['werbefrei.sponsor.status', JSON.stringify({ t: Date.now(), step: 'keine-daten', text: 'Für dieses Video ist nichts eingetragen' })],
    ['werbefrei.sponsor.segments', JSON.stringify({ id: 'abc', t: Date.now(), segs: [{ start: 73, end: 126.4, category: 'sponsor' }] })],
    ['werbefrei.sponsor.pos', JSON.stringify({ id: 'abc', cmt: 80.2, t: Date.now() - 5000 })],
  ]) };
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
    if (url === '/v1/external_resources/update') {
      surge.resourceUpdates = (surge.resourceUpdates || 0) + 1;
      return send({ 'https://raw.githubusercontent.com/x/sponsor-hinweise.js': 'success' });
    }
    if (url === '/v1/scripting/evaluate') {
      // Skript wirklich ausführen, mit nachgebautem Speicher und Mitteilungen
      vm.runInNewContext(data.script_text, {
        $persistentStore: { read: (k) => surge.store.get(k) ?? null, write: (v, k) => { surge.store.set(k, v); return true; } },
        $notification: { post: (...a) => surge.notes.push(a) },
        $done: (r) => send({ result: r ?? null, output: '' }),
      });
      return undefined;
    }
    if (url === '/v1/requests/recent') {
      return send({ requests: [
        { URL: 'youtubei.googleapis.com:443', modified: false, notes: ['[MITM] skipped'], rule: 'FINAL', policyName: 'DIRECT' },
        { URL: 'https://youtubei.googleapis.com/youtubei/v1/browse?key=geheim', modified: true, notes: ['[Script] youtube.response done'], rule: 'FINAL', policyName: 'DIRECT' },
        { URL: 'https://rr3---sn-x.googlevideo.com/initplayback?source=youtube&ack=1', modified: true, notes: [], rule: 'FINAL', policyName: 'DIRECT' },
        { URL: 'https://www.apple.com/', modified: false, notes: [], rule: 'FINAL', policyName: 'DIRECT' },
      ] });
    }
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

  // Sponsor-Hinweise: erst nicht installiert, dann installiert und einschaltbar
  ok(await page.isVisible('#sponsor-install') && !(await page.isVisible('#sw-sponsor')), 'Sponsor-Modul fehlt: Knopf „Installieren“ statt Schalter');
  surge.available.push('YouTube Sponsor-Hinweise');
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await page.waitForSelector('#sw-sponsor:not([hidden])');
  ok(!(await page.isVisible('#sponsor-install')), 'Nach dem Installieren erscheint der Schalter');
  await page.click('#sw-sponsor');
  await page.waitForFunction(() => document.getElementById('sw-sponsor').getAttribute('aria-checked') === 'true');
  ok(surge.enabled.includes('YouTube Sponsor-Hinweise'), 'Schalter schaltet das Sponsor-Modul in Surge ein');
  ok(await titleIs(page, 'Schutz aktiv'), 'Status bleibt „Schutz aktiv“');
  await page.waitForFunction(() => /^Zuletzt \d\d:\d\d: Für dieses Video ist nichts eingetragen$/.test(document.getElementById('sponsor-sub').textContent));
  ok(true, 'Zeile zeigt, was beim letzten Video passiert ist');

  // Sponsor-Hinweise prüfen
  await page.click('[data-action="sponsor"]');
  ok(await page.isVisible('#dlg-sponsor'), 'Prüf-Seite für Sponsor-Hinweise öffnet sich');
  await page.waitForFunction(() => document.getElementById('sp-module').textContent === 'an');
  ok((await page.textContent('#sp-last')).includes('nichts eingetragen'), 'Prüf-Seite zeigt das letzte Ergebnis');
  ok(await page.textContent('#sp-segs') === '1:13–2:06', 'Prüf-Seite zeigt die Stellen im Video');
  ok(/^Zuletzt bei 1:20 im Video, vor [3-9] s$/.test(await page.textContent('#sp-pos')), `Prüf-Seite zeigt die letzte Position: ${await page.textContent('#sp-pos')}`);
  await page.click('label[for="sp-debug"]');
  await page.waitForFunction(() => true);
  await page.waitForTimeout(300);
  ok(surge.store.get('werbefrei.sponsor.debug') === 'true', 'Testmodus lässt sich in der App einschalten');
  await page.click('#btn-sp-test');
  await page.waitForTimeout(300);
  ok(surge.notes.length === 1 && surge.notes[0][1] === 'Testmitteilung', 'Testmitteilung wird über Surge verschickt');
  const reloadsBefore = surge.calls.filter((c) => c.startsWith('POST /v1/profiles/reload')).length;
  await page.click('#btn-sp-update');
  await page.waitForFunction(() => document.getElementById('balloon-title').textContent === 'Skript neu geladen');
  ok(surge.resourceUpdates === 1, '„Skript neu laden“ lässt Surge Module und Skripte neu herunterladen');
  ok(surge.calls.filter((c) => c.startsWith('POST /v1/profiles/reload')).length === reloadsBefore + 1, 'Danach lädt Surge das Profil neu');
  await shot(page, '9-hell-sponsor.png');
  await page.click('#dlg-sponsor [data-close]');

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
  ok(url === 'surge:///stop', `NOTAUS ruft ${url} auf`);

  // Surge aus: Server stoppen
  await new Promise((r) => surgeServer.close(r));
  surgeServer.closeAllConnections?.();
  ok(await titleIs(page, 'Surge ist aus'), 'Surge nicht erreichbar: „Surge ist aus“');
  ok(await page.getAttribute('#sw-module', 'disabled') !== null, 'Filterschalter sind gesperrt, solange Surge aus ist');
  await page.click('#sw-surge');
  ok(await page.evaluate(() => window.__letzteExterneUrl) === 'surge:///start', 'Hauptschalter startet Surge über surge:///start');
  surgeServer = http.createServer(surgeHandler);
  await listen(surgeServer, 6171, '127.0.0.1');
  ok(await titleIs(page, 'Schutz aktiv'), 'Nach dem Start wieder „Schutz aktiv“');

  // YouTube-Diagnose (Zeile öffnet das Blatt und prüft sofort)
  await page.click('[data-action="diag"]');
  ok(await page.isVisible('#dlg-diag'), 'Diagnose öffnet sich als eigenes Blatt');
  await page.waitForFunction(() => /Ergebnis:/.test(document.getElementById('diag-out').textContent), null, { timeout: 8000 });
  const diag = await page.textContent('#diag-out');
  ok(diag.includes('YouTube-API: 2 · entschlüsselt: 1 · vom Skript verändert: 1'), 'Diagnose zählt YouTube-Anfragen richtig');
  ok(diag.includes('initplayback: 1 · davon lokal beantwortet: 1'), 'Diagnose erkennt lokal beantwortetes initplayback');
  ok(diag.includes('Ergebnis: Entschlüsselung und Skript laufen.'), 'Diagnose gibt ein klares Ergebnis');
  ok(!diag.includes('geheim'), 'Diagnose-Bericht enthält keine Abfrage-Parameter');
  ok(await page.isEnabled('#btn-diag-copy'), 'Bericht kann kopiert werden');
  await shot(page, '8-hell-diagnose.png');
  await page.click('#dlg-diag [data-close]');

  // Verlauf
  await page.click('[data-action="log"]');
  ok(await page.isVisible('#dlg-log'), 'Verlauf öffnet sich als eigenes Blatt');
  ok((await page.textContent('#log')).includes('Diagnose:'), 'Verlauf enthält die letzten Aktionen');
  await page.click('#dlg-log [data-close]');

  // Einstellungen
  await page.click('[data-action="settings"]');
  ok(await page.isVisible('#dlg-settings'), 'Einstellungen öffnen sich');
  const lines = await page.textContent('#f-lines');
  ok(lines === `http-api = ${KEY}@127.0.0.1:6171\nhttp-api-tls = false`, 'Zeilen fürs Surge-Profil stimmen');
  await shot(page, '4-hell-einstellungen.png');
  await page.click('#dlg-settings [data-close]');
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
  const [probePage] = await Promise.all([
    fresh.ctx.waitForEvent('page'),
    fresh.page.click('.step[data-step="verbinden"] [data-setup="probe"]'),
  ]);
  ok(probePage.url() === `http://127.0.0.1:6171/v1/modules?x-key=${genKey}`, '„Im Browser prüfen“ öffnet die Schnittstelle mit Schlüssel');
  await probePage.close();
  await fresh.page.click('.step[data-step="nextdns-konto"] .step-check');
  ok(await fresh.page.textContent('#setup-progress') === '1 von 9 Schritten erledigt', 'Abhaken zählt den Fortschritt');
  await shot(fresh.page, '7-hell-einrichtung.png');
  await fresh.page.reload();
  await fresh.page.click('[data-action="setup"]');
  ok(await fresh.page.textContent('#setup-progress') === '1 von 9 Schritten erledigt', 'Fortschritt bleibt nach Neustart erhalten');
  ok(await fresh.page.inputValue('#s-nextdns') === 'abc123', 'NextDNS-ID bleibt gespeichert');
  ok(fresh.errors.length === 0, `Keine JavaScript-Fehler (Einrichtung) ${fresh.errors.join(' | ')}`);
  await fresh.ctx.close();

  // --- Dunkel ---
  const dark = await newPage('dark');
  ok(await titleIs(dark.page, 'Schutz aktiv'), 'Dunkelmodus: verbunden');
  const bg = await dark.page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  ok(bg === 'rgb(0, 0, 0)', `Dunkler Hintergrund wie iOS (${bg})`);
  await shot(dark.page, '5-dunkel-aktiv.png');
  await dark.page.click('#sw-scripting');
  ok(await titleIs(dark.page, 'Teilweise aktiv'), 'Dunkel: Skripte aus → „Teilweise aktiv“');
  await shot(dark.page, '6-dunkel-teilweise.png');
  await dark.page.click('[data-action="settings"]');
  await dark.page.click('[data-theme-choice="light"]');
  const themed = await dark.page.evaluate(() => document.documentElement.dataset.theme);
  ok(themed === 'light', 'Design lässt sich auf Hell stellen, obwohl das iPhone dunkel ist');
  ok(await dark.page.getAttribute('[data-theme-choice="light"]', 'aria-pressed') === 'true', 'Gewähltes Design ist markiert');
  await dark.page.click('[data-theme-choice="auto"]');
  await dark.page.click('#dlg-settings [data-close]');
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
