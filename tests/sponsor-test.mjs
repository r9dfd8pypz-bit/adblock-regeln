// Test für scripts/youtube/sponsor-hinweise.js (Sponsor-Wächter) mit nachgebauten Surge-Funktionen.
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
const NEXT_URL = 'https://youtubei.googleapis.com/youtubei/v1/next?prettyPrint=false';
const ping = (id, cmt, kind = 'watchtime') =>
  `https://s.youtube.com/api/stats/${kind}?ns=yt&el=detailpage&cpn=abcDEF123&docid=${id}&ver=2&cmt=${encodeURIComponent(cmt)}&st=1&et=${encodeURIComponent(cmt)}`;

function run({ url = NEXT_URL, body, reply, store = new Map(), argument }) {
  return new Promise((resolve) => {
    const notes = [];
    const calls = [];
    let doneCount = 0;
    const t0 = Date.now();
    const ctx = vm.createContext({
      console, setTimeout, clearTimeout,
      $argument: argument,
      $persistentStore: { read: (k) => store.get(k) ?? null, write: (v, k) => { store.set(k, v); return true; } },
      $notification: { post: (...a) => notes.push(a) },
      $httpClient: { get: (opts, cb) => { calls.push(opts); if (reply) setTimeout(() => reply(cb, opts), 5); } },
      __body: body,
    });
    vm.runInContext(`var $request = { url: ${JSON.stringify(url)}, method: 'POST', headers: {}, body: __body ? new Uint8Array(__body) : undefined };`, ctx);
    ctx.$done = (r) => { doneCount++; const ms = Date.now() - t0; setTimeout(() => resolve({ notes, calls, doneCount, result: r, store, ms }), 20); };
    vm.runInContext(CODE, ctx);
  });
}
const json = (store, key) => JSON.parse(store.get(key) || 'null');

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
const reply200 = (cb) => cb(null, { status: 200 }, sponsorData);

// ---------- A) Video wird geöffnet ----------
const store = new Map();
{
  const r = await run({ body: nextRequest(ID), reply: reply200, store });
  ok(r.calls.length === 1, 'Fragt SponsorBlock beim Öffnen genau einmal');
  const u = r.calls[0] && r.calls[0].url;
  ok(u && u.startsWith(`https://sponsor.ajay.app/api/skipSegments/${prefix}?`) && !u.includes(ID), `Sendet nur den Hash-Anfang (${prefix}), nicht die Video-Kennung`);
  ok(u && decodeURIComponent(u).includes('categories=["sponsor","selfpromo"]'), 'Fragt nur die eingeschalteten Kategorien ab');
  const segs = json(store, 'werbefrei.sponsor.segments');
  ok(segs && segs.id === ID && segs.segs.length === 2, 'Merkt sich die Stellen des Videos');
  ok(segs && segs.segs[0].start === 72.5 && segs.segs[0].end === 126.4, 'Überlappende Stellen werden zusammengefasst');
  ok(r.notes.length === 0, 'Beim Öffnen keine Mitteilung (Vorschau ist aus)');
  const st = json(store, 'werbefrei.sponsor.status');
  ok(st.step === 'bereit' && st.v === 3 && !JSON.stringify(st).includes(ID), `Status ohne Video-Kennung: ${st.text}`);
  ok(r.doneCount === 1 && Object.keys(r.result).length === 0, 'Anfrage an YouTube bleibt unverändert, $done genau einmal');
}

