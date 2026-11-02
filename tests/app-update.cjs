// Prüft, ob eine neue App-Version beim Nutzer ankommt, obwohl der Server Dateien
// wie GitHub Pages 10 Minuten zwischenspeichern lässt (Cache-Control: max-age=600).
// Aufruf: node tests/app-update.cjs <ordner-alte-version> <ordner-neue-version> <prüf-selector-neu>
'use strict';

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

const [OLD_DIR, NEW_DIR, NEW_SELECTOR] = process.argv.slice(2);
let serveDir = OLD_DIR;
const TYPES = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };

const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p.endsWith('/')) p += 'index.html';
  const file = path.join(serveDir, p);
  if (!fs.existsSync(file)) { res.writeHead(404); res.end(); return; }
  const body = fs.readFileSync(file);
  const etag = `"${require('node:crypto').createHash('md5').update(body).digest('hex')}"`;
  if (req.headers['if-none-match'] === etag) { res.writeHead(304, { ETag: etag, 'Cache-Control': 'max-age=600' }); res.end(); return; }
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'max-age=600', ETag: etag });
  res.end(body);
});

(async () => {
  await new Promise((r) => server.listen(8771, 'localhost', r));
  const url = 'http://localhost:8771/';
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await ctx.addInitScript(() => { try { localStorage.setItem('wf.settings', JSON.stringify({ demo: true })); } catch {} });
  const page = await ctx.newPage();

  // Alte Version installieren
  await page.goto(url);
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload();
  await page.waitForTimeout(500);

  // Neue Version auf den Server
  serveDir = NEW_DIR;
  // Die App lädt sich bei einem Update selbst neu; dann kurz warten und nochmal schauen.
  const isNew = async () => {
    for (let t = 0; t < 3; t++) {
      try {
        await page.waitForLoadState('load');
        return await page.evaluate((sel) => !!document.querySelector(sel), NEW_SELECTOR);
      } catch { await page.waitForTimeout(800); }
    }
    return false;
  };

  let seenAt = 0;
  for (let i = 1; i <= 3 && !seenAt; i++) {
    await page.goto(url);            // App öffnen
    await page.waitForTimeout(2500); // kurz warten wie der Nutzer
    if (await isNew()) seenAt = i;
  }
  console.log(seenAt ? `OK     Neue Version sichtbar beim ${seenAt}. Öffnen` : 'FEHLER Neue Version nach 3x Öffnen nicht sichtbar');
  await browser.close();
  server.close();
  process.exit(seenAt ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
