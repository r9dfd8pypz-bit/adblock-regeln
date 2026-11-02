// Werbefrei-Zentrale: steuert Surge auf diesem iPhone.
// - Surge starten/stoppen über die offiziellen URL-Befehle surge:///start und surge:///stop
//   (funktioniert immer, auch ohne Schnittstelle).
// - Modul, Entschlüsselung und Skripte über Surges HTTP-Schnittstelle auf 127.0.0.1.
(() => {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const DEFAULTS = Object.freeze({
    base: 'https://127.0.0.1:6171',
    key: '',
    module: 'YouTube werbefrei',
    nextdnsId: '',
    demo: false,
  });
  const POLL_MS = 5000;
  const SPONSOR_MODULE = 'YouTube Sponsor-Hinweise';
  const SPONSOR_STATUS_KEY = 'werbefrei.sponsor.status';
  const SPONSOR_DEBUG_KEY = 'werbefrei.sponsor.debug';
  const LOG_MAX = 40;

  // ---------- Speicher (nur auf diesem Gerät) ----------
  const storage = {
    get(key, fallback) {
      try {
        const v = localStorage.getItem('wf.' + key);
        return v === null ? fallback : JSON.parse(v);
      } catch { return fallback; }
    },
    set(key, value) {
      try { localStorage.setItem('wf.' + key, JSON.stringify(value)); } catch { /* z. B. privater Modus */ }
    },
  };

  let settings = { ...DEFAULTS, ...storage.get('settings', {}) };

  // ---------- Verbindung zu Surge ----------
  class ApiError extends Error {
    constructor(kind, status) { super(kind); this.kind = kind; this.status = status; }
  }

  function createSurgeBackend(cfg) {
    const base = String(cfg.base).replace(/\/+$/, '');
    async function call(path, method = 'GET', body) {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 4000);
      const headers = { 'X-Key': cfg.key };
      if (body !== undefined) headers['Content-Type'] = 'application/json';
      let res;
      try {
        res = await fetch(`${base}/v1${path}`, {
          method,
          headers,
          body: body === undefined ? undefined : JSON.stringify(body),
          cache: 'no-store',
          signal: ctrl.signal,
        });
      } catch {
        throw new ApiError('offline');
      } finally {
        clearTimeout(timer);
      }
      if (res.status === 401 || res.status === 403) throw new ApiError('auth', res.status);
      if (!res.ok) throw new ApiError('http', res.status);
      const text = await res.text();
      try { return text ? JSON.parse(text) : {}; } catch { return {}; }
    }
    return {
      demo: false,
      async status() {
        const [modules, mitm, scripting] = await Promise.all([
          call('/modules'), call('/features/mitm'), call('/features/scripting'),
        ]);
        return {
          enabled: Array.isArray(modules.enabled) ? modules.enabled : [],
          available: Array.isArray(modules.available) ? modules.available : [],
          mitm: mitm.enabled === true,
          scripting: scripting.enabled === true,
        };
      },
      setModule: (name, on) => call('/modules', 'POST', { [name]: on }),
      setFeature: (feature, on) => call(`/features/${feature}`, 'POST', { enabled: on }),
      reloadProfile: () => call('/profiles/reload', 'POST'),
      flushDns: () => call('/dns/flush', 'POST'),
      recentRequests: () => call('/requests/recent'),
      // Führt ein kleines Skript in Surge aus (für Status, Testmodus, Testmitteilung).
      evaluate: (code) => call('/scripting/evaluate', 'POST', { script_text: code, mock_type: 'cron', timeout: 5 }),
    };
  }

  // Demo: verhält sich wie Surge, ohne dass Surge installiert sein muss.
  function createDemoBackend(cfg) {
    const s = storage.get('demo', { running: true, enabled: [cfg.module], mitm: true, scripting: true });
    const save = () => storage.set('demo', s);
    const wait = () => new Promise((r) => setTimeout(r, 300));
    return {
      demo: true,
      async status() {
        await wait();
        if (!s.running) throw new ApiError('offline');
        return { enabled: [...s.enabled], available: [cfg.module, SPONSOR_MODULE], mitm: s.mitm, scripting: s.scripting };
      },
      async setModule(name, on) {
        await wait();
        s.enabled = on ? [...new Set([...s.enabled, name])] : s.enabled.filter((n) => n !== name);
        save();
      },
      async setFeature(feature, on) { await wait(); s[feature] = on; save(); },
      async reloadProfile() { await wait(); },
      async flushDns() { await wait(); },
      async recentRequests() {
        await wait();
        // Nur Beispieldaten für den Demo-Modus; die App ruft diese Adressen nie selbst auf.
        const demoUrl = (host, path) => `https:/${'/'}${host}${path}`;
        return { requests: [
          { URL: demoUrl('youtubei.googleapis.com', '/youtubei/v1/browse'), modified: true, notes: ['[Script] youtube.response: OK'], rule: 'FINAL', policyName: 'DIRECT' },
          { URL: demoUrl('youtubei.googleapis.com', '/youtubei/v1/player'), modified: true, notes: [], rule: 'FINAL', policyName: 'DIRECT' },
          { URL: demoUrl('rr1---sn-demo.googlevideo.com', '/initplayback?ack=1'), modified: true, notes: ['[Map Local] Mapped'], rule: 'FINAL', policyName: 'DIRECT' },
        ] };
      },
      async evaluate(code) {
        await wait();
        const m = /write\("(true|false)"/.exec(code);
        if (m) { s.sponsorDebug = m[1]; save(); }
        return { result: {
          status: JSON.stringify({ t: Date.now() - 90000, step: 'gemeldet', text: '2 Stellen gemeldet', count: 2 }),
          debug: s.sponsorDebug || 'false',
        } };
      },
      setRunning(on) { s.running = on; save(); },
    };
  }

  const makeBackend = (cfg) => (cfg.demo ? createDemoBackend(cfg) : createSurgeBackend(cfg));
  let backend = makeBackend(settings);

  // ---------- Zustand ----------
  const state = { reach: 'unknown', status: null, busy: new Set() };
  let refreshing = null;

  function refresh() {
    if (!settings.demo && !settings.key) {
      state.reach = 'setup';
      state.status = null;
      render();
      return Promise.resolve();
    }
    if (refreshing) return refreshing;
    refreshing = (async () => {
      try {
        state.status = await backend.status();
        state.reach = 'ok';
        state.sponsor = state.status.available.includes(SPONSOR_MODULE) ? await readSponsor().catch(() => null) : null;
        if (!settings.demo) storage.set('everConnected', true);
      } catch (e) {
        state.status = null;
        state.reach = e && e.kind === 'auth' ? 'auth' : 'offline';
      } finally {
        refreshing = null;
        render();
      }
    })();
    return refreshing;
  }

  // ---------- Anzeige ----------
  const MARKS = { ok: '#i-check', warn: '#i-pause', bad: '#i-cross', idle: '#i-dots' };

  function setSwitch(el, on, disabled, busy) {
    el.setAttribute('aria-checked', on ? 'true' : 'false');
    el.disabled = !!disabled;
    if (busy) el.setAttribute('aria-busy', 'true'); else el.removeAttribute('aria-busy');
  }

  function render() {
    const st = state.status;
    const running = state.reach === 'ok';
    const moduleKnown = !!st && st.available.includes(settings.module);
    const moduleOn = !!st && st.enabled.includes(settings.module);
    const busy = (k) => state.busy.has(k);

    setSwitch($('sw-surge'), running, busy('surge'), busy('surge'));
    setSwitch($('sw-module'), moduleOn, !running || !moduleKnown || busy('module') || busy('all'), busy('module'));
    setSwitch($('sw-mitm'), !!(st && st.mitm), !running || busy('mitm') || busy('all'), busy('mitm'));
    setSwitch($('sw-scripting'), !!(st && st.scripting), !running || busy('scripting') || busy('all'), busy('scripting'));
    for (const id of ['btn-pause', 'btn-resume', 'btn-reload', 'btn-flush']) $(id).disabled = !running || busy('all');

    const sponsorKnown = !!st && st.available.includes(SPONSOR_MODULE);
    const sponsorOn = !!st && st.enabled.includes(SPONSOR_MODULE);
    setSwitch($('sw-sponsor'), sponsorOn, !running || busy('sponsor') || busy('all'), busy('sponsor'));
    $('sw-sponsor').hidden = !!st && !sponsorKnown;
    $('sponsor-install').hidden = !(st && !sponsorKnown);
    $('sponsor-sub').textContent = st && !sponsorKnown
      ? 'Noch nicht in Surge installiert'
      : sponsorOn && state.sponsor
        ? describeSponsor(state.sponsor)
        : 'Mitteilung bei Influencer-Werbung, antippen = überspringen';

    $('module-sub').textContent = st && !moduleKnown
      ? `Modul „${settings.module}“ ist in Surge nicht installiert`
      : 'Werbung in der YouTube-App entfernen';

    const everConnected = storage.get('everConnected', false);
    let level = 'idle';
    let title = 'Verbinde …';
    let text = '';
    let showSetup = false;
    if (state.reach === 'setup') {
      title = 'Einrichtung nötig';
      text = 'Einmal die Verbindung zu Surge einrichten. „Alles sofort stoppen“ funktioniert auch ohne.';
      showSetup = true;
    } else if (state.reach === 'auth') {
      level = 'bad';
      title = 'Schlüssel passt nicht';
      text = 'Der Schlüssel in den Einstellungen stimmt nicht mit dem im Surge-Profil überein.';
      showSetup = true;
    } else if (state.reach === 'offline') {
      title = 'Surge ist aus';
      text = everConnected || settings.demo
        ? 'Dein iPhone läuft ganz normal, ohne Filter.'
        : 'Oder die Schnittstelle ist noch nicht im Surge-Profil eingetragen.';
      showSetup = !everConnected && !settings.demo;
    } else if (state.reach === 'ok') {
      const off = [
        !moduleOn && 'YouTube-Modul',
        !st.mitm && 'Entschlüsselung',
        !st.scripting && 'Skripte',
      ].filter(Boolean);
      if (off.length === 0) {
        level = 'ok';
        title = 'Schutz aktiv';
        text = 'YouTube wird gefiltert. NextDNS sperrt Werbe-Domains.';
      } else if (off.length === 3) {
        level = 'warn';
        title = 'Pausiert';
        text = 'Surge läuft, filtert aber nichts.';
      } else {
        level = 'warn';
        title = 'Teilweise aktiv';
        text = `Aus: ${off.join(', ')}. YouTube-Werbung kommt durch.`;
      }
    }

    document.documentElement.dataset.level = level;
    $('status-card').dataset.level = level;
    $('status-mark').firstElementChild.setAttribute('href', MARKS[level]);
    $('status-title').textContent = title;
    $('status-text').textContent = text;
    $('btn-setup').hidden = !showSetup;

    let host = settings.base;
    try { host = new URL(settings.base).host; } catch { /* Anzeige wie eingegeben */ }
    $('sb-conn').textContent = settings.demo
      ? 'Demo-Modus'
      : running ? `Verbunden · ${host}` : 'Nicht verbunden';

    const dnsLink = $('link-dns');
    dnsLink.href = settings.nextdnsId
      ? `https://my.nextdns.io/${encodeURIComponent(settings.nextdnsId)}/logs`
      : 'https://my.nextdns.io';
  }

  // ---------- Ereignisprotokoll ----------
  let entries = storage.get('log', []);
  function log(text, level = 'info') {
    entries.unshift({ t: Date.now(), text, level });
    entries = entries.slice(0, LOG_MAX);
    storage.set('log', entries);
    renderLog();
  }
  function renderLog() {
    const ol = $('log');
    if (!entries.length) {
      const li = document.createElement('li');
      li.className = 'empty';
      li.textContent = 'Noch keine Ereignisse.';
      ol.replaceChildren(li);
      return;
    }
    ol.replaceChildren(...entries.map((e) => {
      const li = document.createElement('li');
      li.dataset.level = e.level;
      const time = document.createElement('time');
      time.dateTime = new Date(e.t).toISOString();
      time.textContent = new Date(e.t).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
      const span = document.createElement('span');
      span.textContent = e.text;
      li.append(time, span);
      return li;
    }));
  }

  // ---------- Sprechblase ----------
  let balloonTimer;
  function balloon(title, text, level = 'info') {
    const b = $('balloon');
    // Ist ein Dialog offen, muss die Sprechblase in den Dialog, sonst liegt sie dahinter.
    const host = document.querySelector('dialog[open]') || document.body;
    if (b.parentElement !== host) host.appendChild(b);
    $('balloon-title').textContent = title;
    $('balloon-text').textContent = text;
    b.dataset.level = level;
    b.hidden = false;
    clearTimeout(balloonTimer);
    balloonTimer = setTimeout(() => { b.hidden = true; }, 5000);
  }

  function errorText(e) {
    if (!e || !e.kind) return 'Unbekannter Fehler.';
    if (e.kind === 'auth') return 'Surge hat den Schlüssel abgelehnt.';
    if (e.kind === 'offline') return 'Surge ist nicht erreichbar. Läuft Surge?';
    return `Surge hat mit Fehler ${e.status} geantwortet.`;
  }

  async function act(busyKey, task, okTitle, okText) {
    if (state.busy.size) return;
    state.busy.add(busyKey);
    render();
    try {
      await task();
      log(okTitle);
      balloon(okTitle, okText);
    } catch (e) {
      const msg = errorText(e);
      log(`Fehler: ${msg}`, 'bad');
      balloon('Hat nicht geklappt', msg, 'bad');
    } finally {
      state.busy.delete(busyKey);
      await refresh();
    }
  }

  // ---------- Surge starten / stoppen ----------
  function openSurge(action) {
    const stop = action === 'stop';
    log(stop ? 'Surge wird gestoppt' : 'Surge wird gestartet');
    if (backend.demo) {
      backend.setRunning(!stop);
      balloon(stop ? 'Surge gestoppt' : 'Surge gestartet', stop ? 'Demo: Alles läuft wieder ohne Filter.' : 'Demo: Der Schutz ist wieder aktiv.');
      refresh();
      return;
    }
    // Ohne autoclose: Surge bleibt offen, und oben links erscheint „◀ Werbefrei“ für den Rückweg.
    const url = `surge:///${stop ? 'stop' : 'start'}`;
    window.__letzteExterneUrl = url;
    balloon(stop ? 'Surge wird gestoppt' : 'Surge wird gestartet', 'Surge öffnet sich. Zurück hierher: oben links auf „◀ Werbefrei“ tippen.');
    window.location.href = url;
    setTimeout(refresh, 2000);
  }

  // ---------- NextDNS ----------
  function setDns(level, title, text) {
    $('dns-led').dataset.level = level;
    $('dns-title').textContent = title;
    $('dns-text').textContent = text;
  }
  async function checkNextDns(announce) {
    const result = await runNextDnsCheck();
    if (announce) {
      if (result === 'ok') balloon('NextDNS aktiv', 'Dieses iPhone nutzt NextDNS.');
      else if (result === 'bad') balloon('NextDNS nicht aktiv', 'Profil prüfen: Einstellungen → Allgemein → VPN und Geräteverwaltung → DNS.', 'bad');
      else balloon('Status nicht abrufbar', 'Bitte die Testseite öffnen. Dort muss "status": "ok" stehen.');
    }
    return result;
  }
  async function runNextDnsCheck() {
    setDns('idle', 'Prüfe …', '');
    if (settings.demo) {
      await new Promise((r) => setTimeout(r, 400));
      setDns('ok', 'NextDNS aktiv', 'Demo · DOH · iPhone');
      return 'ok';
    }
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 6000);
    try {
      const res = await fetch('https://test.nextdns.io/', { cache: 'no-store', signal: ctrl.signal });
      const data = await res.json();
      if (data.status === 'ok') {
        setDns('ok', 'NextDNS aktiv', [data.protocol, data.deviceName, data.profile && `Profil ${data.profile}`].filter(Boolean).join(' · ') || 'Dieses iPhone nutzt NextDNS.');
        log('NextDNS geprüft: aktiv');
        return 'ok';
      }
      setDns('bad', 'NextDNS nicht aktiv', 'Dieses iPhone nutzt gerade nicht NextDNS.');
      log('NextDNS geprüft: nicht aktiv', 'bad');
      return 'bad';
    } catch {
      setDns('idle', 'Status nicht abrufbar', 'Tippe auf „Testseite“, um es im Browser zu prüfen.');
      return 'unknown';
    } finally {
      clearTimeout(timer);
    }
  }

  // ---------- Design ----------
  const THEMES = ['auto', 'light', 'dark'];
  const THEME_NAMES = { auto: 'Automatisch', light: 'Hell', dark: 'Dunkel' };
  function currentTheme() {
    try { return THEMES.includes(localStorage.getItem('wf.theme')) ? localStorage.getItem('wf.theme') : 'auto'; } catch { return 'auto'; }
  }
  function applyTheme(t, announce) {
    const root = document.documentElement;
    if (t === 'auto') delete root.dataset.theme; else root.dataset.theme = t;
    try { localStorage.setItem('wf.theme', t); } catch { /* egal */ }
    const dark = t === 'dark' || (t === 'auto' && window.matchMedia('(prefers-color-scheme: dark)').matches);
    document.querySelector('meta[name="theme-color"]').content = dark ? '#000000' : '#f2f2f7';
    for (const b of document.querySelectorAll('[data-theme-choice]')) {
      b.setAttribute('aria-pressed', String(b.dataset.themeChoice === t));
    }
    if (announce) balloon(`Design: ${THEME_NAMES[t]}`, t === 'auto' ? 'Folgt dem Hell-/Dunkelmodus des iPhones.' : 'Bleibt so, bis du es änderst.');
  }

  // ---------- Einstellungen ----------
  const KEY_CHARS = 'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  function generateKey() {
    const bytes = new Uint8Array(20);
    crypto.getRandomValues(bytes);
    return Array.from(bytes, (b) => KEY_CHARS[b % KEY_CHARS.length]).join('');
  }
  function surgeLines(base, key) {
    let u;
    try { u = new URL(base); } catch { return '# Die Adresse ist ungültig.'; }
    const port = u.port || (u.protocol === 'https:' ? '443' : '80');
    return `http-api = ${key || 'SCHLUESSEL'}@${u.hostname}:${port}\nhttp-api-tls = ${u.protocol === 'https:'}`;
  }
  function readForm() {
    return {
      base: $('f-base').value.trim() || DEFAULTS.base,
      key: $('f-key').value.trim(),
      module: $('f-module').value.trim() || DEFAULTS.module,
      nextdnsId: $('f-nextdns').value.trim(),
      demo: $('f-demo').checked,
    };
  }
  function updateLines() {
    const f = readForm();
    $('f-lines').textContent = surgeLines(f.base, f.key);
  }
  function validate(f) {
    if (!f.demo) {
      let u;
      try { u = new URL(f.base); } catch { return 'Die Adresse ist ungültig.'; }
      if (!/^https?:$/.test(u.protocol)) return 'Die Adresse muss mit https:// oder http:// beginnen.';
      if (!/^[A-Za-z0-9]{8,}$/.test(f.key)) return 'Der Schlüssel braucht mindestens 8 Buchstaben oder Ziffern (ohne Sonderzeichen).';
    }
    if (f.nextdnsId && !/^[a-z0-9]{4,12}$/i.test(f.nextdnsId)) return 'Die NextDNS-ID besteht nur aus Buchstaben und Ziffern.';
    return '';
  }
  function openSettings() {
    $('f-base').value = settings.base;
    $('f-key').value = settings.key || generateKey();
    $('f-module').value = settings.module;
    $('f-nextdns').value = settings.nextdnsId;
    $('f-demo').checked = settings.demo;
    updateLines();
    $('dlg-settings').showModal();
  }
  async function copyText(text) {
    try {
      await navigator.clipboard.writeText(text);
      balloon('Kopiert', 'Der Text ist in der Zwischenablage.');
    } catch {
      balloon('Kopieren nicht möglich', 'Bitte den Text antippen, markieren und manuell kopieren.', 'bad');
    }
  }

  // ---------- YouTube-Diagnose ----------
  // Wertet Surges Liste der letzten Anfragen aus: Wird YouTube entschlüsselt, läuft das Skript,
  // greift die lokale Antwort auf initplayback? Abfrage-Parameter werden aus dem Bericht entfernt.
  const shortUrl = (u) => String(u || '').split('?')[0].replace(/^https?:\/\//, '');
  function analyse(st, recent) {
    const reqs = Array.isArray(recent && recent.requests) ? recent.requests : [];
    const yt = reqs.filter((r) => /youtubei\.googleapis\.com/.test(r.URL || ''));
    const decrypted = yt.filter((r) => /^https?:\/\/youtubei\.googleapis\.com\//.test(r.URL));
    const scripted = decrypted.filter((r) => r.modified || (r.notes || []).some((n) => /script|youtube\.response/i.test(n)));
    const video = reqs.filter((r) => /googlevideo\.com/.test(r.URL || ''));
    const init = video.filter((r) => /\/initplayback/.test(r.URL || ''));
    const initLocal = init.filter((r) => r.modified || (r.notes || []).some((n) => /map local|mock/i.test(n)));
    const notes = [];
    for (const r of [...yt, ...video]) {
      for (const n of r.notes || []) {
        if (/mitm|script|error|fail|reject|certificate|quic|map local/i.test(n) && !notes.includes(n)) notes.push(n);
      }
    }
    return {
      moduleOn: st.enabled.includes(settings.module),
      moduleKnown: st.available.includes(settings.module),
      sponsorOn: st.enabled.includes(SPONSOR_MODULE),
      sponsorKnown: st.available.includes(SPONSOR_MODULE),
      mitm: st.mitm, scripting: st.scripting,
      total: reqs.length, yt: yt.length, decrypted: decrypted.length, scripted: scripted.length,
      video: video.length, init: init.length, initLocal: initLocal.length,
      notes: notes.slice(0, 10),
      samples: yt.slice(0, 5).map((r) => `${shortUrl(r.URL)} · ${r.rule || '?'} · ${r.policyName || '?'}${r.failed ? ' · FEHLER' : ''}`),
    };
  }
  function verdict(a) {
    if (!a.moduleKnown) return 'Das Modul ist in Surge nicht installiert (Assistent, Schritt 5).';
    if (!a.moduleOn) return 'Das Modul ist installiert, aber ausgeschaltet.';
    if (!a.mitm) return 'Die HTTPS-Entschlüsselung (MitM) ist aus.';
    if (!a.scripting) return 'Skripte sind in Surge ausgeschaltet.';
    if (a.yt === 0) return 'Keine YouTube-Anfragen gefunden. Erst YouTube benutzen, dann neu prüfen.';
    if (a.decrypted === 0) return 'YouTube wird NICHT entschlüsselt. Zertifikat, MitM-Hostnamen oder QUIC prüfen.';
    if (a.scripted === 0) return 'YouTube wird entschlüsselt, aber das Skript verändert nichts.';
    return 'Entschlüsselung und Skript laufen.';
  }
  function report(a) {
    const yn = (b) => (b ? 'an ✅' : 'aus ❌');
    const time = new Date().toLocaleString('de-DE');
    return [
      `YouTube-Diagnose · ${time}`,
      `Ergebnis: ${verdict(a)}`,
      `Modul „${settings.module}“: ${a.moduleKnown ? yn(a.moduleOn) : 'nicht installiert ❌'}`,
      `MitM: ${yn(a.mitm)} · Skripte: ${yn(a.scripting)}`,
      `Sponsor-Hinweise: ${a.sponsorKnown ? (a.sponsorOn ? 'an' : 'aus') : 'nicht installiert'}`,
      `Letzte Anfragen gesamt: ${a.total}`,
      `YouTube-API: ${a.yt} · entschlüsselt: ${a.decrypted} · vom Skript verändert: ${a.scripted}`,
      `Video-Server: ${a.video} · initplayback: ${a.init} · davon lokal beantwortet: ${a.initLocal}`,
      a.notes.length ? `Hinweise von Surge:\n${a.notes.map((n) => `  - ${n}`).join('\n')}` : 'Hinweise von Surge: keine',
      a.samples.length ? `Beispiele:\n${a.samples.map((s) => `  - ${s}`).join('\n')}` : '',
    ].filter(Boolean).join('\n');
  }
  let lastReport = '';
  async function runDiagnosis() {
    const out = $('diag-out');
    out.hidden = false;
    out.textContent = 'Prüfe …';
    $('btn-diag').disabled = true;
    try {
      const [st, recent] = await Promise.all([backend.status(), backend.recentRequests()]);
      const a = analyse(st, recent);
      lastReport = report(a);
      out.textContent = lastReport;
      $('btn-diag-copy').disabled = false;
      log(`Diagnose: ${verdict(a)}`, a.scripted > 0 ? 'info' : 'bad');
    } catch (e) {
      lastReport = '';
      out.textContent = `Diagnose nicht möglich: ${errorText(e)}`;
      $('btn-diag-copy').disabled = true;
    } finally {
      $('btn-diag').disabled = false;
    }
  }

  // ---------- Sponsor-Hinweise prüfen ----------
  async function readSponsor() {
    const code = `$done({ status: $persistentStore.read(${JSON.stringify(SPONSOR_STATUS_KEY)}), debug: $persistentStore.read(${JSON.stringify(SPONSOR_DEBUG_KEY)}) });`;
    const res = await backend.evaluate(code);
    const r = (res && res.result) || {};
    let last = null;
    try { last = r.status ? JSON.parse(r.status) : null; } catch { last = null; }
    return { last, debug: r.debug === 'true' };
  }
  function describeSponsor(sp) {
    if (!sp || !sp.last) return 'Noch kein Video geprüft';
    const time = new Date(sp.last.t).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
    return `Zuletzt ${time}: ${sp.last.text}`;
  }
  async function fillSponsorSheet() {
    const st = state.status;
    const known = !!st && st.available.includes(SPONSOR_MODULE);
    const on = !!st && st.enabled.includes(SPONSOR_MODULE);
    $('sp-module').textContent = !st ? 'Surge nicht verbunden' : !known ? 'nicht installiert' : on ? 'an' : 'aus';
    if (!st) { $('sp-last').textContent = '–'; return; }
    $('sp-last').textContent = 'Lade …';
    const stand = () => `(Stand ${new Date().toLocaleTimeString('de-DE')})`;
    try {
      state.sponsor = await readSponsor();
      $('sp-last').textContent = `${describeSponsor(state.sponsor)} ${stand()}`;
      $('sp-debug').checked = state.sponsor.debug;
    } catch (e) {
      $('sp-last').textContent = `Nicht lesbar: ${errorText(e)} ${stand()}`;
    }
  }
  function openSponsor() {
    $('dlg-sponsor').showModal();
    fillSponsorSheet();
  }

  // ---------- Einrichtungs-Assistent ----------
  let setupDone = storage.get('setupDone', {});
  const NEXTDNS_ID = /^[a-z0-9]{4,12}$/i;

  function ensureKey() {
    if (settings.demo || settings.key) return;
    settings = { ...settings, key: generateKey() };
    storage.set('settings', settings);
    backend = makeBackend(settings);
  }
  function setupLines() {
    const dns = NEXTDNS_ID.test(settings.nextdnsId)
      ? `encrypted-dns-server = https://dns.nextdns.io/${settings.nextdnsId}/Surge-iPhone`
      : '# Zuerst in Schritt 1 deine NextDNS-ID eintragen';
    return `${dns}\n${surgeLines(settings.base, settings.key)}`;
  }
  function renderSetup() {
    const steps = [...document.querySelectorAll('#setup-steps .step')];
    let done = 0;
    for (const li of steps) {
      const isDone = !!setupDone[li.dataset.step];
      li.querySelector('.step-check input').checked = isDone;
      li.classList.toggle('done', isDone);
      if (isDone) done++;
    }
    $('setup-progress').textContent = `${done} von ${steps.length} Schritten erledigt`;
    $('setup-bar').style.width = `${Math.round((done / steps.length) * 100)}%`;
    $('s-lines').textContent = setupLines();
  }
  function openSetup() {
    ensureKey();
    $('s-nextdns').value = settings.nextdnsId;
    renderSetup();
    $('dlg-setup').showModal();
    refresh();
  }
  // Öffnet die Schnittstelle direkt im Browser. Was dort erscheint, zeigt die Ursache:
  // Text mit { … } = Schnittstelle läuft · Zertifikatswarnung = Zertifikat nicht vertraut ·
  // „Seite kann nicht geöffnet werden“ = Schnittstelle läuft nicht.
  function probeInBrowser(cfg) {
    const url = `${String(cfg.base).replace(/\/+$/, '')}/v1/modules?x-key=${encodeURIComponent(cfg.key)}`;
    window.__letzteExterneUrl = url;
    window.open(url, '_blank', 'noopener');
  }
  async function testConnection(cfg) {
    balloon('Teste …', 'Verbinde mit Surge.');
    try {
      const st = await makeBackend(cfg).status();
      const found = st.available.includes(cfg.module);
      balloon('Verbindung klappt', found ? `Modul „${cfg.module}“ gefunden.` : `Verbunden, aber Modul „${cfg.module}“ fehlt in Surge.`, found ? 'info' : 'bad');
      return true;
    } catch (e) {
      balloon('Keine Verbindung', `${errorText(e)} Tippe auf „Im Browser prüfen“, dann sehen wir, woran es liegt.`, 'bad');
      return false;
    }
  }

  // ---------- Ereignisse verdrahten ----------
  function wire() {
    $('sw-surge').addEventListener('click', () => {
      openSurge($('sw-surge').getAttribute('aria-checked') === 'true' ? 'stop' : 'start');
    });
    $('btn-notaus').addEventListener('click', () => openSurge('stop'));

    $('sw-module').addEventListener('click', () => {
      const on = $('sw-module').getAttribute('aria-checked') !== 'true';
      act('module', () => backend.setModule(settings.module, on),
        on ? 'YouTube-Modul eingeschaltet' : 'YouTube-Modul ausgeschaltet',
        on ? 'Die YouTube-App einmal ganz schließen und neu öffnen.' : 'YouTube läuft wieder ganz normal.');
    });
    $('sw-mitm').addEventListener('click', () => {
      const on = $('sw-mitm').getAttribute('aria-checked') !== 'true';
      act('mitm', () => backend.setFeature('mitm', on),
        on ? 'Entschlüsselung eingeschaltet' : 'Entschlüsselung ausgeschaltet',
        on ? 'Gilt nur für die YouTube-Adressen aus dem Modul.' : 'Surge entschlüsselt jetzt gar nichts mehr.');
    });
    $('sw-scripting').addEventListener('click', () => {
      const on = $('sw-scripting').getAttribute('aria-checked') !== 'true';
      act('scripting', () => backend.setFeature('scripting', on),
        on ? 'Skripte eingeschaltet' : 'Skripte ausgeschaltet',
        on ? 'Die Werbung wird wieder aus den Antworten gelöscht.' : 'Antworten werden nicht mehr verändert.');
    });

    $('sw-sponsor').addEventListener('click', () => {
      const on = $('sw-sponsor').getAttribute('aria-checked') !== 'true';
      act('sponsor', () => backend.setModule(SPONSOR_MODULE, on),
        on ? 'Sponsor-Hinweise eingeschaltet' : 'Sponsor-Hinweise ausgeschaltet',
        on ? 'Beim nächsten Video mit SponsorBlock-Eintrag kommt eine Mitteilung.' : 'Es kommen keine Sponsor-Mitteilungen mehr.');
    });
    $('sp-debug').addEventListener('change', async () => {
      const on = $('sp-debug').checked;
      try {
        await backend.evaluate(`$persistentStore.write(${JSON.stringify(on ? 'true' : 'false')}, ${JSON.stringify(SPONSOR_DEBUG_KEY)}); $done({});`);
        log(on ? 'Sponsor-Testmodus an' : 'Sponsor-Testmodus aus');
        balloon(on ? 'Testmodus an' : 'Testmodus aus', on ? 'Jetzt kommt bei jedem Video eine Mitteilung mit dem Ergebnis.' : 'Mitteilungen nur noch, wenn Sponsor-Stellen gefunden werden.');
      } catch (e) {
        $('sp-debug').checked = !on;
        balloon('Hat nicht geklappt', errorText(e), 'bad');
      }
    });
    $('btn-sp-test').addEventListener('click', async () => {
      try {
        await backend.evaluate("$notification.post('Werbefrei', 'Testmitteilung', 'Wenn du das siehst, können Sponsor-Hinweise angezeigt werden.'); $done({});");
        balloon('Testmitteilung gesendet', 'Kommt keine Mitteilung: In Surge unten auf der Startseite Mitteilungen erlauben.');
      } catch (e) {
        balloon('Hat nicht geklappt', errorText(e), 'bad');
      }
    });
    $('btn-sp-refresh').addEventListener('click', fillSponsorSheet);
    $('btn-pause').addEventListener('click', () => act('all', async () => {
      if (state.status && state.status.available.includes(settings.module)) await backend.setModule(settings.module, false);
      await backend.setFeature('mitm', false);
      await backend.setFeature('scripting', false);
    }, 'Alles pausiert', 'Surge läuft weiter, filtert aber nichts.'));
    $('btn-resume').addEventListener('click', () => act('all', async () => {
      await backend.setFeature('mitm', true);
      await backend.setFeature('scripting', true);
      if (state.status && state.status.available.includes(settings.module)) await backend.setModule(settings.module, true);
    }, 'Alles eingeschaltet', 'Die YouTube-App einmal ganz schließen und neu öffnen.'));

    $('btn-reload').addEventListener('click', () => act('all', () => backend.reloadProfile(),
      'Profil neu geladen', 'Surge hat Profil und Module neu eingelesen.'));
    $('btn-flush').addEventListener('click', () => act('all', () => backend.flushDns(),
      'DNS-Cache geleert', 'Neue Anfragen gehen wieder frisch an NextDNS.'));

    $('btn-dns-check').addEventListener('click', () => checkNextDns(false));
    $('btn-diag').addEventListener('click', runDiagnosis);
    $('btn-diag-copy').addEventListener('click', () => { if (lastReport) copyText(lastReport); });
    $('btn-setup').addEventListener('click', () => (state.reach === 'auth' ? openSettings() : openSetup()));

    $('setup-steps').addEventListener('change', (e) => {
      const li = e.target.closest('.step');
      if (!li || !e.target.matches('.step-check input')) return;
      setupDone = { ...setupDone, [li.dataset.step]: e.target.checked };
      storage.set('setupDone', setupDone);
      renderSetup();
    });
    $('s-nextdns').addEventListener('input', () => {
      const v = $('s-nextdns').value.trim().toLowerCase();
      if (v === '' || NEXTDNS_ID.test(v)) {
        settings = { ...settings, nextdnsId: v };
        storage.set('settings', settings);
        $('s-lines').textContent = setupLines();
        render();
      }
    });
    $('setup-steps').addEventListener('click', (e) => {
      const btn = e.target.closest('[data-setup]');
      if (!btn) return;
      const what = btn.dataset.setup;
      if (what === 'dns-check') checkNextDns(true);
      else if (what === 'copy') copyText(setupLines());
      else if (what === 'start') openSurge('start');
      else if (what === 'test') testConnection(settings).then(() => refresh());
      else if (what === 'probe') probeInBrowser(settings);
    });
    $('btn-help').addEventListener('click', () => $('dlg-help').showModal());
    // Zeilen mit data-action öffnen Blätter
    document.addEventListener('click', (e) => {
      const item = e.target.closest('[data-action]');
      if (!item) return;
      const action = item.dataset.action;
      if (action === 'setup') openSetup();
      else if (action === 'settings') openSettings();
      else if (action === 'help') $('dlg-help').showModal();
      else if (action === 'log') { renderLog(); $('dlg-log').showModal(); }
      else if (action === 'diag') { $('dlg-diag').showModal(); runDiagnosis(); }
      else if (action === 'sponsor') openSponsor();
    });
    for (const b of document.querySelectorAll('[data-theme-choice]')) {
      b.addEventListener('click', () => applyTheme(b.dataset.themeChoice, true));
    }

    for (const dlg of document.querySelectorAll('dialog')) {
      dlg.addEventListener('click', (e) => {
        if (e.target.closest('[data-close]')) dlg.close();
      });
      dlg.addEventListener('close', () => {
        const b = $('balloon');
        if (dlg.contains(b)) document.body.appendChild(b);
      });
    }

    for (const id of ['f-base', 'f-key']) $(id).addEventListener('input', updateLines);
    $('btn-genkey').addEventListener('click', () => { $('f-key').value = generateKey(); updateLines(); });
    $('btn-copy').addEventListener('click', () => copyText($('f-lines').textContent));
    $('btn-probe').addEventListener('click', () => probeInBrowser(readForm()));
    $('btn-cert').addEventListener('click', () => {
      const f = readForm();
      const url = `${f.base.replace(/\/+$/, '')}/v1/mitm/ca?x-key=${encodeURIComponent(f.key)}`;
      window.open(url, '_blank', 'noopener');
    });
    $('btn-test').addEventListener('click', async () => {
      const f = readForm();
      const problem = validate(f);
      if (problem) { balloon('Bitte prüfen', problem, 'bad'); return; }
      await testConnection(f);
    });
    $('form-settings').addEventListener('submit', (e) => {
      const f = readForm();
      const problem = validate(f);
      if (problem) { e.preventDefault(); balloon('Bitte prüfen', problem, 'bad'); return; }
      const demoChanged = f.demo !== settings.demo;
      settings = f;
      storage.set('settings', settings);
      backend = makeBackend(settings);
      log(demoChanged ? (settings.demo ? 'Demo-Modus eingeschaltet' : 'Demo-Modus ausgeschaltet') : 'Einstellungen gespeichert');
      refresh();
    });

    $('balloon-close').addEventListener('click', () => { $('balloon').hidden = true; });

    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') refresh();
    });
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => applyTheme(currentTheme(), false));
  }

  // ---------- Start ----------
  wire();
  applyTheme(currentTheme(), false);
  renderLog();
  refresh();
  setInterval(() => { if (document.visibilityState === 'visible') refresh(); }, POLL_MS);

  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
    // Kommt eine neue Version an, einmal neu laden, damit sie sofort sichtbar ist.
    const hadController = !!navigator.serviceWorker.controller;
    let reloaded = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (!hadController || reloaded) return;
      reloaded = true;
      window.location.reload();
    });
    navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' }).then((reg) => {
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') reg.update().catch(() => {});
      });
    }).catch(() => { /* ohne Offline-Modus weiter */ });
  }
})();
