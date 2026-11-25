// Video-Start der YouTube-App („onesie“, googlevideo.com/initplayback) und log_event – eigenes Skript.
//
// Ablauf wie in Maasea/sgmodule, Fassung 2ead6ff (11.07.2026), aber ohne fremden Server:
// - initplayback: Die App schickt ihre Player-Anfrage verschlüsselt an googlevideo.com. Kennt Surge den
//   passenden Schlüssel (gespeichert von youtube.response.js aus config/log_event), geht die Anfrage
//   UNVERÄNDERT durch und youtube.ump.js entfernt die Werbung aus der Antwort, direkt auf dem iPhone.
//   Passt der Schlüssel nicht, antwortet das Skript leer. Die App weicht dann auf /youtubei/v1/player aus,
//   das youtube.response.js filtert. Der gespeicherte Schlüssel wird gelöscht und beim nächsten Mal neu geholt.
// - log_event: Fehlt der Schlüssel, entfernt das Skript den Kopf „x-youtube-hot-hash-data“, damit YouTube
//   die Einstellungen (mit Schlüssel) neu schickt. Dabei fällt auch „content-encoding“ weg, weil Surge den
//   Inhalt schon entpackt hat (wie Maasea-Fix 6cf1621).
// Keine Netzwerkanfrage, keine Mitteilung. Gespeichert wird nur ein Zähler für den Werbefrei-Bericht.
(() => {
  'use strict';
  const CONFIG_KEY = 'YouTubeConfig';
  const STATS_KEY = 'werbefrei.init.stats';
  const HOT_HASH = 'x-youtube-hot-hash-data';
  const req = $request;
  const url = String(req.url || '');
  const headers = req.headers || {};
  const ua = String(headers['User-Agent'] || headers['user-agent'] || '');
  const platform = /music/i.test(ua) ? 'youtubeMusic' : 'youtube';

  const readJSON = (k) => { try { return JSON.parse($persistentStore.read(k) || 'null'); } catch (e) { return null; } };
  const keys = () => { const c = readJSON(CONFIG_KEY); return (c && c[platform]) || {}; };
  const dropKeys = () => {
    const c = readJSON(CONFIG_KEY);
    if (c && c[platform]) { delete c[platform]; $persistentStore.write(JSON.stringify(c), CONFIG_KEY); }
  };
  const count = (what) => {
    try {
      const s = readJSON(STATS_KEY) || {};
      s[what] = (s[what] || 0) + 1;
      s.t = Date.now();
      s.last = what;
      $persistentStore.write(JSON.stringify(s), STATS_KEY);
    } catch (e) { /* egal */ }
  };

  function fromBase64(s) {
    const abc = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
    const clean = String(s).replace(/-/g, '+').replace(/_/g, '/').replace(/[^A-Za-z0-9+/]/g, '');
    const out = [];
    let buf = 0; let bits = 0;
    for (const ch of clean) {
      buf = (buf << 6) | abc.indexOf(ch); bits += 6;
      if (bits >= 8) { bits -= 8; out.push((buf >> bits) & 0xff); }
    }
    return Uint8Array.from(out);
  }
  function toBytes(body) {
    if (!body) return null;
    if (body instanceof Uint8Array) return body;
    if (body instanceof ArrayBuffer) return new Uint8Array(body);
    return null;
  }
  // Liest aus protobuf-Bytes das erste Längen-Feld mit Nummer `no` (oder null).
  function field(b, no) {
    let p = 0;
    const varint = () => { let v = 0; let m = 1; let c; do { if (p >= b.length) throw new Error('Ende'); c = b[p++]; v += (c & 127) * m; m *= 128; } while (c & 128); return v; };
    try {
      while (p < b.length) {
        const tag = varint(); const n = Math.floor(tag / 8); const wt = tag % 8;
        if (wt === 0) varint(); else if (wt === 1) p += 8; else if (wt === 5) p += 4;
        else if (wt === 2) { const len = varint(); if (p + len > b.length) return null; if (n === no) return b.subarray(p, p + len); p += len; }
        else return null;
      }
    } catch (e) { return null; }
    return null;
  }
  const same = (a, b) => !!a && !!b && a.length === b.length && a.every((x, i) => x === b[i]);

  function logEvent() {
    if (keys().clientKey) { $done({}); return; }
    const h = {};
    for (const k of Object.keys(headers)) {
      const low = k.toLowerCase();
      if (low !== HOT_HASH && low !== 'content-encoding') h[k] = headers[k];
    }
    count('schluesselHolen');
    $done({ headers: h });
  }

  function initPlayback() {
    const { encryptKey } = keys();
    const body = toBytes(req.body);
    const inner = body ? field(body, 3) : null;          // encryptedInnertubeRequest
    const clientKey = inner ? field(inner, 5) : null;      // encryptedClientKey
    if (encryptKey && same(clientKey, fromBase64(encryptKey))) {
      count('durchgelassen');
      $done({});
      return;
    }
    dropKeys();
    count('ausgewichen');
    $done({ response: { status: 200, headers: { 'Content-Type': 'text/plain' }, body: new Uint8Array(0) } });
  }

  try {
    if (/\/youtubei\/v1\/log_event/.test(url)) logEvent();
    else if (/googlevideo\.com\/initplayback/.test(url)) initPlayback();
    else $done({});
  } catch (e) {
    $done({});
  }
})();
