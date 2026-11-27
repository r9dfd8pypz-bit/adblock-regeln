// Test: Video-Start (initplayback) und Schlüssel (config/log_event) – youtube.init.js, youtube.ump.js, youtube.response.js
// Aufruf: node tests/init-test.mjs
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';
import { createCipheriv, createDecipheriv, createHmac, randomBytes } from 'node:crypto';
import { gzipSync, gunzipSync } from 'node:zlib';

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
  // Antwort ohne Onesie-Teile (z. B. nur Medien): geht unverändert weiter
  const store = keyStore();
  const r = await run(UMP, { url: INIT_URL, respBody: [0x08, 0x04, 0x01, 0xff, 0xff, 0xff], store, argument: '{"captionLang":"off","lyricLang":"off"}' });
  const out = r.r && (r.r.body || r.r.bodyBytes);
  ok(!r.timeout && out && Buffer.from(out).equals(Buffer.from([0x08, 0x04, 0x01, 0xff, 0xff, 0xff])) && r.net.length === 0, 'UMP-Skript: Antwort ohne Onesie-Teile bleibt unverändert, kein Netzwerk');
  const st = JSON.parse(store.get('werbefrei.ump.stats'));
  ok(st.ohneOnesie === 1 && st.recent[0].types['8'] === 1, 'UMP-Zähler: „ohne Onesie“ mit Teil-Typen');
}
{
  // Sicherheitsnetz: Onesie-Antwort mit unbekanntem Kopf-Typ (kein Player-Teil 25) → leer statt Werbung, Schlüssel bleibt
  const store = keyStore();
  const r = await run(UMP, { url: INIT_URL, respBody: [10, 2, 8, 26, 11, 3, 1, 2, 3], store, argument: '{"captionLang":"off","lyricLang":"off"}' });
  ok(!r.timeout && r.r && r.r.status === 200 && (r.r.body || r.r.bodyBytes).byteLength === 0 && r.net.length === 0, 'Sicherheitsnetz: Onesie ohne bearbeitbaren Player-Teil → leere Antwort (Player-Weg, gefiltert)');
  ok(JSON.parse(store.get('YouTubeConfig')).youtube, 'Sicherheitsnetz: Schlüssel bleibt erhalten');
  const st = JSON.parse(store.get('werbefrei.ump.stats'));
  ok(st.ohnePlayer === 1 && st.recent[0].heads['26'] === 1 && st.recent[0].types['10'] === 1, 'UMP-Zähler: „ohne Player“ mit Onesie-Kopf-Typen');
  ok(!/\[1,2,3\]|"data"/.test(store.get('werbefrei.ump.stats')), 'UMP-Zähler enthalten keine Inhalte');
}
{
  // Player-Teil (Kopf-Typ 25), der sich nicht entschlüsseln lässt: leer + Schlüssel neu holen
  const store = keyStore();
  const r = await run(UMP, { url: INIT_URL, respBody: [10, 2, 8, 25, 11, 3, 1, 2, 3], store, argument: '{"captionLang":"off","lyricLang":"off"}' });
  ok(!r.timeout && r.r && r.r.status === 200 && (r.r.body || r.r.bodyBytes).byteLength === 0 && r.net.length === 0, 'UMP-Skript: unlesbarer Player-Teil → leere Antwort (Player-Weg), kein Netzwerk');
  ok(!JSON.parse(store.get('YouTubeConfig')).youtube, 'UMP-Skript löscht dabei den unpassenden Schlüssel');
  ok(JSON.parse(store.get('werbefrei.ump.stats')).fehler === 1, 'UMP-Zähler: „Fehler“ mit Meldung');
}

