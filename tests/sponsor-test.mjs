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

// scale: Zeitgeber im Skript laufen so viel schneller (für Wartezeiten von mehreren Sekunden); delays = angefragte Wartezeiten
function run({ url = NEXT_URL, body, reply, store = new Map(), argument, scale }) {
  return new Promise((resolve) => {
    const notes = [];
    const calls = [];
    let doneCount = 0;
    const t0 = Date.now();
    const delays = [];
    const timer = scale ? (cb, ms) => { delays.push(ms); return setTimeout(cb, ms / scale); } : setTimeout;
    const ctx = vm.createContext({
      console, setTimeout: timer, clearTimeout,
      $argument: argument,
      $persistentStore: { read: (k) => store.get(k) ?? null, write: (v, k) => { store.set(k, v); return true; } },
      $notification: { post: (...a) => notes.push(a) },
      $httpClient: { get: (opts, cb) => { calls.push(opts); if (reply) setTimeout(() => reply(cb, opts), 5); } },
      __body: body,
    });
    vm.runInContext(`var $request = { url: ${JSON.stringify(url)}, method: 'POST', headers: {}, body: __body ? new Uint8Array(__body) : undefined };`, ctx);
    ctx.$done = (r) => { doneCount++; const ms = Date.now() - t0; setTimeout(() => resolve({ notes, calls, doneCount, result: r, store, ms, delays }), 20); };
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

// ---------- Rückfall: noch nie Positions-Meldungen gesehen (altes Modul) ----------
{
  const r = await run({ body: nextRequest(ID), reply: reply200 });
  ok(r.notes.length === 2 && r.notes[0][0] === '⏭ Sponsor bei 1:13', 'Ohne Positions-Meldungen: Stellen werden wie früher beim Start gemeldet');
  ok(/Modul aktualisieren/.test(json(r.store, 'werbefrei.sponsor.status').text), 'Status rät, das Modul zu aktualisieren');
}

// ---------- A) Video wird geöffnet (Positions-Meldungen funktionieren) ----------
const store = new Map([['werbefrei.sponsor.pos', JSON.stringify({ id: 'xxxxxxxxxxx', cmt: 5, t: Date.now() - 60000 })]]);
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
  ok(st.step === 'bereit' && st.v === 10 && !JSON.stringify(st).includes(ID), `Status ohne Video-Kennung: ${st.text}`);
  ok(json(store, 'werbefrei.sponsor.runs').next > 0 && json(store, 'werbefrei.sponsor.runs').v === 10, 'Hinterlässt einen Zeitstempel für „Video-Start“');
  ok(r.doneCount === 1 && Object.keys(r.result).length === 0, 'Anfrage an YouTube bleibt unverändert, $done genau einmal');
}

// ---------- B) Wiedergabe-Meldungen ----------
{
  const before = await run({ url: ping(ID, '30.1'), store });
  ok(json(store, 'werbefrei.sponsor.runs').ping > 0, 'Hinterlässt einen Zeitstempel für „Wiedergabe“');
  ok(before.notes.length === 0 && before.calls.length === 0, 'Vor der Stelle: keine Mitteilung, keine Netzwerkanfrage');
  ok(json(store, 'werbefrei.sponsor.pos').cmt === 30.1, 'Merkt sich die aktuelle Position');
  ok(before.ms < 100, `Wiedergabe-Meldung wird nicht aufgehalten (${before.ms} ms)`);

  const during = await run({ url: ping(ID, '80.2'), store });
  const [title, , text, opt] = during.notes[0] || [];
  ok(during.notes.length === 1, 'Während der Stelle: genau eine Mitteilung');
  ok(title === '⏭ Sponsor läuft – noch 46 s', `Titel: ${title}`);
  ok(text === 'Tippen = weiter bei 2:06', `Text: ${text}`);
  ok(opt && opt.action === 'open-url' && opt.url === `https://youtu.be/${ID}?t=128`, `Sprung-Link (Standard): ${opt && opt.url}`);
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

// ---------- Nur Wiedergabe-Meldungen (Video-Start wurde nicht erkannt) ----------
{
  const s2 = new Map();
  const r = await run({ url: ping(ID, '80.2'), store: s2, reply: reply200 });
  ok(r.calls.length === 1, 'Neues Video in der Wiedergabe-Meldung: holt die Stellen selbst');
  ok(r.notes.length === 1 && r.notes[0][0] === '⏭ Sponsor läuft – noch 46 s', 'Und meldet sofort, wenn gerade ein Sponsor läuft');
  ok(r.doneCount === 1, 'Wiedergabe-Meldung wird danach unverändert weitergeschickt');
}

// ---------- Werte im Inhalt der Meldung (iPhone-App) ----------
const segStore = () => new Map([
  ['werbefrei.sponsor.segments', JSON.stringify({ id: ID, t: Date.now(), segs: [{ start: 72.5, end: 126.4, category: 'sponsor' }] })],
  ['werbefrei.sponsor.pos', JSON.stringify({ id: 'xxxxxxxxxxx', cmt: 1, t: Date.now() })],
]);
{
  const s3 = segStore();
  const r = await run({ url: 'https://www.youtube.com/api/stats/qoe?fmt=243&event=streamingstats', body: str(`cpn=abc&docid=${ID}&cmt=1.5:79.9,11.5:80.2&bh=1`), store: s3 });
  ok(r.notes.length === 1 && r.notes[0][0] === '⏭ Sponsor läuft – noch 46 s', 'Werte im Inhalt (Text): Mitteilung während des Sponsors');
  const pings = json(s3, 'werbefrei.sponsor.pings');
  const p0 = pings && pings.items[0];
  ok(p0 && p0.kind === 'qoe' && p0.url === 'event,fmt' && /^Text \d+ B: bh,cmt,cpn,docid$/.test(p0.body) && p0.id === 'ja' && p0.cmt === '9.9:99.9,99.9:99.9', `Protokoll mit Feldnamen: ${JSON.stringify(p0)}`);
  ok(!JSON.stringify(pings).includes(ID) && !JSON.stringify(pings).includes('abc'), 'Protokoll enthält keine Werte (keine Video-Kennung, keine cpn)');
}
{
  const s4 = segStore();
  const r = await run({ url: 'https://s.youtube.com/api/stats/watchtime?ns=yt', body: str(JSON.stringify({ docid: ID, cmt: '81.0', st: 70 })), store: s4 });
  ok(r.notes.length === 1, 'Werte im Inhalt (JSON): Mitteilung während des Sponsors');
}
{
  const s5 = new Map();
  const r = await run({ url: `https://s.youtube.com/api/stats/playback?ns=yt&docid=${ID}&ver=2`, store: s5, reply: reply200 });
  ok(r.calls.length === 1 && r.notes.length === 0, 'Start-Meldung ohne Position: holt die Stellen, meldet aber noch nichts');
  ok(json(s5, 'werbefrei.sponsor.pos').cmt === 0, 'Start-Meldung zählt als Position 0');
}
{
  // get_watch: Kennung steckt verschachtelt (Feld 1 > Feld 2)
  const getWatch = [...field(1, [...field(1, [...field(16, str('IOS'))]), ...field(2, str(ID))]), ...field(2, [...field(5, str('next-params'))])];
  const r = await run({ url: 'https://youtubei.googleapis.com/youtubei/v1/get_watch?prettyPrint=false', body: getWatch, reply: reply200 });
  ok(r.calls.length === 0 && r.doneCount === 1 && r.ms < 100, 'get_watch: Video erkannt, Start wird nicht verzögert');
  ok(json(r.store, 'werbefrei.sponsor.status').step === 'erkannt', 'get_watch: verschachtelte Video-Kennung gefunden');
}

// ---------- watchtime ohne cmt: Position aus et ----------
{
  const s6 = segStore();
  const url = `https://s.youtube.com/api/stats/watchtime?ns=yt&docid=${ID}&st=70.1,75.0&et=75.0,85.3&state=playing`;
  const r = await run({ url, store: s6 });
  ok(json(s6, 'werbefrei.sponsor.pos').cmt === 85.3, 'watchtime: Position aus „et“');
  ok(r.notes.length === 1 && r.notes[0][0] === '⏭ Sponsor läuft – noch 41 s', `watchtime löst die Mitteilung aus: ${r.notes[0] && r.notes[0][0]}`);
}

// ---------- Vorab-Meldung, wenn der Sponsor vor der nächsten Meldung beginnt ----------
{
  const s7 = segStore();
  s7.set('werbefrei.sponsor.pos', JSON.stringify({ id: ID, cmt: 55, t: Date.now() - 10000 })); // Meldungen alle ~10 s
  const early = await run({ url: ping(ID, '64.0'), store: s7 });
  ok(early.notes.length === 1 && early.notes[0][0] === '⏭ Sponsor beginnt gleich (bei 1:13)', `Vorab-Meldung: ${early.notes[0] && early.notes[0][0]}`);
  ok(early.notes[0] && early.notes[0][2] === '54 s lang · Tippen, wenn er beginnt = weiter bei 2:06', 'Vorab-Text erklärt, wann man tippt');
  const later = await run({ url: ping(ID, '80.0'), store: s7 });
  ok(later.notes.length === 0, 'Danach keine zweite Mitteilung für dieselbe Stelle');

  const s8 = segStore();
  s8.set('werbefrei.sponsor.pos', JSON.stringify({ id: ID, cmt: 40, t: Date.now() - 10000 }));
  const tooEarly = await run({ url: ping(ID, '50.0'), store: s8 });
  ok(tooEarly.notes.length === 0, 'Zu früh (über 10 s vorher): noch keine Mitteilung');
}

// ---------- v9: pünktliche Mitteilung (neues Modul erlaubt 35 s Haltezeit) ----------
const ARG35 = JSON.stringify({ sponsor: true, selfpromo: true, interaction: false, vorschau: false, debug: false, hold: 35 });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
{
  // Meldung bei 50.0 s, Sponsor beginnt bei 72.5 s → 22,5 s warten, dann „beginnt jetzt“
  const s9 = segStore();
  const r = await run({ url: ping(ID, '50.0'), store: s9, argument: ARG35, scale: 100 });
  const hold = Math.max(...r.delays.filter((d) => d !== 4500));
  ok(r.notes.length === 1 && r.notes[0][0] === '⏭ Sponsor beginnt jetzt', `Pünktlich: Mitteilung zum Beginn (${r.notes[0] && r.notes[0][0]})`);
  ok(hold > 21500 && hold <= 22200, `Wartet bis zum Beginn der Stelle (${Math.round(hold)} ms)`);
  ok(r.notes[0] && r.notes[0][2] === '54 s · Tippen = weiter bei 2:06' && r.notes[0][3].url === `https://youtu.be/${ID}?t=128`, 'Text und Sprung mit 1 s Puffer hinter der Stelle');
  ok(r.doneCount === 1 && Object.keys(r.result).length === 0, 'Gehaltene Meldung geht danach unverändert raus');
  const log = json(s9, 'werbefrei.sponsor.log');
  ok(log && log.items[0].kind === 'pünktlich' && log.items[0].s === 72.5 && log.items[0].wait > 21 && !JSON.stringify(log).includes(ID), 'Genauigkeit wird ohne Video-Kennung festgehalten');
  const again = await run({ url: ping(ID, '75.0'), store: s9, argument: ARG35, scale: 100 });
  ok(again.notes.length === 0, 'Danach keine zweite Mitteilung für dieselbe Stelle');
}
{
  // Doppelte Geschwindigkeit: halbe Wartezeit
  const s10 = segStore();
  const r = await run({ url: `${ping(ID, '50.0')}&rate=2`, store: s10, argument: ARG35, scale: 100 });
  const hold = Math.max(...r.delays.filter((d) => d !== 4500));
  ok(r.notes.length === 1 && hold > 10500 && hold <= 11000, `Wiedergabe mit 2×: wartet nur halb so lange (${Math.round(hold)} ms)`);
}
{
  // Während des Wartens kommt eine neuere Meldung (z. B. Pause oder Sprung) → die alte meldet nichts
  const s11 = segStore();
  const pending = run({ url: ping(ID, '50.0'), store: s11, argument: ARG35, scale: 100 });
  await sleep(40);
  s11.set('werbefrei.sponsor.pos', JSON.stringify({ id: ID, cmt: 52, t: Date.now() + 5, rate: 1, paused: true }));
  const r = await pending;
  ok(r.notes.length === 0 && json(s11, 'werbefrei.sponsor.log').items[0].kind === 'übergeben', 'Neuere Meldung übernimmt: keine veraltete Mitteilung');
}
{
  // Pausiert: nichts planen
  const s12 = segStore();
  const r = await run({ url: `${ping(ID, '60.0')}&state=paused`, store: s12, argument: ARG35, scale: 100 });
  ok(r.notes.length === 0 && r.delays.every((d) => d === 4500), 'Pausiert: keine Wartezeit, keine Mitteilung');
}
{
  // Stumme Vorschau auf der Startseite: wird nicht ausgewertet
  const s13 = segStore();
  const r = await run({ url: ping(ID, '80.0').replace('el=detailpage', 'el=home') + '&muted=1', store: s13, argument: ARG35 });
  ok(r.notes.length === 0 && json(s13, 'werbefrei.sponsor.pos').id !== ID, 'Stumme Vorschau in der Liste: keine Mitteilung, Position bleibt unberührt');
}
{
  // Stelle lag ganz zwischen zwei Meldungen → als „verpasst“ festhalten
  const s14 = segStore();
  s14.set('werbefrei.sponsor.pos', JSON.stringify({ id: ID, cmt: 60, t: Date.now() - 80000 }));
  const r = await run({ url: ping(ID, '130.0'), store: s14, argument: ARG35 });
  const it = (json(s14, 'werbefrei.sponsor.log') || { items: [] }).items.find((x) => x.kind === 'verpasst');
  ok(r.notes.length === 0 && it && it.from === 60 && it.p === 130 && it.s === 72.5, 'Ganz übersprungene Stelle wird als „verpasst“ festgehalten');
  ok((json(s14, 'werbefrei.sponsor.log').gaps || [])[0] === 80, 'Abstand der Meldungen wird festgehalten');
}
{
  // Zurückgespult vor eine schon gemeldete Stelle → darf wieder gemeldet werden
  const s15 = segStore();
  s15.set('werbefrei.sponsor.notified', JSON.stringify({ videos: { [ID]: { starts: [72.5], missed: [], t: Date.now() } } }));
  const r = await run({ url: ping(ID, '40.0'), store: s15, argument: ARG35, scale: 100 });
  ok(r.notes.length === 1 && r.notes[0][0] === '⏭ Sponsor beginnt jetzt', 'Zurückgespult: Stelle wird erneut gemeldet');
}
{
  // Altes Modul (ohne hold): kurze Wartezeit bis 5 s wird genutzt
  const s16 = segStore();
  const r = await run({ url: ping(ID, '70.0'), store: s16, scale: 100 });
  ok(r.notes.length === 1 && r.notes[0][0] === '⏭ Sponsor beginnt jetzt', 'Altes Modul: Stelle in 2,5 s wird pünktlich gemeldet');
}
{
  // Altes Format der gemeldeten Stellen (bis v8) wird verstanden
  const s17 = segStore();
  s17.set('werbefrei.sponsor.notified', JSON.stringify({ id: ID, starts: [72.5] }));
  const r = await run({ url: ping(ID, '80.0'), store: s17 });
  ok(r.notes.length === 0, 'Gemeldete Stellen im alten Format bleiben gemeldet');
}

// ---------- Andere Link-Arten (in der App wählbar) ----------
for (const [style, expected] of [
  ['web', `https://www.youtube.com/watch?v=${ID}&t=128s`], ['app', `youtube://www.youtube.com/watch?v=${ID}&t=128s`],
  ['mix', `https://www.youtube.com/watch?v=${ID}&list=RD${ID}&start_radio=1&t=128s`], ['kurzmix', `https://youtu.be/${ID}?list=RD${ID}&t=128`],
  ['mobil', `https://m.youtube.com/watch?v=${ID}&t=128s`], ['appmix', `youtube://www.youtube.com/watch?v=${ID}&list=RD${ID}&t=128s`],
]) {
  const sx = segStore();
  sx.set('werbefrei.sponsor.link', style);
  const r = await run({ url: ping(ID, '80.2'), store: sx });
  ok(r.notes[0] && r.notes[0][3].url === expected, `Link-Art „${style}“: ${r.notes[0] && r.notes[0][3].url}`);
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
