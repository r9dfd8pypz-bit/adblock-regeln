// Test: Werbung im Feed (Shopping-Karussell, Video-Anzeige „Gesponsert · Temu“) wird entfernt, normale Videos bleiben.
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
// Startseite: Browse > Content > SingleColumn > Tab > TabRenderer > Content > SectionList > ItemSection > Einträge
const section = (items) => f(49399797, f(1, f(50195462, items.flat())));
const home = (items) => f(9, f(58173949, f(1, f(58174010, f(4, section(items))))));
const homeMore = (items) => f(10, section(items)); // Nachladen beim Scrollen
const next = (items) => f(7, f(51779735, f(1, f(49399797, f(1, f(50195462, items.flat()))))));

const organic = item('video_lockup.eml', f(999, s('Normales Video mit Titel und Kanal. '.repeat(40))));
const shopping = item('shopping_carousel_ad.eml', f(777, s('Produkt Lautsprecher DJ Controller '.repeat(10))),
  f(9, s(`https://www.googleadservices.com/pagead/aclk?sa=L&ai=${'x'.repeat(400)}`))); // Merkmal außerhalb des Inhalts
const unknownAd = f(1, f(888, s(`https://ad.doubleclick.net/ddm/clk/${'y'.repeat(400)}`))); // unbekannter Typ, klein

function run(bytes, store, endpoint = 'next') {
  return new Promise((resolve) => {
    const ctx = vm.createContext({
      console: { log() {}, error() {}, warn() {} },
      TextEncoder, TextDecoder,
      $argument: '{"captionLang":"off","blockUpload":true,"blockImmersive":true,"blockShorts":false,"debug":false}',
      $persistentStore: { read: (k) => store.get(k) ?? null, write: (v, k) => { store.set(k, v); return true; } },
      $notification: { post() {} },
      $httpClient: new Proxy({}, { get() { throw new Error('Netzwerk verboten'); } }),
      __bytes: bytes, __ep: endpoint,
    });
    vm.runInContext(`var $request = { url: 'https://youtubei.googleapis.com/youtubei/v1/' + __ep + '?prettyPrint=false', method: 'POST',
      headers: { 'User-Agent': 'com.google.ios.youtube/20.10.4 (iPhone16,2; U; CPU iOS 18_6 like Mac OS X)' } };
      var $response = { status: 200, headers: {}, body: new Uint8Array(__bytes) };`, ctx);
    ctx.$done = (r) => resolve(Buffer.from((r && (r.body || (r.response && r.response.body))) || new Uint8Array(bytes)).toString('latin1'));
    vm.runInContext(CODE, ctx);
  });
}
const has = (out, text) => out.includes(Buffer.from(text, 'utf8').toString('latin1'));

// 1. Frischer Speicher
{
  const out = await run(next([organic, shopping, unknownAd]), new Map());
  ok(has(out, 'video_lockup.eml'), 'Normales Video bleibt erhalten');
  ok(!has(out, 'shopping_carousel_ad.eml'), 'Shopping-Anzeige (Merkmal außerhalb des Inhalts) wird entfernt');
  ok(!has(out, 'ddm/clk'), 'Anzeige in unbekanntem Format (doubleclick) wird entfernt');
}

// 2. „Vergifteter“ Speicher aus der alten Fassung: Anzeigen als „keine Werbung“ gelernt
{
  const store = new Map([['YouTubeAdvertiseInfo', JSON.stringify({ version: '1.0', whiteNo: [888], blackNo: [], whiteEml: ['shopping_carousel_ad.eml'], blackEml: [] })]]);
  const out = await run(next([organic, shopping, unknownAd]), store);
  ok(!has(out, 'shopping_carousel_ad.eml') && !has(out, 'ddm/clk'), 'Alter Speicher mit falschen „keine Werbung“-Einträgen wird ignoriert');
  ok(has(out, 'video_lockup.eml'), 'Normales Video bleibt auch dann erhalten');
  const learned = JSON.parse(store.get('YouTubeAdvertiseInfo') || '{}');
  const ignored = learned.version === '1.0'; // alte Fassung: wird wegen neuer Versionskennung nicht mehr gelesen
  ok(ignored || (!(learned.whiteNo || []).length && !(learned.whiteEml || []).length), 'Es wird nichts als „keine Werbung“ gespeichert (alter Speicher bleibt unbeachtet)');
}

