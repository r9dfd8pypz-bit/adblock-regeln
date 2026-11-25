// Test: Video-Start (initplayback) und Schlüssel (config/log_event) – youtube.init.js, youtube.ump.js, youtube.response.js
// Aufruf: node tests/init-test.mjs
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const INIT = readFileSync(join(ROOT, 'scripts/youtube/youtube.init.js'), 'utf8');
const UMP = readFileSync(join(ROOT, 'scripts/youtube/youtube.ump.js'), 'utf8');
const RESP = readFileSync(join(ROOT, 'scripts/youtube/youtube.response.js'), 'utf8');

let fehler = 0;
const ok = (c, t) => { console.log(`${c ? 'OK    ' : 'FEHLER'} ${t}`); if (!c) fehler++; };

const varint = (n) => { const o = []; while (n > 127) { o.push((n % 128) + 128); n = Math.floor(n / 128); } o.push(n); return o; };
const f = (nr, bytes) => [...varint(nr * 8 + 2), ...varint(bytes.length), ...bytes];
const UA_YT = 'com.google.ios.youtube/21.46.3 (iPhone16,2; U; CPU iOS 18_6 like Mac OS X)';
const UA_MUSIC = 'com.google.ios.youtubemusic/8.46 (iPhone16,2; U; CPU iOS 18_6 like Mac OS X)';
const INIT_URL = 'https://rr3---sn-abc.googlevideo.com/initplayback?source=youtube&oeis=1&c=IOS&ack=1&pot=x';
const LOG_URL = 'https://youtubei.googleapis.com/youtubei/v1/log_event?alt=json';
const CLIENT = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16];
const ENCRYPT = [200, 201, 202, 203, 204, 205, 206, 207, 208, 209, 210, 211, 212, 213, 214, 215, 216, 217, 218, 219];
const b64 = (a) => Buffer.from(a).toString('base64');

// Führt ein Skript in einer nachgebauten Surge-Umgebung aus
function run(code, { url, ua = UA_YT, reqBody, respBody, store = new Map(), headers = {}, argument } = {}) {
  return new Promise((resolve) => {
    const net = [];
    const notes = [];
    const ctx = vm.createContext({
      console: { log() {}, error() {}, warn() {} }, TextEncoder, TextDecoder, setTimeout, clearTimeout,
      $argument: argument,
      $persistentStore: { read: (k) => store.get(k) ?? null, write: (v, k) => { store.set(k, v); return true; } },
      $notification: { post: (...a) => notes.push(a) },
      $httpClient: { get: (o) => net.push(o), post: (o) => net.push(o) },
      __req: reqBody, __resp: respBody, __h: { 'User-Agent': ua, ...headers },
    });
    vm.runInContext(`var $request = { url: ${JSON.stringify(url)}, method: 'POST', headers: __h, body: __req ? new Uint8Array(__req) : undefined };
      ${respBody ? 'var $response = { status: 200, headers: {}, body: new Uint8Array(__resp) };' : ''}`, ctx);
    let done = false;
    ctx.$done = (r) => { if (done) return; done = true; setTimeout(() => resolve({ r: r || {}, net, notes, store }), 10); };
    vm.runInContext(code, ctx);
    setTimeout(() => { if (!done) resolve({ r: null, net, notes, store, timeout: true }); }, 3000);
  });
}
const keyStore = (platform = 'youtube') => new Map([['YouTubeConfig', JSON.stringify({ [platform]: { clientKey: b64(CLIENT), encryptKey: b64(ENCRYPT) } })]]);
const initBody = (key) => [...f(1, [8, 1]), ...f(3, [...f(2, [9, 9, 9]), ...f(5, key), ...f(6, [7, 7])])];

// --- youtube.init.js: log_event ---
{
  const r = await run(INIT, { url: LOG_URL, headers: { 'X-Youtube-Hot-Hash-Data': 'abc', 'Content-Encoding': 'gzip', 'Content-Type': 'application/x-protobuf' } });
  const h = r.r.headers || {};
  ok(h['Content-Type'] === 'application/x-protobuf' && !('X-Youtube-Hot-Hash-Data' in h) && !('Content-Encoding' in h), 'log_event ohne Schlüssel: hot-hash und content-encoding fallen weg, Rest bleibt');
  ok(JSON.parse(r.store.get('werbefrei.init.stats')).schluesselHolen === 1 && r.net.length === 0, 'log_event: zählt mit, kein Netzwerk');
}
{
  const r = await run(INIT, { url: LOG_URL, store: keyStore(), headers: { 'X-Youtube-Hot-Hash-Data': 'abc' } });
  ok(JSON.stringify(r.r) === '{}', 'log_event mit Schlüssel: unverändert');
}

