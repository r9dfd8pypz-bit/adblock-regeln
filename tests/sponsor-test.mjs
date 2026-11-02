// Test für scripts/youtube/sponsor-hinweise.js mit nachgebauten Surge-Funktionen.
// Aufruf: node tests/sponsor-test.mjs
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CODE = readFileSync(join(ROOT, 'scripts/youtube/sponsor-hinweise.js'), 'utf8');

let fehler = 0;
const ok = (c, t) => { console.log(`${c ? 'OK    ' : 'FEHLER'} ${t}`); if (!c) fehler++; };

// protobuf-Helfer
const varint = (n) => { const o = []; while (n > 0x7f) { o.push((n & 0x7f) | 0x80); n >>>= 7; } o.push(n); return o; };
const field = (nr, bytes) => [...varint((nr << 3) | 2), ...varint(bytes.length), ...bytes];
const str = (s) => [...Buffer.from(s, 'utf8')];
const nextRequest = (id) => [
  ...field(1, [...field(1, [...field(16, str('IOS')), ...field(17, str('20.10.4'))])]), // context
  ...field(2, str(id)),                                                               // videoId
  ...field(3, str('CAE%3D')),                                                         // params
];

function run({ url = 'https://youtubei.googleapis.com/youtubei/v1/next?prettyPrint=false', body, reply, store = new Map(), argument }) {
  return new Promise((resolve) => {
    const notes = [];
    const calls = [];
    let doneCount = 0;
    const ctx = vm.createContext({
      console, setTimeout, clearTimeout,
      $argument: argument,
      $persistentStore: { read: (k) => store.get(k) ?? null, write: (v, k) => { store.set(k, v); return true; } },
      $notification: { post: (...a) => notes.push(a) },
      $httpClient: { get: (opts, cb) => { calls.push(opts); if (reply) setTimeout(() => reply(cb, opts), 5); } },
      __body: body,
    });
    vm.runInContext(`var $request = { url: ${JSON.stringify(url)}, method: 'POST', headers: {}, body: __body ? new Uint8Array(__body) : undefined };`, ctx);
    ctx.$done = (r) => { doneCount++; setTimeout(() => resolve({ notes, calls, doneCount, result: r, store }), 20); };
    vm.runInContext(CODE, ctx);
  });
}

const ID = 'Cg1fvhYXapI';
const prefix = createHash('sha256').update(ID).digest('hex').slice(0, 4);
const sponsorData = JSON.stringify([
  { videoID: 'anderesVid1', segments: [{ category: 'sponsor', actionType: 'skip', segment: [1, 50] }] },
  { videoID: ID, segments: [
    { category: 'sponsor', actionType: 'skip', segment: [72.5, 125.2] },
    { category: 'sponsor', actionType: 'skip', segment: [120.0, 126.4] },   // überlappt -> zusammenfassen
    { category: 'selfpromo', actionType: 'skip', segment: [3600, 3630] },
    { category: 'interaction', actionType: 'skip', segment: [400, 405] },   // standardmäßig aus
    { category: 'sponsor', actionType: 'mute', segment: [500, 510] },       // kein Überspringen
  ] },
]);

