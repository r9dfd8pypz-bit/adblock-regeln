// Test: Der Sponsor-Wächter ist stillgelegt. Ist das alte Modul noch in Surge aktiv, muss das Skript
// jede Anfrage sofort und unverändert durchlassen – ohne Netzwerk, ohne Mitteilung, ohne Speicher.
// Aufruf: node tests/sponsor-test.mjs
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CODE = readFileSync(join(ROOT, 'scripts/youtube/sponsor-hinweise.js'), 'utf8');
const MODUL = readFileSync(join(ROOT, 'modules/youtube-sponsor-hinweise.sgmodule'), 'utf8');

let fehler = 0;
const ok = (c, t) => { console.log(`${c ? 'OK    ' : 'FEHLER'} ${t}`); if (!c) fehler++; };

for (const url of [
  'https://youtubei.googleapis.com/youtubei/v1/next?prettyPrint=false',
  'https://s.youtube.com/api/stats/watchtime?docid=Cg1fvhYXapI&cmt=80.2&et=80.2',
]) {
  const done = [];
  const used = [];
  const t0 = Date.now();
  const ctx = vm.createContext({
    setTimeout: () => used.push('Zeitgeber'),
    $argument: '{"hold":35}',
    $request: { url, method: 'POST', headers: {}, body: new Uint8Array([1, 2, 3]) },
    $persistentStore: { read: () => { used.push('lesen'); return null; }, write: () => { used.push('schreiben'); return true; } },
    $notification: { post: () => used.push('Mitteilung') },
    $httpClient: new Proxy({}, { get: () => () => used.push('Netzwerk') }),
    $done: (r) => done.push(r),
  });
  vm.runInContext(CODE, ctx);
  const kurz = url.includes('stats') ? 'Wiedergabe-Meldung' : 'Video-Start';
  ok(done.length === 1 && JSON.stringify(done[0]) === '{}' && Date.now() - t0 < 50, `${kurz}: sofort unverändert durchgelassen`);
  ok(used.length === 0, `${kurz}: kein Netzwerk, keine Mitteilung, kein Speicher, kein Warten ${used.join(' ')}`);
}
ok(!/\[Script\]|script-path|\[MITM\]|hostname\s*=/.test(MODUL), 'Stillgelegtes Modul enthält keine Regeln und keine Entschlüsselung');

console.log(fehler ? `\n${fehler} Fehler gefunden.` : '\nAlles in Ordnung.');
process.exit(fehler ? 1 : 0);
