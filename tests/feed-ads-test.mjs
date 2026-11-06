// Test: Werbung im Feed unter dem Video (z. B. Shopping-Karussell) wird entfernt, normale Videos bleiben.
// Aufruf: node tests/feed-ads-test.mjs [pfad/zum/skript.js]   (Standard: scripts/youtube/youtube.response.js)
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SCRIPT = process.argv[2] || join(ROOT, 'scripts/youtube/youtube.response.js');
const CODE = readFileSync(SCRIPT, 'utf8');

let fehler = 0;
const ok = (c, t) => { console.log(`${c ? 'OK    ' : 'FEHLER'} ${t}`); if (!c) fehler++; };

// protobuf-Helfer (Feldnummern bis 2^32, daher ohne Bit-Operatoren)
const varint = (n) => { const o = []; while (n > 127) { o.push((n % 128) + 128); n = Math.floor(n / 128); } o.push(n); return o; };
const f = (nr, bytes) => [...varint(nr * 8 + 2), ...varint(bytes.length), ...bytes];
const s = (t) => [...Buffer.from(t, 'utf8')];

// Aufbau wie in der YouTube-App: Next > Content > NextResult > Content > SectionList > ItemSection > Einträge
const item = (template, videoContent, extra = []) => f(1, f(153515154, f(172660663, [
  ...f(1, f(168777401, f(5, videoContent))),          // videoInfo > videoContext > videoContent
  ...f(2, f(183314536, f(1, s(`${template}|abc123`)))), // renderInfo > layoutRender > eml
  ...extra,
])));
const organic = item('video_lockup.eml', f(999, s('Normales Video mit Titel und Kanal. '.repeat(40))));
const shopping = item('shopping_carousel_ad.eml', f(777, s('Produkt Lautsprecher DJ Controller '.repeat(10))),
  f(9, s(`https://www.googleadservices.com/pagead/aclk?sa=L&ai=${'x'.repeat(400)}`))); // Merkmal außerhalb des Inhalts
const unknownAd = f(1, f(888, s(`https://ad.doubleclick.net/ddm/clk/${'y'.repeat(400)}`))); // unbekannter Typ, klein
const response = f(7, f(51779735, f(1, f(49399797, f(1, f(50195462, [...organic, ...shopping, ...unknownAd]))))));

function run(store) {
  return new Promise((resolve) => {
    const ctx = vm.createContext({
      console: { log() {}, error() {}, warn() {} },
      TextEncoder, TextDecoder,
      $argument: '{"captionLang":"off","blockUpload":true,"blockImmersive":true,"blockShorts":false,"debug":false}',
      $persistentStore: { read: (k) => store.get(k) ?? null, write: (v, k) => { store.set(k, v); return true; } },
      $notification: { post() {} },
      $httpClient: new Proxy({}, { get() { throw new Error('Netzwerk verboten'); } }),
      __bytes: response,
    });
    vm.runInContext(`var $request = { url: 'https://youtubei.googleapis.com/youtubei/v1/next?prettyPrint=false', method: 'POST',
      headers: { 'User-Agent': 'com.google.ios.youtube/20.10.4 (iPhone16,2; U; CPU iOS 18_6 like Mac OS X)' } };
      var $response = { status: 200, headers: {}, body: new Uint8Array(__bytes) };`, ctx);
    ctx.$done = (r) => resolve(Buffer.from((r && (r.body || (r.response && r.response.body))) || new Uint8Array(response)).toString('latin1'));
    vm.runInContext(CODE, ctx);
  });
}

// 1. Frischer Speicher
{
  const out = await run(new Map());
  ok(out.includes('video_lockup.eml'), 'Normales Video bleibt erhalten');
  ok(!out.includes('shopping_carousel_ad.eml'), 'Shopping-Anzeige (Merkmal außerhalb des Inhalts) wird entfernt');
  ok(!out.includes('ddm/clk'), 'Anzeige in unbekanntem Format (doubleclick) wird entfernt');
}

// 2. „Vergifteter“ Speicher aus der alten Fassung: Anzeigen als „keine Werbung“ gelernt
{
  const store = new Map([['YouTubeAdvertiseInfo', JSON.stringify({ version: '1.0', whiteNo: [888], blackNo: [], whiteEml: ['shopping_carousel_ad.eml'], blackEml: [] })]]);
  const out = await run(store);
  ok(!out.includes('shopping_carousel_ad.eml') && !out.includes('ddm/clk'), 'Alter Speicher mit falschen „keine Werbung“-Einträgen wird ignoriert');
  ok(out.includes('video_lockup.eml'), 'Normales Video bleibt auch dann erhalten');
  const learned = JSON.parse(store.get('YouTubeAdvertiseInfo') || '{}');
  const ignored = learned.version === '1.0'; // alte Fassung: wird wegen neuer Versionskennung nicht mehr gelesen
  ok(ignored || (!(learned.whiteNo || []).length && !(learned.whiteEml || []).length), 'Es wird nichts als „keine Werbung“ gespeichert (alter Speicher bleibt unbeachtet)');
}

// 3. Gelernt wird nur „sicher Werbung“
{
  const store = new Map();
  const big = f(1, f(4242, s(`https://www.youtube.com/pagead/viewthroughconversion/${'z'.repeat(1200)}`))); // klassisch: pagead, >1000 Byte
  const resp2 = f(7, f(51779735, f(1, f(49399797, f(1, f(50195462, [...organic, ...big]))))));
  response.splice(0, response.length, ...resp2);
  const out = await run(store);
  const learned = JSON.parse(store.get('YouTubeAdvertiseInfo') || '{}');
  ok(!out.includes('viewthroughconversion') && out.includes('video_lockup.eml'), 'Klassische Anzeige entfernt, Video bleibt');
  ok((learned.blackNo || []).includes(4242) && !(learned.whiteNo || []).length && !(learned.whiteEml || []).length, 'Gespeichert wird nur der sichere Werbe-Typ');
}

console.log(fehler ? `\n${fehler} Fehler gefunden.` : '\nAlles in Ordnung.');
process.exit(fehler ? 1 : 0);