// 3. Gelernt wird nur „sicher Werbung“
{
  const store = new Map();
  const big = f(1, f(4242, s(`https://www.youtube.com/pagead/viewthroughconversion/${'z'.repeat(1200)}`))); // klassisch: pagead, >1000 Byte
  const out = await run(next([organic, big]), store);
  const learned = JSON.parse(store.get('YouTubeAdvertiseInfo') || '{}');
  ok(!has(out, 'viewthroughconversion') && has(out, 'video_lockup.eml'), 'Klassische Anzeige entfernt, Video bleibt');
  ok((learned.blackNo || []).includes(4242) && !(learned.whiteNo || []).length && !(learned.whiteEml || []).length, 'Gespeichert wird nur der sichere Werbe-Typ');
}

// 4. Video-Anzeige mit Kennzeichnung „Gesponsert · Temu“, ohne Werbeadresse (wie auf der Startseite)
{
  const temu = item('promoted_video_lockup.eml', [
    ...f(1, s('Jetzt bis zu 90 % sparen – Temu')),
    ...f(2, s('Gesponsert · Temu')),
    ...f(3, s('Zur Website')),
  ]);
  const temuEn = f(1, f(5151, [...f(4, s('Sponsored')), ...f(5, s('Shop now'))])); // unbekannter Typ, englische App
  const titelMitWort = item('video_lockup.eml', f(1, s('Warum ist so viel Gesponsert? Meine ehrliche Meinung')));
  const titelEnde = item('video_lockup.eml', f(1, s('Das ist nicht Gesponsert')));
  const store = new Map();
  const out = await run(next([organic, temu, temuEn, titelMitWort, titelEnde]), store);
  ok(!has(out, 'Gesponsert · Temu'), 'Video-Anzeige „Gesponsert · Temu“ wird entfernt');
  ok(!has(out, 'Shop now'), 'Anzeige mit „Sponsored“ (englische App) wird entfernt');
  ok(has(out, 'Warum ist so viel Gesponsert?') && has(out, 'Das ist nicht Gesponsert'), 'Videos mit „Gesponsert“ mitten im Titel bleiben');
  ok(has(out, 'video_lockup.eml|abc123'), 'Normales Video bleibt erhalten');

  // Protokoll für die App-Diagnose: nur Vorlagen-Namen, Größen und Treffer – keine Titel
  let diag = null;
  try { diag = JSON.parse(store.get('werbefrei.feed.diag') || 'null'); } catch { /* leer */ }
  const last = diag && diag.list && diag.list[0];
  ok(!!last && last.ep === 'next' && Array.isArray(last.items) && last.items.length === 5, 'Feed-Protokoll wird gespeichert (5 Einträge)');
  ok(!!last && last.items.filter((x) => x.x).length === 2 && last.items.some((x) => x.n === 'promoted_video_lockup.eml' && x.x && x.g > 0), 'Protokoll nennt die entfernten Anzeigen');
  ok(!!last && (last.rm || []).length === 0 && last.rg === 0, 'Nach dem Filtern ist keine Werbe-Kennzeichnung mehr in der Antwort');
  const raw = store.get('werbefrei.feed.diag') || '';
  ok(!/Temu|Warum|Meinung|sparen|Normales Video/.test(raw), 'Protokoll enthält keine Titel oder Texte');
}

// 5. Startseite (browse) – auch beim Nachladen
{
  const temu = item('promoted_video_lockup.eml', [...f(2, s('Gesponsert · Temu')), ...f(3, s('Ansehen'))]);
  const out1 = await run(home([organic, temu, organic]), new Map(), 'browse');
  ok(!has(out1, 'Gesponsert · Temu') && has(out1, 'video_lockup.eml'), 'Startseite: Anzeige entfernt, Videos bleiben');
  const out2 = await run(homeMore([organic, temu]), new Map(), 'browse');
  ok(!has(out2, 'Gesponsert · Temu') && has(out2, 'video_lockup.eml'), 'Startseite beim Scrollen: Anzeige entfernt, Videos bleiben');
}

// 6. Protokoll behält nur die letzten 4 Antworten
{
  const store = new Map();
  for (let i = 0; i < 6; i++) await run(next([organic]), store);
  const diag = JSON.parse(store.get('werbefrei.feed.diag') || '{}');
  ok(Array.isArray(diag.list) && diag.list.length === 4, 'Protokoll bleibt klein (letzte 4 Antworten)');
}

console.log(fehler ? `\n${fehler} Fehler gefunden.` : '\nAlles in Ordnung.');
process.exit(fehler ? 1 : 0);