// --- youtube.ump.js mit nachgebauter, echt verschlüsselter Onesie-Antwort (AES-128-CTR + HMAC-SHA256) ---
const KEY32 = [...randomBytes(32)];
const umpVar = (v) => { // UMP-Längenformat (nicht protobuf)
  if (v < 0x80) return [v];
  if (v < 0x4000) return [0x80 | (v & 0x3f), v >> 6];
  if (v < 0x200000) return [0xc0 | (v & 0x1f), (v >> 5) & 0xff, v >> 13];
  return [0xe0 | (v & 0x0f), (v >> 4) & 0xff, (v >> 12) & 0xff, v >> 20];
};
const umpPart = (type, data) => [...umpVar(type), ...umpVar(data.length), ...data];
const vint = (nr, n) => [...varint(nr * 8), ...varint(n)];
function onesie(playerBytes, { gzip = true, comp = 1 } = {}) {
  const watch = f(4, f(2, playerBytes));                       // OnesieInnertubeResponse{4: Content{2: player}}
  const plain = gzip ? gzipSync(Buffer.from(watch)) : Buffer.from(watch);
  const iv = randomBytes(16);
  const c = createCipheriv('aes-128-ctr', Buffer.from(KEY32.slice(0, 16)), iv);
  const ct = Buffer.concat([c.update(plain), c.final()]);
  const mac = createHmac('sha256', Buffer.from(KEY32.slice(16))).update(Buffer.concat([ct, iv])).digest();
  const part = [...f(1, [...ct]), ...f(2, [...mac]), ...f(3, [...iv]), ...vint(4, comp)];
  return [...umpPart(10, [8, 25]), ...umpPart(11, part), ...umpPart(20, [1, 2, 3])];
}
function readOnesie(out) { // Antwort wieder auspacken: Klartext-Bytes des Player-Teils
  const b = Buffer.from(out); let p = 0; let header = -1; let data = null;
  const rv = () => { const e = b[p++]; let t = 1; while (t <= 5 && (e & (0x80 >> (t - 1)))) t++; let n = 8 - t; let v = t < 5 ? e & ((1 << n) - 1) : 0; if (t === 5) n = 0; for (let i = 1; i < t; i++) { v |= b[p++] << n; n += 8; } return v; };
  while (p < b.length) { const type = rv(); const len = rv(); const d = b.subarray(p, p + len); p += len; if (type === 10) header = d[1]; if (type === 11 && header === 25) data = d; }
  // EncryptedInnertubeResponsePart: 1 Inhalt, 2 hmac, 3 iv
  const fields = {}; let q = 0; const pv = () => { let v = 0; let m = 1; let c; do { c = data[q++]; v += (c & 127) * m; m *= 128; } while (c & 128); return v; };
  while (q < data.length) { const tag = pv(); const no = Math.floor(tag / 8); const wt = tag % 8; if (wt === 2) { const l = pv(); fields[no] = data.subarray(q, q + l); q += l; } else pv(); }
  const d = createDecipheriv('aes-128-ctr', Buffer.from(KEY32.slice(0, 16)), fields[3]);
  const plain = Buffer.concat([d.update(fields[1]), d.final()]);
  const mac = createHmac('sha256', Buffer.from(KEY32.slice(16))).update(Buffer.concat([fields[1], fields[3]])).digest();
  return { plain: plain[0] === 0x1f ? gunzipSync(plain) : plain, macOk: mac.equals(Buffer.from(fields[2])) };
}
// Inhalte in unbekannten Feldern (999), damit sie als Rohdaten erhalten bleiben
const playerMitWerbung = [...f(2, f(1, [0x08, 0x00])), ...f(7, f(999, [...Buffer.from('pagead-placement-'.repeat(20))])), ...f(68, f(999, [...Buffer.from('ad-slot-'.repeat(20))])), ...f(9, f(999, [...Buffer.from('tracking')]))];
for (const [name, opt] of [['gzip-gepackt', { gzip: true, comp: 1 }], ['ungepackt', { gzip: false, comp: 0 }]]) {
  const store = new Map([['YouTubeConfig', JSON.stringify({ youtube: { clientKey: b64(KEY32), encryptKey: b64(ENCRYPT) } })]]);
  const r = await run(UMP, { url: INIT_URL, respBody: onesie(playerMitWerbung, opt), store, argument: '{"captionLang":"off","lyricLang":"off"}' });
  const out = r.r && (r.r.body || r.r.bodyBytes);
  let res = null;
  try { res = readOnesie(out); } catch (e) { res = null; }
  const txt = res ? res.plain.toString('latin1') : '';
  ok(res && res.macOk && !txt.includes('pagead-placement') && !txt.includes('ad-slot') && txt.includes('tracking'), `UMP-Skript (${name}): Werbung aus dem verschlüsselten Video-Start entfernt, Prüfsumme stimmt`);
  ok(JSON.parse(store.get('werbefrei.ump.stats')).bearbeitet === 1 && r.net.length === 0, `UMP-Skript (${name}): Zähler „bearbeitet“, kein Netzwerk`);
}
{
  const store = new Map([['YouTubeConfig', JSON.stringify({ youtube: { clientKey: b64(KEY32), encryptKey: b64(ENCRYPT) } })]]);
  const r = await run(UMP, { url: INIT_URL, respBody: onesie(playerMitWerbung, { gzip: false, comp: 2 }).map((x, i, a) => x), store, argument: '{}' });
  // Brotli (2) mit ungepacktem Inhalt wird trotzdem gelesen; echte Brotli-Daten würden als Fehler enden (Sicherheitsnetz)
  ok(r.r && (r.r.body || r.r.bodyBytes), 'UMP-Skript: Kennzeichen „Brotli“ führt nicht zum Absturz');
}

console.log(fehler ? `\n${fehler} Fehler gefunden.` : '\nAlles in Ordnung.');
process.exit(fehler ? 1 : 0);