// --- youtube.init.js: initplayback ---
{
  const store = keyStore();
  const r = await run(INIT, { url: INIT_URL, reqBody: initBody(ENCRYPT), store });
  ok(JSON.stringify(r.r) === '{}', 'initplayback mit passendem Schlüssel: geht unverändert durch');
  ok(JSON.parse(store.get('YouTubeConfig')).youtube.clientKey === b64(CLIENT), 'Schlüssel bleibt gespeichert');
  ok(JSON.parse(store.get('werbefrei.init.stats')).durchgelassen === 1, 'Zähler „durchgelassen“');
}
{
  const store = keyStore();
  const r = await run(INIT, { url: INIT_URL, reqBody: initBody([1, 1, 1]), store });
  ok(r.r.response && r.r.response.status === 200 && r.r.response.body.length === 0, 'initplayback mit anderem Schlüssel: leere Antwort (App nimmt den Player-Weg)');
  ok(!JSON.parse(store.get('YouTubeConfig')).youtube, 'Falscher Schlüssel wird gelöscht und neu geholt');
}
{
  const r = await run(INIT, { url: INIT_URL, reqBody: initBody(ENCRYPT) });
  ok(r.r.response && r.r.response.status === 200, 'initplayback ohne gespeicherten Schlüssel: leere Antwort');
  ok(JSON.parse(r.store.get('werbefrei.init.stats')).ausgewichen === 1, 'Zähler „ausgewichen“');
}
{
  const r = await run(INIT, { url: INIT_URL, ua: UA_MUSIC, reqBody: initBody(ENCRYPT), store: keyStore('youtubeMusic') });
  ok(JSON.stringify(r.r) === '{}', 'YouTube Music nutzt seinen eigenen Schlüssel');
}

// --- youtube.response.js speichert den Schlüssel aus config, den youtube.init.js dann erkennt ---
{
  const onesie = f(146311580, [...f(1, CLIENT), ...f(2, ENCRYPT)]);
  const config = f(1, f(16, f(7, f(138536474, onesie))));
  const store = new Map();
  await run(RESP, { url: 'https://youtubei.googleapis.com/youtubei/v1/config?alt=proto', respBody: config, store,
    argument: '{"captionLang":"off","blockUpload":true,"blockImmersive":true,"blockShorts":false,"debug":false}' });
  const cfg = JSON.parse(store.get('YouTubeConfig') || '{}');
  ok(cfg.youtube && cfg.youtube.clientKey === b64(CLIENT) && cfg.youtube.encryptKey === b64(ENCRYPT), 'youtube.response.js merkt sich den Schlüssel aus config');
  const r = await run(INIT, { url: INIT_URL, reqBody: initBody(ENCRYPT), store });
  ok(JSON.stringify(r.r) === '{}', 'Danach lässt youtube.init.js den Video-Start durch');
}

// --- youtube.ump.js: sicheres Verhalten ---
{
  const r = await run(UMP, { url: INIT_URL, respBody: [1, 2, 3, 4], argument: '{"captionLang":"off","lyricLang":"off"}' });
  const res = r.r;
  ok(!r.timeout && res && res.status === 200 && (res.body || res.bodyBytes) && (res.body || res.bodyBytes).byteLength === 0, 'UMP-Skript ohne Schlüssel: leere Antwort statt Absturz');
  ok(r.net.length === 0 && r.notes.length === 0, 'UMP-Skript: kein Netzwerk, keine Mitteilung');
}
{
  // Antwort ohne verschlüsselten Player-Teil: geht unverändert weiter
  const r = await run(UMP, { url: INIT_URL, respBody: [0x08, 0x04, 0x01, 0xff, 0xff, 0xff], store: keyStore(), argument: '{"captionLang":"off","lyricLang":"off"}' });
  const out = r.r && (r.r.body || r.r.bodyBytes);
  ok(!r.timeout && out && Buffer.from(out).equals(Buffer.from([0x08, 0x04, 0x01, 0xff, 0xff, 0xff])) && r.net.length === 0, 'UMP-Skript: Antwort ohne Player-Teil bleibt unverändert, kein Netzwerk');
}
{
  // Player-Teil (UMP-Teil 10 mit Typ 25, danach Teil 11), der sich nicht entschlüsseln lässt: leer + Schlüssel neu holen
  const store = keyStore();
  const r = await run(UMP, { url: INIT_URL, respBody: [10, 2, 8, 25, 11, 3, 1, 2, 3], store, argument: '{"captionLang":"off","lyricLang":"off"}' });
  ok(!r.timeout && r.r && r.r.status === 200 && (r.r.body || r.r.bodyBytes).byteLength === 0 && r.net.length === 0, 'UMP-Skript: unlesbarer Player-Teil → leere Antwort (Player-Weg), kein Netzwerk');
  ok(!JSON.parse(store.get('YouTubeConfig')).youtube, 'UMP-Skript löscht dabei den unpassenden Schlüssel');
}

console.log(fehler ? `\n${fehler} Fehler gefunden.` : '\nAlles in Ordnung.');
process.exit(fehler ? 1 : 0);