// 1. Normalfall
{
  const r = await run({ body: nextRequest(ID), reply: (cb) => cb(null, { status: 200 }, sponsorData) });
  ok(r.calls.length === 1, 'Fragt SponsorBlock genau einmal');
  const u = r.calls[0] && r.calls[0].url;
  ok(u && u.startsWith(`https://sponsor.ajay.app/api/skipSegments/${prefix}?`), `Sendet nur den Hash-Anfang (${prefix}), nicht die Video-Kennung`);
  ok(u && !u.includes(ID), 'Video-Kennung verlässt das iPhone nicht');
  ok(u && decodeURIComponent(u).includes('categories=["sponsor","selfpromo"]'), 'Fragt nur die eingeschalteten Kategorien ab');
  ok(r.notes.length === 2, `Zwei Mitteilungen (Sponsor + Eigenwerbung), bekommen: ${r.notes.length}`);
  const [t1, , b1, o1] = r.notes[0] || [];
  ok(t1 === '⏭ Sponsor bei 1:13', `Titel: ${t1}`);
  ok(b1 === '1:13–2:06 (54 s) · Tippen = weiter bei 2:06', `Text: ${b1}`);
  ok(o1 && o1.action === 'open-url' && o1.url === `youtube://www.youtube.com/watch?v=${ID}&t=127s`, `Sprung-Link: ${o1 && o1.url}`);
  const [t2] = r.notes[1] || [];
  ok(t2 === '⏭ Eigenwerbung bei 1:00:00', `Lange Videos mit Stunden: ${t2}`);
  ok(r.doneCount === 1 && r.result && Object.keys(r.result).length === 0, 'Anfrage an YouTube bleibt unverändert, $done genau einmal');

  // 2. Gleiches Video nochmal (z. B. nach dem Sprung): keine doppelte Mitteilung
  const again = await run({ body: nextRequest(ID), reply: (cb) => cb(null, { status: 200 }, sponsorData), store: r.store });
  ok(again.calls.length === 0 && again.notes.length === 0, 'Keine doppelte Mitteilung beim Zurückspringen');
}

// 3. Kennung aus der Adresse
{
  const r = await run({ url: 'https://youtubei.googleapis.com/youtubei/v1/next?id=dQw4w9WgXcQ&t=1', body: [], reply: (cb) => cb(null, { status: 404 }, 'Not Found') });
  const p = createHash('sha256').update('dQw4w9WgXcQ').digest('hex').slice(0, 4);
  ok(r.calls[0] && r.calls[0].url.includes(`/skipSegments/${p}?`), 'Liest die Kennung auch aus der Adresse');
  ok(r.notes.length === 0 && r.doneCount === 1, 'Keine Daten (404): keine Mitteilung, kein Fehler');
}

// 4. Komprimierte Anfrage im Testmodus
{
  const r = await run({ body: [0x1f, 0x8b, 8, 0, 0], argument: '{"sponsor":true,"selfpromo":true,"interaction":false,"debug":true}' });
  ok(r.calls.length === 0 && r.doneCount === 1, 'Komprimierte Anfrage: nichts abgefragt, Anfrage läuft weiter');
  ok(r.notes.length === 1 && r.notes[0][1] === 'Anfrage ist komprimiert', 'Testmodus meldet den Grund');
}

// 5. Fortsetzungs-Anfrage ohne Video (z. B. Kommentare nachladen)
{
  const r = await run({ body: [...field(1, [...field(16, str('IOS'))]), ...field(15, str('a-very-long-continuation-token'))] });
  ok(r.calls.length === 0 && r.notes.length === 0 && r.doneCount === 1, 'Ohne Video-Kennung passiert nichts');
}

// 6. SponsorBlock antwortet nicht: spätestens nach 4,5 s geht die Anfrage weiter
{
  const t0 = Date.now();
  const r = await run({ body: nextRequest('xyzXYZ12345') });
  const ms = Date.now() - t0;
  ok(r.doneCount === 1 && ms < 5200, `Bei Funkstille geht es nach ${Math.round(ms / 100) / 10} s weiter`);
}

// 7. SHA-256 stimmt mit Node überein
{
  const ids = ['aaaaaaaaaaa', 'Z9-_x0Q1w2E', 'Cg1fvhYXapI'];
  const src = CODE.slice(CODE.indexOf('  function sha256Hex'), CODE.indexOf('  // ---------- Hilfen'));
  const f = vm.runInNewContext(`(${src.trim().replace(/^function sha256Hex/, 'function')})`);
  ok(ids.every((s) => f(s) === createHash('sha256').update(s).digest('hex')), 'Eigene SHA-256-Berechnung stimmt');
}

console.log(fehler ? `\n${fehler} Fehler gefunden.` : '\nAlles in Ordnung.');
process.exit(fehler ? 1 : 0);
