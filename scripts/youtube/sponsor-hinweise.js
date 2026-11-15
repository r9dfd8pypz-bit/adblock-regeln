// YouTube Sponsor-Wächter für Surge (eigenes Skript dieses Repos).
//
// Zwei Einsatzorte (siehe Modul youtube-sponsor-hinweise.sgmodule):
// A) Anfrage /youtubei/v1/next, /player oder /get_watch – die YouTube-App öffnet ein Video.
//    Das Skript liest die Video-Kennung, fragt SponsorBlock datensparsam (nur die ersten
//    4 Zeichen eines SHA-256-Hashes der Kennung) und merkt sich die Sponsor-Stellen.
// B) Wiedergabe-Meldungen /api/stats/… – die App meldet regelmäßig die aktuelle
//    Abspielposition (cmt) und die Video-Kennung (docid), in der Adresse oder im Inhalt.
//    Läuft gerade eine Sponsor-Stelle, kommt sofort eine Mitteilung. Beginnt eine Stelle kurz
//    nach der Meldung, hält das Skript die Meldung an und meldet sich PÜNKTLICH zum Beginn
//    (höchstens so lange, wie das Modul erlaubt: „hold“ Sekunden). Antippen öffnet das Video
//    hinter der Stelle.
// Keine Anfrage an YouTube wird verändert. Verzögert werden nur A um die SponsorBlock-Abfrage
// und B, solange auf den Beginn einer Stelle gewartet wird (die Meldung geht danach unverändert raus).