// ---------- B) Wiedergabe-Meldungen ----------
{
  const before = await run({ url: ping(ID, '30.1'), store });
  ok(before.notes.length === 0 && before.calls.length === 0, 'Vor der Stelle: keine Mitteilung, keine Netzwerkanfrage');
  ok(json(store, 'werbefrei.sponsor.pos').cmt === 30.1, 'Merkt sich die aktuelle Position');
  ok(before.ms < 100, `Wiedergabe-Meldung wird nicht aufgehalten (${before.ms} ms)`);

  const during = await run({ url: ping(ID, '80.2'), store });
  const [title, , text, opt] = during.notes[0] || [];
  ok(during.notes.length === 1, 'Während der Stelle: genau eine Mitteilung');
  ok(title === '⏭ Sponsor läuft – noch 46 s', `Titel: ${title}`);
  ok(text === 'Tippen = weiter bei 2:06', `Text: ${text}`);
  ok(opt && opt.action === 'open-url' && opt.url === `youtube://www.youtube.com/watch?v=${ID}&t=127s`, `Sprung-Link: ${opt && opt.url}`);
  ok(json(store, 'werbefrei.sponsor.status').step === 'gemeldet', 'Status: gemeldet');

  const again = await run({ url: ping(ID, '92.0'), store });
  ok(again.notes.length === 0, 'Gleiche Stelle wird nicht doppelt gemeldet');

  const fresh = new Map(store); fresh.delete('werbefrei.sponsor.notified');
  const nearEnd = await run({ url: ping(ID, '124.0'), store: fresh });
  ok(nearEnd.notes.length === 0, 'Kurz vor Ende der Stelle keine Meldung mehr');

  const qoe = await run({ url: ping(ID, '1.2:3600.5,11.2:3610.0', 'qoe'), store });
  ok(qoe.notes.length === 1 && qoe.notes[0][0] === '⏭ Eigenwerbung läuft – noch 20 s', `qoe-Format mit Zeitpaaren: ${qoe.notes[0] && qoe.notes[0][0]}`);

  const other = await run({ url: ping('anderesVid1', '10'), store });
  ok(other.notes.length === 0, 'Anderes Video: keine Mitteilung');

  const reopen = await run({ body: nextRequest(ID), reply: reply200, store });
  ok(reopen.calls.length === 0 && reopen.notes.length === 0, 'Nach dem Sprung (Video neu geöffnet): keine neue Abfrage');
}

// ---------- Vorschau beim Start ----------
{
  const r = await run({ body: nextRequest(ID), reply: reply200, argument: '{"sponsor":true,"selfpromo":true,"interaction":false,"vorschau":true,"debug":false}' });
  ok(r.notes.length === 2 && r.notes[0][0] === '⏭ Sponsor bei 1:13', 'Mit „Vorschau“ kommen die Stellen zusätzlich beim Start');
}

// ---------- Sonderfälle ----------
{
  const r = await run({ url: 'https://youtubei.googleapis.com/youtubei/v1/next?id=dQw4w9WgXcQ&t=1', body: [], reply: (cb) => cb(null, { status: 404 }, 'Not Found') });
  const p = createHash('sha256').update('dQw4w9WgXcQ').digest('hex').slice(0, 4);
  ok(r.calls[0] && r.calls[0].url.includes(`/skipSegments/${p}?`), 'Liest die Kennung auch aus der Adresse');
  ok(json(r.store, 'werbefrei.sponsor.status').step === 'keine-daten' && json(r.store, 'werbefrei.sponsor.segments').segs.length === 0, 'Keine Daten (404): merkt sich „keine Stellen“');
}
{
  const s = new Map([['werbefrei.sponsor.debug', 'true']]);
  const r = await run({ body: [0x1f, 0x8b, 8, 0, 0], store: s });
  ok(r.calls.length === 0 && r.notes.length === 1 && r.notes[0][1] === 'Anfrage ist komprimiert', 'Testmodus aus der App meldet den Grund');
}
{
  const r = await run({ body: [...field(1, [...field(16, str('IOS'))]), ...field(15, str('a-very-long-continuation-token'))] });
  ok(r.calls.length === 0 && r.notes.length === 0 && r.doneCount === 1, 'Ohne Video-Kennung passiert nichts');
}
{
  const r = await run({ body: nextRequest('xyzXYZ12345') });
  ok(r.doneCount === 1 && r.ms < 5200 && /nicht rechtzeitig/.test(json(r.store, 'werbefrei.sponsor.status').text), `Bei Funkstille geht es nach ${Math.round(r.ms / 100) / 10} s weiter`);
}
{
  const ids = ['aaaaaaaaaaa', 'Z9-_x0Q1w2E', 'Cg1fvhYXapI'];
  const src = CODE.slice(CODE.indexOf('  function sha256Hex'), CODE.indexOf('  // ---------- Hilfen'));
  const f = vm.runInNewContext(`(${src.trim().replace(/^function sha256Hex/, 'function')})`);
  ok(ids.every((x) => f(x) === createHash('sha256').update(x).digest('hex')), 'Eigene SHA-256-Berechnung stimmt');
}

console.log(fehler ? `\n${fehler} Fehler gefunden.` : '\nAlles in Ordnung.');
process.exit(fehler ? 1 : 0);
