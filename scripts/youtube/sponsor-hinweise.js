// YouTube Sponsor-Hinweise für Surge (eigenes Skript dieses Repos).
//
// Läuft auf der Anfrage /youtubei/v1/next, die die YouTube-App beim Öffnen eines Videos stellt.
// 1. Liest die Video-Kennung (aus der Adresse oder dem protobuf-Inhalt der Anfrage).
// 2. Fragt SponsorBlock datensparsam: Es werden nur die ersten 4 Zeichen eines SHA-256-Hashes
//    der Video-Kennung gesendet (k-Anonymität), nicht die Kennung selbst.
// 3. Zeigt pro Sponsor-Stelle eine Mitteilung. Antippen öffnet das Video hinter der Stelle.
// Die Anfrage an YouTube wird nicht verändert.

(() => {
  'use strict';

  const API = 'https://sponsor.ajay.app/api/skipSegments/';
  const STORE_KEY = 'werbefrei.sponsor.last';
  const STATUS_KEY = 'werbefrei.sponsor.status';   // letzter Ablauf, liest die Werbefrei-App
  const DEBUG_KEY = 'werbefrei.sponsor.debug';     // Testmodus, setzt die Werbefrei-App
  const DEDUPE_MS = 15 * 60 * 1000;
  const TIMEOUT_MS = 4500;
  const MAX_NOTES = 3;
  const LABELS = { sponsor: 'Sponsor', selfpromo: 'Eigenwerbung', interaction: 'Abo-Aufruf' };

  let finished = false;
  let timer = null;
  const finish = () => {
    if (timer) { clearTimeout(timer); timer = null; }
    if (!finished) { finished = true; $done({}); }
  };
  timer = setTimeout(() => {
    timer = null;
    status('fehler', 'SponsorBlock hat nicht rechtzeitig geantwortet');
    finish();
  }, TIMEOUT_MS);

  function config() {
    const c = { sponsor: true, selfpromo: true, interaction: false, debug: false };
    try {
      if (typeof $argument === 'string' && $argument && !$argument.includes('{{{')) Object.assign(c, JSON.parse($argument));
      else if ($argument && typeof $argument === 'object') Object.assign(c, $argument);
    } catch (e) { /* Standardwerte */ }
    return c;
  }
  const cfg = config();
  try { if ($persistentStore.read(DEBUG_KEY) === 'true') cfg.debug = true; } catch (e) { /* egal */ }
  const debug = (title, text) => { if (cfg.debug) $notification.post('Sponsor-Hinweise (Test)', title, text || ''); };
  // Merkt sich, was beim letzten Video passiert ist (nur auf dem iPhone, ohne Video-Kennung).
  const status = (step, text, count) => {
    try { $persistentStore.write(JSON.stringify({ t: Date.now(), step, text, count: count || 0 }), STATUS_KEY); } catch (e) { /* egal */ }
  };

  // ---------- Video-Kennung ----------
  const ID_RE = /^[A-Za-z0-9_-]{11}$/;

  function idFromUrl(url) {
    const m = /[?&](?:id|v|videoId)=([A-Za-z0-9_-]{11})(?:&|$)/.exec(url || '');
    return m ? m[1] : null;
  }

  function toBytes(body) {
    if (!body) return null;
    if (body instanceof Uint8Array) return body;
    if (body instanceof ArrayBuffer) return new Uint8Array(body);
    if (typeof body === 'string') { // ohne binary-body-mode: als Latin-1 behandeln
      const b = new Uint8Array(body.length);
      for (let i = 0; i < body.length; i++) b[i] = body.charCodeAt(i) & 0xff;
      return b;
    }
    return null;
  }

  // Liest die oberste Ebene der protobuf-Nachricht und sucht ein 11-Zeichen-Feld (Video-Kennung).
  // Feld 2 (videoId) wird bevorzugt.
  function idFromProtobuf(b) {
    let i = 0;
    const n = b.length;
    const varint = () => {
      let r = 0; let s = 0; let x;
      do { if (i >= n) throw new Error('Ende'); x = b[i++]; r += (x & 0x7f) * 2 ** s; s += 7; } while (x & 0x80);
      return r;
    };
    const found = [];
    try {
      while (i < n) {
        const tag = varint();
        const field = Math.floor(tag / 8);
        const wire = tag % 8;
        if (wire === 0) varint();
        else if (wire === 1) i += 8;
        else if (wire === 5) i += 4;
        else if (wire === 2) {
          const len = varint();
          if (len === 11 && i + 11 <= n) {
            let s = '';
            for (let k = 0; k < 11; k++) s += String.fromCharCode(b[i + k]);
            if (ID_RE.test(s)) found.push({ field, id: s });
          }
          i += len;
        } else break;
      }
    } catch (e) { /* abgeschnittene Nachricht: bisher Gefundenes nutzen */ }
    const preferred = found.find((f) => f.field === 2);
    return (preferred || found[0] || {}).id || null;
  }

  // ---------- SHA-256 (für die datensparsame Abfrage) ----------
  function sha256Hex(ascii) {
    const K = [
      0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
      0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
      0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
      0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
      0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
      0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
      0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
      0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
    ];
    const H = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
    const bytes = [];
    for (let i = 0; i < ascii.length; i++) bytes.push(ascii.charCodeAt(i) & 0xff);
    const bitLen = bytes.length * 8;
    bytes.push(0x80);
    while (bytes.length % 64 !== 56) bytes.push(0);
    for (let s = 56; s >= 0; s -= 8) bytes.push(s >= 32 ? 0 : (bitLen >>> s) & 0xff);
    const rotr = (x, r) => (x >>> r) | (x << (32 - r));
    const W = new Array(64);
    for (let off = 0; off < bytes.length; off += 64) {
      for (let t = 0; t < 16; t++) {
        W[t] = (bytes[off + 4 * t] << 24) | (bytes[off + 4 * t + 1] << 16) | (bytes[off + 4 * t + 2] << 8) | bytes[off + 4 * t + 3];
      }
      for (let t = 16; t < 64; t++) {
        const s0 = rotr(W[t - 15], 7) ^ rotr(W[t - 15], 18) ^ (W[t - 15] >>> 3);
        const s1 = rotr(W[t - 2], 17) ^ rotr(W[t - 2], 19) ^ (W[t - 2] >>> 10);
        W[t] = (W[t - 16] + s0 + W[t - 7] + s1) | 0;
      }
      let [a, b, c, d, e, f, g, h] = H;
      for (let t = 0; t < 64; t++) {
        const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
        const ch = (e & f) ^ (~e & g);
        const t1 = (h + S1 + ch + K[t] + W[t]) | 0;
        const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
        const maj = (a & b) ^ (a & c) ^ (b & c);
        const t2 = (S0 + maj) | 0;
        h = g; g = f; f = e; e = (d + t1) | 0; d = c; c = b; b = a; a = (t1 + t2) | 0;
      }
      H[0] = (H[0] + a) | 0; H[1] = (H[1] + b) | 0; H[2] = (H[2] + c) | 0; H[3] = (H[3] + d) | 0;
      H[4] = (H[4] + e) | 0; H[5] = (H[5] + f) | 0; H[6] = (H[6] + g) | 0; H[7] = (H[7] + h) | 0;
    }
    return H.map((x) => (x >>> 0).toString(16).padStart(8, '0')).join('');
  }

  // ---------- Hilfen ----------
  const fmt = (sec) => {
    const s = Math.max(0, Math.round(sec));
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const r = String(s % 60).padStart(2, '0');
    return h ? `${h}:${String(m).padStart(2, '0')}:${r}` : `${m}:${r}`;
  };
  const jumpUrl = (id, sec) => `youtube://www.youtube.com/watch?v=${id}&t=${Math.ceil(sec)}s`;

  function recentlyNotified(id) {
    try {
      const last = JSON.parse($persistentStore.read(STORE_KEY) || '{}');
      return last.id === id && Date.now() - last.t < DEDUPE_MS;
    } catch (e) { return false; }
  }
  function remember(id) {
    try { $persistentStore.write(JSON.stringify({ id, t: Date.now() }), STORE_KEY); } catch (e) { /* egal */ }
  }

  function pickSegments(list, id) {
    const entry = Array.isArray(list) ? list.find((v) => v && v.videoID === id) : null;
    if (!entry || !Array.isArray(entry.segments)) return [];
    const wanted = entry.segments
      .filter((s) => cfg[s.category] === true && (s.actionType || 'skip') === 'skip')
      .filter((s) => Array.isArray(s.segment) && s.segment[1] > s.segment[0])
      .map((s) => ({ start: s.segment[0], end: s.segment[1], category: s.category }))
      .sort((x, y) => x.start - y.start);
    const merged = [];
    for (const s of wanted) {
      const prev = merged[merged.length - 1];
      if (prev && s.start <= prev.end + 1) prev.end = Math.max(prev.end, s.end);
      else merged.push({ ...s });
    }
    return merged.slice(0, MAX_NOTES);
  }

  // ---------- Ablauf ----------
  try {
    let reason = 'Keine Video-Kennung gefunden';
    const id = idFromUrl($request.url) || (() => {
      const b = toBytes($request.body);
      if (!b || !b.length) return null;
      if (b[0] === 0x1f && b[1] === 0x8b) { reason = 'Anfrage ist komprimiert'; return null; }
      return idFromProtobuf(b);
    })();

    if (!id) { status('ohne-video', reason); debug(reason, ''); finish(); return; }
    if (recentlyNotified(id)) { status('doppelt', 'Video wurde gerade schon gemeldet'); debug('Schon gemeldet', 'Dieses Video wurde in den letzten 15 Minuten schon geprüft.'); finish(); return; }

    const prefix = sha256Hex(id).slice(0, 4);
    const cats = Object.keys(LABELS).filter((k) => cfg[k] === true);
    if (!cats.length) { status('aus', 'Alle Kategorien ausgeschaltet'); finish(); return; }
    status('abfrage', 'Frage SponsorBlock …');
    const url = `${API}${prefix}?categories=${encodeURIComponent(JSON.stringify(cats))}&actionTypes=${encodeURIComponent('["skip"]')}`;

    $httpClient.get({ url, timeout: 4, headers: { 'User-Agent': 'Werbefrei-Sponsor/1.0' } }, (err, resp, data) => {
      try {
        const code = resp && (resp.status || resp.statusCode);
        if (err) {
          status('fehler', `SponsorBlock nicht erreichbar: ${String(err).slice(0, 80)}`);
          debug('SponsorBlock nicht erreichbar', String(err).slice(0, 120));
          return;
        }
        if (code === 404 || !data) {
          remember(id);
          status('keine-daten', 'Für dieses Video ist nichts eingetragen');
          debug('Keine Sponsor-Daten', 'Für dieses Video ist bei SponsorBlock nichts eingetragen.');
          return;
        }
        const segments = pickSegments(JSON.parse(data), id);
        remember(id);
        if (!segments.length) {
          status('keine-daten', 'Für dieses Video ist nichts eingetragen');
          debug('Keine passenden Stellen', 'Für dieses Video ist bei SponsorBlock nichts eingetragen.');
          return;
        }
        for (const s of segments) {
          const label = LABELS[s.category] || 'Sponsor';
          const len = Math.round(s.end - s.start);
          const link = jumpUrl(id, s.end);
          $notification.post(
            `⏭ ${label} bei ${fmt(s.start)}`,
            '',
            `${fmt(s.start)}–${fmt(s.end)} (${len} s) · Tippen = weiter bei ${fmt(s.end)}`,
            { action: 'open-url', url: link },
          );
        }
        status('gemeldet', segments.length === 1 ? '1 Stelle gemeldet' : `${segments.length} Stellen gemeldet`, segments.length);
      } catch (e) {
        status('fehler', String(e && e.message ? e.message : e).slice(0, 80));
        debug('Fehler', String(e && e.message ? e.message : e));
      } finally {
        finish();
      }
    });
  } catch (e) {
    debug('Fehler', String(e && e.message ? e.message : e));
    finish();
  }
})();