(() => {
  'use strict';

  const VERSION = 9; // erscheint in der Werbefrei-App, damit man sieht, welche Fassung läuft
  const API = 'https://sponsor.ajay.app/api/skipSegments/';
  const SEGS_KEY = 'werbefrei.sponsor.segments';     // { id, t, segs } des zuletzt geöffneten Videos
  const POS_KEY = 'werbefrei.sponsor.pos';           // { id, cmt, t } letzte Wiedergabe-Meldung
  const NOTIFIED_KEY = 'werbefrei.sponsor.notified'; // { videos: { id: { starts, missed, t } } } schon gemeldete Stellen
  const SEGCACHE_KEY = 'werbefrei.sponsor.segcache'; // { list: [{ id, t, segs }] } Stellen der letzten Videos
  const LOG_KEY = 'werbefrei.sponsor.log';           // { items, gaps } Genauigkeit der letzten Mitteilungen (ohne Video-Kennung)
  const STATUS_KEY = 'werbefrei.sponsor.status';     // letzter Ablauf, liest die Werbefrei-App
  const DEBUG_KEY = 'werbefrei.sponsor.debug';       // Testmodus, setzt die Werbefrei-App
  const RUNS_KEY = 'werbefrei.sponsor.runs';         // { next, ping, v } wann das Skript zuletzt lief
  const PINGS_KEY = 'werbefrei.sponsor.pings';       // Aufbau der letzten Meldungen (nur Feldnamen, keine Werte)
  const LINK_KEY = 'werbefrei.sponsor.link';         // Art des Sprung-Links: kurz | web | app (wählt die Werbefrei-App)
  const CACHE_MS = 30 * 60 * 1000;
  const PING_FRESH_MS = 3 * 24 * 60 * 60 * 1000; // so lange gelten Positions-Meldungen als „funktionieren“
  const TIMEOUT_MS = 4500;
  const MAX_SEGMENTS = 10;
  const LABELS = { sponsor: 'Sponsor', selfpromo: 'Eigenwerbung', interaction: 'Abo-Aufruf' };
  const HOLD_DEFAULT = 5;   // Sekunden Wartezeit, wenn das Modul nichts vorgibt (altes Modul: timeout=8)
  const LEAD_MS = 300;      // so viel früher als der berechnete Beginn melden (Mitteilung braucht einen Moment)
  const JUMP_MARGIN = 1;    // Sekunden Puffer hinter dem Ende der Stelle beim Sprung

  const T0 = Date.now();    // Zeitpunkt der Meldung (das Skript startet, wenn die App sie abschickt)
  let finished = false;
  let guard = null;
  let ownPosT = 0;          // Zeitstempel der Position, die dieses Skript gespeichert hat
  const finish = () => {
    if (guard) { clearTimeout(guard); guard = null; }
    if (!finished) { finished = true; $done({}); }
  };
  guard = setTimeout(() => {
    guard = null;
    status('fehler', 'SponsorBlock hat nicht rechtzeitig geantwortet');
    finish();
  }, TIMEOUT_MS);

  function config() {
    const c = { sponsor: true, selfpromo: true, interaction: false, vorschau: false, debug: false, hold: HOLD_DEFAULT };
    try {
      if (typeof $argument === 'string' && $argument && !$argument.includes('{{{')) Object.assign(c, JSON.parse($argument));
      else if ($argument && typeof $argument === 'object') Object.assign(c, $argument);
    } catch (e) { /* Standardwerte */ }
    c.hold = Math.min(55, Math.max(0, Number(c.hold) || 0));
    return c;
  }
  const cfg = config();
  try { if ($persistentStore.read(DEBUG_KEY) === 'true') cfg.debug = true; } catch (e) { /* egal */ }
  const debug = (title, text) => { if (cfg.debug) $notification.post('Sponsor-Wächter (Test)', title, text || ''); };
  const readJSON = (key) => { try { return JSON.parse($persistentStore.read(key) || 'null'); } catch (e) { return null; } };
  const writeJSON = (key, value) => { try { $persistentStore.write(JSON.stringify(value), key); } catch (e) { /* egal */ } };
  // Merkt sich, was zuletzt passiert ist (nur auf dem iPhone, ohne Video-Kennung).
  const status = (step, text, count) => writeJSON(STATUS_KEY, { t: Date.now(), v: VERSION, step, text, count: count || 0 });

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

  // Sucht in einer protobuf-Nachricht (bis 3 Ebenen tief) ein 11-Zeichen-Feld (Video-Kennung).
  // Feld 2 (videoId) auf möglichst hoher Ebene wird bevorzugt. Nötig, weil neuere YouTube-Apps
  // das Video über get_watch öffnen, wo die Kennung verschachtelt steckt.
  function scanProto(b, from, to, depth, found) {
    let i = from;
    const varint = () => {
      let r = 0; let sh = 0; let x;
      do { if (i >= to) throw new Error('Ende'); x = b[i++]; r += (x & 0x7f) * 2 ** sh; sh += 7; } while (x & 0x80);
      return r;
    };
    const local = [];
    try {
      while (i < to) {
        const tag = varint();
        const field = Math.floor(tag / 8);
        const wire = tag % 8;
        if (field === 0) return false;
        if (wire === 0) varint();
        else if (wire === 1) i += 8;
        else if (wire === 5) i += 4;
        else if (wire === 2) {
          const len = varint();
          if (i + len > to) return false;
          if (len === 11) {
            let str = '';
            for (let k = 0; k < 11; k++) str += String.fromCharCode(b[i + k]);
            if (ID_RE.test(str)) local.push({ field, depth, id: str });
          } else if (depth < 3 && len > 1) {
            const sub = [];
            if (scanProto(b, i, i + len, depth + 1, sub)) local.push(...sub);
          }
          i += len;
        } else return false;
      }
    } catch (e) { return false; }
    found.push(...local);
    return true;
  }
  function idFromProtobuf(b) {
    const found = [];
    scanProto(b, 0, b.length, 0, found);
    found.sort((x, y) => (x.field === 2 ? 0 : 1) - (y.field === 2 ? 0 : 1) || x.depth - y.depth);
    return (found[0] || {}).id || null;
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
  // Sprung-Link: Surge öffnet youtube:// nicht, deshalb standardmäßig ein normaler YouTube-Link,
  // den iOS direkt an die YouTube-App weitergibt.
  const linkStyle = (() => { try { return $persistentStore.read(LINK_KEY) || 'kurz'; } catch (e) { return 'kurz'; } })();
  const jumpUrl = (id, sec) => {
    const t = Math.ceil(sec + JUMP_MARGIN);
    if (linkStyle === 'app') return `youtube://www.youtube.com/watch?v=${id}&t=${t}s`;
    if (linkStyle === 'web') return `https://www.youtube.com/watch?v=${id}&t=${t}s`;
    return `https://youtu.be/${id}?t=${t}`;
  };
  const label = (s) => LABELS[s.category] || 'Sponsor';
  const list = (segs) => segs.map((s) => `${fmt(s.start)}–${fmt(s.end)}`).join(', ');

  function query(url) {
    const out = {};
    const q = String(url || '').split('?')[1] || '';
    for (const part of q.split('&')) {
      const i = part.indexOf('=');
      if (i <= 0) continue;
      try { out[decodeURIComponent(part.slice(0, i))] = decodeURIComponent(part.slice(i + 1).replace(/\+/g, ' ')); } catch (e) { /* kaputter Teil */ }
    }
    return out;
  }
  // cmt ist entweder eine Zahl ("73.4") oder eine Liste "Zeitpunkt:Position,…" – dann zählt der letzte Eintrag.
  function currentTime(raw) {
    if (!raw) return NaN;
    const last = String(raw).split(',').pop();
    return parseFloat(last.includes(':') ? last.split(':').pop() : last);
  }

  function pickSegments(listData, id) {
    const entry = Array.isArray(listData) ? listData.find((v) => v && v.videoID === id) : null;
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
    return merged.slice(0, MAX_SEGMENTS);
  }

  // ---------- Merkzettel: Stellen, gemeldete Stellen, Genauigkeit ----------
  function getSegs(id) {
    const last = readJSON(SEGS_KEY);
    if (last && last.id === id && Date.now() - last.t < CACHE_MS) return last.segs;
    const c = readJSON(SEGCACHE_KEY);
    const hit = c && Array.isArray(c.list) ? c.list.find((x) => x && x.id === id && Date.now() - x.t < CACHE_MS) : null;
    return hit ? hit.segs : null;
  }
  function putSegs(id, segs) {
    writeJSON(SEGS_KEY, { id, t: Date.now(), segs });
    const c = readJSON(SEGCACHE_KEY);
    const rest = (c && Array.isArray(c.list) ? c.list : []).filter((x) => x && x.id !== id);
    writeJSON(SEGCACHE_KEY, { list: [{ id, t: Date.now(), segs }, ...rest].slice(0, 6) });
  }
  function readNotifiedAll() {
    const n = readJSON(NOTIFIED_KEY);
    if (n && n.videos && typeof n.videos === 'object') return n;
    if (n && n.id) return { videos: { [n.id]: { starts: n.starts || [], missed: [], t: Date.now() } } }; // Format bis v8
    return { videos: {} };
  }
  function readNotified(id) {
    const v = readNotifiedAll().videos[id];
    return { starts: (v && v.starts) || [], missed: (v && v.missed) || [] };
  }
  function updateNotified(id, fn) {
    const all = readNotifiedAll();
    const v = all.videos[id] || { starts: [], missed: [] };
    v.starts = v.starts || [];
    v.missed = v.missed || [];
    fn(v);
    v.t = Date.now();
    all.videos[id] = v;
    const keep = Object.keys(all.videos).sort((a, b) => (all.videos[b].t || 0) - (all.videos[a].t || 0)).slice(0, 6);
    writeJSON(NOTIFIED_KEY, { videos: Object.fromEntries(keep.map((k) => [k, all.videos[k]])) });
  }
  const markNotified = (id, start) => updateNotified(id, (v) => { if (!v.starts.includes(start)) v.starts.push(start); });
  const r1 = (x) => Math.round(x * 10) / 10;
  const segInfo = (seg) => ({ cat: seg.category, s: r1(seg.start), e: r1(seg.end) });
  function logEvent(e) {
    const l = readJSON(LOG_KEY) || {};
    const items = Array.isArray(l.items) ? l.items : [];
    writeJSON(LOG_KEY, { ...l, v: VERSION, items: [{ t: Date.now(), ...e }, ...items].slice(0, 12) });
  }
  function recordGap(gap) {
    const l = readJSON(LOG_KEY) || {};
    const gaps = Array.isArray(l.gaps) ? l.gaps : [];
    writeJSON(LOG_KEY, { ...l, gaps: [Math.round(gap), ...gaps].slice(0, 10) });
  }

  // Fragt SponsorBlock nach den Stellen eines Videos. cb(segs) – segs ist null bei Fehler.
  function fetchSegments(id, cb) {
    const cats = Object.keys(LABELS).filter((k) => cfg[k] === true);
    if (!cats.length) { status('aus', 'Alle Kategorien ausgeschaltet'); cb(null); return; }
    status('abfrage', 'Frage SponsorBlock …');
    const prefix = sha256Hex(id).slice(0, 4);
    const url = `${API}${prefix}?categories=${encodeURIComponent(JSON.stringify(cats))}&actionTypes=${encodeURIComponent('["skip"]')}`;
    $httpClient.get({ url, timeout: 4, headers: { 'User-Agent': 'Werbefrei-Sponsor/1.0' } }, (err, resp, data) => {
      try {
        if (err) {
          status('fehler', `SponsorBlock nicht erreichbar: ${String(err).slice(0, 80)}`);
          debug('SponsorBlock nicht erreichbar', String(err).slice(0, 120));
          cb(null);
          return;
        }
        const code = resp && (resp.status || resp.statusCode);
        const segs = code === 404 || !data ? [] : pickSegments(JSON.parse(data), id);
        putSegs(id, segs);
        updateNotified(id, (v) => { v.starts = []; v.missed = []; });
        cb(segs);
      } catch (e) {
        status('fehler', String(e && e.message ? e.message : e).slice(0, 80));
        cb(null);
      }
    });
  }

  // ---------- B) Wiedergabe-Meldungen (/api/stats/…): Läuft gerade eine Sponsor-Stelle? ----------
  // Die Werte können in der Adresse oder im Inhalt stehen (Text, JSON oder protobuf).
  function asText(b) {
    let printable = 0;
    let str = '';
    const n = Math.min(b.length, 65536);
    for (let i = 0; i < n; i++) {
      const c = b[i];
      if (c === 9 || c === 10 || c === 13 || (c >= 32 && c < 127)) printable++;
      str += String.fromCharCode(c);
    }
    return n && printable / n > 0.95 ? str : null;
  }
  function paramsFromText(text) {
    const t = text.trim();
    if (t.startsWith('{')) {
      try {
        const o = JSON.parse(t);
        const flat = {};
        for (const [k, v] of Object.entries(o)) if (v === null || typeof v !== 'object') flat[k] = String(v);
        return flat;
      } catch (e) { return {}; }
    }
    return t.includes('=') ? query(`?${t}`) : {};
  }
  const shape = (raw) => (raw === undefined || raw === null ? 'fehlt' : String(raw).slice(0, 24).replace(/[0-9]/g, '9'));
  function recordPing(entry) {
    const prev = readJSON(PINGS_KEY);
    const items = prev && Array.isArray(prev.items) ? prev.items : [];
    writeJSON(PINGS_KEY, { items: [entry, ...items].slice(0, 6) });
  }

  function handleStats(url) {
    const kind = (/\/api\/stats\/([a-z_]+)/.exec(url) || [])[1] || '?';
    const q = query(url);
    const bytes = toBytes($request.body);
    const text = bytes && bytes.length ? asText(bytes) : null;
    const fromBody = text ? paramsFromText(text) : {};
    const all = { ...fromBody, ...q };
    let id = all.docid || all.video_id || all.videoId || all.v || null;
    if (!ID_RE.test(id || '') && bytes && bytes.length && !text) id = idFromProtobuf(bytes);
    const rawCmt = all.cmt !== undefined ? all.cmt : all.cmt_s;
    let cmt = currentTime(rawCmt);
    // watchtime hat kein cmt, aber et = Ende des zuletzt gesehenen Abschnitts (≈ aktuelle Position).
    if (!isFinite(cmt) && all.et !== undefined) cmt = currentTime(all.et);
    if (!isFinite(cmt) && kind === 'playback') cmt = 0; // Start-Meldung ohne Position = Anfang des Videos

    recordPing({
      t: Date.now(),
      kind,
      method: String($request.method || '?'),
      url: Object.keys(q).sort().join(','),
      body: !bytes || !bytes.length ? 'leer' : text ? `Text ${bytes.length} B: ${Object.keys(fromBody).sort().join(',')}` : `binär ${bytes.length} B`,
      id: ID_RE.test(id || '') ? 'ja' : 'nein',
      cmt: rawCmt !== undefined ? shape(rawCmt) : all.et !== undefined ? `et ${shape(all.et)}` : 'fehlt',
    });

    if (!ID_RE.test(id || '')) { finish(); return; }
    // Stumme Vorschau in einer Liste (z. B. Startseite): nicht auswerten.
    if (all.muted === '1' && all.el && all.el !== 'detailpage') { finish(); return; }
    let rate = parseFloat(all.rate);
    if (!(rate >= 0.25 && rate <= 4)) rate = 1;
    const paused = /paus/i.test(all.state || '');

    // Abstand zur letzten Meldung = wie oft die App meldet.
    const prev = readJSON(POS_KEY);
    const sameVideo = prev && prev.id === id && Date.now() - prev.t < 120000;
    const gap = sameVideo ? (Date.now() - prev.t) / 1000 : 10;
    if (isFinite(cmt)) {
      if (sameVideo && gap >= 1) recordGap(gap);
      // Ganz zwischen zwei Meldungen vorbeigelaufen? Für die Genauigkeits-Anzeige festhalten.
      const known = sameVideo ? getSegs(id) : null;
      if (known && cmt > prev.cmt && cmt - prev.cmt < 180) {
        const n = readNotified(id);
        for (const sg of known) {
          if (sg.start > prev.cmt && sg.end <= cmt && !n.starts.includes(sg.start) && !n.missed.includes(sg.start)) {
            updateNotified(id, (v) => { v.missed.push(sg.start); });
            logEvent({ kind: 'verpasst', ...segInfo(sg), from: r1(prev.cmt), p: r1(cmt), gap: r1(gap) });
          }
        }
      }
      ownPosT = Date.now();
      writeJSON(POS_KEY, { id, cmt, t: ownPosT, rate, paused });
    }

    const known = getSegs(id);
    if (known) {
      if (!(isFinite(cmt) && plan(id, cmt, known, rate, gap, paused))) finish();
      return;
    }
    // Neues Video: Stellen jetzt holen.
    fetchSegments(id, (segs) => {
      let held = false;
      try {
        if (segs && segs.length) {
          status('bereit', `${segs.length === 1 ? '1 Stelle' : `${segs.length} Stellen`} bekannt (${list(segs)}) – Mitteilung kommt, wenn sie läuft`, segs.length);
          if (isFinite(cmt)) held = plan(id, cmt, segs, rate, gap, paused);
        } else if (segs) {
          status('keine-daten', 'Für dieses Video ist nichts eingetragen');
          debug('Keine Sponsor-Daten', 'Für dieses Video ist bei SponsorBlock nichts eingetragen.');
        }
      } finally {
        if (!held) finish();
      }
    });
  }

  // Plant die Mitteilung für die nächste Stelle ab Position p (Sekunden im Video).
  // - Läuft die Stelle schon: sofort melden.
  // - Beginnt sie, bevor das Modul die Meldung loslassen muss: Meldung anhalten und pünktlich melden
  //   (Rückgabe true – dann ruft der Zeitgeber finish() auf).
  // - Altes Modul mit kurzer Haltezeit: wie früher vorab melden, wenn sie vor der nächsten Meldung beginnt.
  function plan(id, p, segs, rate, gap, paused) {
    if (!Array.isArray(segs) || !segs.length) return false;
    const n = readNotified(id);
    // Zurückgespult (deutlich vor eine schon gemeldete Stelle): darf wieder gemeldet werden.
    const back = n.starts.filter((st) => p < st - 20);
    if (back.length) updateNotified(id, (v) => { v.starts = v.starts.filter((st) => !back.includes(st)); });
    const done = n.starts.filter((st) => !back.includes(st));
    const seg = segs.find((x) => p < x.end - 3 && !done.includes(x.start));
    if (!seg) return false;
    if (p >= seg.start - 0.5) { postRunning(id, seg, p, gap); return false; }
    if (paused) return false;
    const elapsed = Date.now() - T0;
    const waitMs = ((seg.start - p) / rate) * 1000 - elapsed - LEAD_MS;
    const budget = cfg.hold * 1000 - elapsed - 700;
    if (waitMs <= budget) {
      if (guard) { clearTimeout(guard); guard = null; }
      status('wartet', `${label(seg)} bei ${fmt(seg.start)} – Mitteilung in ${Math.max(0, Math.round(waitMs / 1000))} s`, 1);
      setTimeout(() => {
        try { fireHeld(id, seg, p, waitMs, gap); } catch (e) { status('fehler', String(e && e.message ? e.message : e).slice(0, 80)); } finally { finish(); }
      }, Math.max(0, waitMs));
      return true;
    }
    if (cfg.hold < 15) {
      const lead = Math.min(15, Math.max(4, gap || 10));
      if (seg.start - p <= lead) postEarly(id, seg, p, gap);
    }
    return false;
  }

  function fireHeld(id, seg, p, waitMs, gap) {
    const pos = readJSON(POS_KEY);
    // Inzwischen kam eine neuere Positions-Meldung (z. B. Pause oder Sprung): die entscheidet selbst.
    if (pos && pos.t > Math.max(T0, ownPosT)) {
      logEvent({ kind: 'übergeben', ...segInfo(seg), p: r1(p), wait: r1(waitMs / 1000) });
      return;
    }
    if (readNotified(id).starts.includes(seg.start)) return;
    markNotified(id, seg.start);
    $notification.post(
      `⏭ ${label(seg)} beginnt jetzt`,
      '',
      `${Math.round(seg.end - seg.start)} s · Tippen = weiter bei ${fmt(seg.end)}`,
      { action: 'open-url', url: jumpUrl(id, seg.end) },
    );
    status('gemeldet', `${label(seg)} bei ${fmt(seg.start)} pünktlich gemeldet (${Math.max(0, Math.round(waitMs / 1000))} s gewartet)`, 1);
    logEvent({ kind: 'pünktlich', ...segInfo(seg), p: r1(p), wait: r1(Math.max(0, waitMs) / 1000), gap: r1(gap) });
  }

  function postRunning(id, seg, p, gap) {
    markNotified(id, seg.start);
    const rest = Math.max(1, Math.round(seg.end - p));
    $notification.post(
      `⏭ ${label(seg)} läuft – noch ${rest} s`,
      '',
      `Tippen = weiter bei ${fmt(seg.end)}`,
      { action: 'open-url', url: jumpUrl(id, seg.end) },
    );
    status('gemeldet', `${label(seg)} bei ${fmt(seg.start)} gemeldet bei Position ${fmt(p)}`, 1);
    logEvent({ kind: 'läuft', ...segInfo(seg), p: r1(p), late: r1(Math.max(0, p - seg.start)), gap: r1(gap) });
  }

  function postEarly(id, seg, p, gap) {
    markNotified(id, seg.start);
    $notification.post(
      `⏭ ${label(seg)} beginnt gleich (bei ${fmt(seg.start)})`,
      '',
      `${Math.round(seg.end - seg.start)} s lang · Tippen, wenn er beginnt = weiter bei ${fmt(seg.end)}`,
      { action: 'open-url', url: jumpUrl(id, seg.end) },
    );
    status('gemeldet', `${label(seg)} bei ${fmt(seg.start)} vorab gemeldet (Position ${fmt(p)})`, 1);
    logEvent({ kind: 'vorab', ...segInfo(seg), p: r1(p), early: r1(seg.start - p), gap: r1(gap) });
  }

  // ---------- A) Video wird geöffnet: Sponsor-Stellen holen und merken ----------
  function handleVideoOpened() {
    let reason = 'Keine Video-Kennung gefunden';
    const id = idFromUrl($request.url) || (() => {
      const b = toBytes($request.body);
      if (!b || !b.length) return null;
      if (b[0] === 0x1f && b[1] === 0x8b) { reason = 'Anfrage ist komprimiert'; return null; }
      return idFromProtobuf(b);
    })();
    if (!id) { status('ohne-video', reason); debug(reason, ''); finish(); return; }

    // Bei /player und /get_watch nicht abfragen, damit der Videostart nicht wartet.
    // Die Stellen holt dann die erste Wiedergabe-Meldung.
    if (!/\/youtubei\/v1\/next/.test($request.url || '')) {
      status('erkannt', 'Video erkannt – Stellen kommen mit der ersten Wiedergabe-Meldung');
      finish();
      return;
    }

    const cached = getSegs(id);
    if (cached) {
      debug('Video schon bekannt', cached.length ? `Stellen: ${list(cached)}` : 'Keine Sponsor-Stellen eingetragen.');
      finish();
      return;
    }

    fetchSegments(id, (segs) => {
      try {
        if (!segs) return;
        if (!segs.length) {
          status('keine-daten', 'Für dieses Video ist nichts eingetragen');
          debug('Keine Sponsor-Daten', 'Für dieses Video ist bei SponsorBlock nichts eingetragen.');
          return;
        }
        // Kommen keine Positions-Meldungen an (z. B. altes Modul ohne Mitlese-Regel),
        // werden die Stellen wie früher gleich beim Start gemeldet. So bleibt es nie still.
        const pos = readJSON(POS_KEY);
        const pingsWork = !!(pos && Date.now() - pos.t < PING_FRESH_MS);
        const nStellen = segs.length === 1 ? '1 Stelle' : `${segs.length} Stellen`;
        if (pingsWork) {
          status('bereit', `${nStellen} bekannt (${list(segs)}) – Mitteilung kommt, wenn sie läuft`, segs.length);
          debug('Sponsor-Wächter bereit', `Stellen: ${list(segs)}. Die Mitteilung kommt, wenn eine davon läuft.`);
        } else {
          status('gemeldet', `${nStellen} beim Start gemeldet (keine Positions-Meldungen – Modul aktualisieren)`, segs.length);
        }
        if (cfg.vorschau || !pingsWork) {
          for (const s of segs.slice(0, 3)) {
            $notification.post(
              `⏭ ${label(s)} bei ${fmt(s.start)}`,
              '',
              `${fmt(s.start)}–${fmt(s.end)} (${Math.round(s.end - s.start)} s) · Tippen = weiter bei ${fmt(s.end)}`,
              { action: 'open-url', url: jumpUrl(id, s.end) },
            );
          }
        }
      } catch (e) {
        status('fehler', String(e && e.message ? e.message : e).slice(0, 80));
        debug('Fehler', String(e && e.message ? e.message : e));
      } finally {
        finish();
      }
    });
  }

  // ---------- Ablauf ----------
  try {
    const isPing = /\/api\/stats\//.test($request.url || '');
    const runs = readJSON(RUNS_KEY) || {};
    runs[isPing ? 'ping' : 'next'] = Date.now();
    runs.v = VERSION;
    writeJSON(RUNS_KEY, runs);
    if (isPing) {
      handleStats($request.url);
    } else {
      handleVideoOpened();
    }
  } catch (e) {
    debug('Fehler', String(e && e.message ? e.message : e));
    finish();
  }
})();
