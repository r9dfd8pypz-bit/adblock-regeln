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
  // Die Sponsor-Hinweise wurden entfernt (16.11.2026). Ist das Modul noch eingeschaltet, schaltet die
  // App es einmal aus und räumt seine Daten in Surge weg (siehe retireSponsor).
  const SPONSOR_MODULE = 'YouTube Sponsor-Hinweise';
  // Ab Modul v2 (25.11.2026) filtert youtube.init.js/youtube.ump.js den Video-Start. Daran erkennt die App die Fassung.
  const MODULE_V2_RULE = 'youtube.init.anfrage';
  const INIT_STATS_KEY = 'werbefrei.init.stats';
  const SPONSOR_KEYS = ['status', 'debug', 'segments', 'pos', 'runs', 'pings', 'link', 'log', 'notified', 'segcache'].map((k) => `werbefrei.sponsor.${k}`);
  const YT_SCRIPT_URL = 'https://raw.githubusercontent.com/r9dfd8pypz-bit/adblock-regeln/main/scripts/youtube/youtube.response.js';
  // Welcher Stand des YouTube-Skripts liegt online? (z. B. „werbefrei-5“, null wenn nicht abrufbar)
  async function onlineFeedVersion() {
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 5000);
      const res = await fetch(YT_SCRIPT_URL, { cache: 'no-store', signal: ctrl.signal });
      clearTimeout(timer);
      const m = /WfVer="(werbefrei-\d+)"/.exec(await res.text());
      return m ? m[1] : null;
    } catch { return null; }
  }
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
    async function call(path, method = 'GET', body, timeoutMs = 4000) {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), timeoutMs);
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
      // Führt ein kleines Skript in Surge aus (liest/schreibt die Protokolle des YouTube-Skripts).
      evaluate: (code) => call('/scripting/evaluate', 'POST', { script_text: code, mock_type: 'cron', timeout: 5 }, 8000),
      scriptingList: () => call('/scripting'),
      // Lädt Module und Skripte neu aus dem Internet (Surge iOS 5.23+).
      updateResources: () => call('/external_resources/update', 'POST', { key: 'all' }, 60000),
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
        return { enabled: [...s.enabled], available: [cfg.module], mitm: s.mitm, scripting: s.scripting };
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
      async updateResources() { await wait(); return { all: 'success' }; },
      async scriptingList() { await wait(); return { scripts: [{ name: 'youtube.response' }, { name: MODULE_V2_RULE }, { name: 'youtube.init.antwort' }] }; },
      async evaluate() {
        await wait();
        return { result: {
          search: JSON.stringify({ word: 'Wingo', t: Date.now() - 60000, until: Date.now() + 1080000, v: 'werbefrei-5',
            checked: [{ t: Date.now() - 30000, ep: 'browse', len: 812000, n: 1, out: true }],
            hits: [{ p: '9>58173949>1>58174010>4>49399797>1>50195462>1[7/20]>153515154>172660663>1>168777401>5>1', leaf: 'WORT', ep: 'browse', t: Date.now() - 30000, out: true,
              e: [{ at: 9, i: 7, n: 20, skel: '{153515154{172660663{1{168777401{5{1:WORT 2:txt15}}} 2{183314536{1:eml:demo_promo.eml}}}}}', sibs: ['6: video_lockup.eml·5KB', '▶ 7: demo_promo.eml·7KB·WORT', '8: video_lockup.eml·5KB'] }] }] }),
          runs: JSON.stringify({ v: 'werbefrei-5', t: Date.now() - 30000, eps: { browse: { n: 12, c: 12, t: Date.now() - 30000, ms: 85, len: 812000, ch: true } } }),
          feed: JSON.stringify({ list: [{ t: Date.now() - 30000, v: 'werbefrei-3', ep: 'browse', len: 182000, m: ['pagead'], g: 1, rm: [], rg: 0,
            items: [{ n: 'video_lockup.eml', s: 4100, m: [], g: 0, x: false }, { n: 'promoted_video_lockup.eml', s: 6200, m: ['pagead'], g: 1, x: true }] }] }),
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
        state.scripts = await backend.scriptingList().then((r) => (Array.isArray(r && r.scripts) ? r.scripts.map((x) => x.name) : null)).catch(() => null);
        retireSponsor(state.status);
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

  // Einmalig: stillgelegte Sponsor-Hinweise in Surge ausschalten und ihre Daten wegräumen.
  // Das YouTube-Modul und alles andere bleiben unberührt.
  let retiring = false;
  async function retireSponsor(st) {
    if (retiring || storage.get('sponsorRetired', false) || backend.demo) return;
    retiring = true;
    try {
      if (st.enabled.includes(SPONSOR_MODULE)) await backend.setModule(SPONSOR_MODULE, false);
      await backend.evaluate(`${SPONSOR_KEYS.map((k) => `$persistentStore.write('', ${JSON.stringify(k)});`).join(' ')} $done({});`).catch(() => {});
      storage.set('sponsorRetired', true);
      if (st.available.includes(SPONSOR_MODULE)) log('Sponsor-Hinweise ausgeschaltet (Funktion entfernt). Das Modul kann in Surge gelöscht werden.');
    } catch { /* nächster Versuch beim nächsten Aktualisieren */ } finally {
      retiring = false;
    }
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

    const ytAll = moduleOn && !!st && st.mitm && st.scripting;
    const ytOff = [!moduleOn && 'Modul', !!st && !st.mitm && 'Entschlüsselung', !!st && !st.scripting && 'Skripte'].filter(Boolean);

    setSwitch($('sw-surge'), running, busy('surge'), busy('surge'));
    setSwitch($('sw-youtube'), running && ytAll, !running || !moduleKnown || busy('all'), busy('all'));
    setSwitch($('sw-module'), moduleOn, !running || !moduleKnown || busy('module') || busy('all'), busy('module'));
    setSwitch($('sw-mitm'), !!(st && st.mitm), !running || busy('mitm') || busy('all'), busy('mitm'));
    setSwitch($('sw-scripting'), !!(st && st.scripting), !running || busy('scripting') || busy('all'), busy('scripting'));
    for (const id of ['btn-reload', 'btn-flush', 'btn-diag']) $(id).disabled = !running || busy('all');

    const oldModule = moduleOn && Array.isArray(state.scripts) && state.scripts.includes('youtube.response') && !state.scripts.includes(MODULE_V2_RULE);
    $('reinstall-sub').textContent = oldModule
      ? 'Bitte jetzt antippen: neue Fassung (Modul v2) ist da'
      : 'Nur nötig, wenn ich dich darum bitte';
    $('reinstall-row').dataset.level = oldModule ? 'warn' : '';
    $('yt-sub').textContent = !running
      ? 'Erst den Schutz einschalten'
      : !moduleKnown
        ? `Modul „${settings.module}“ fehlt in Surge – unter Mehr → Einrichtung installieren`
        : ytAll && oldModule
          ? 'Aktiv, aber altes Modul: unten bei Wartung neu installieren'
          : ytAll
            ? 'Aktiv: Werbung wird aus der YouTube-App entfernt'
            : ytOff.length === 3
              ? 'Pausiert: YouTube zeigt Werbung'
              : `Teilweise aus (${ytOff.join(', ')}) – antippen schaltet alles ein`;
    $('module-sub').textContent = st && !moduleKnown
      ? `Modul „${settings.module}“ ist in Surge nicht installiert`
      : `„${settings.module}“ in Surge`;

    const everConnected = storage.get('everConnected', false);
    let level = 'idle';
    let title = 'Verbinde …';
    let text = '';
    let showSetup = false;
    let fix = '';
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
      if (!showSetup) fix = 'start';
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
        if (moduleKnown) fix = 'resume';
      } else {
        level = 'warn';
        title = 'Teilweise aktiv';
        text = `Aus: ${off.join(', ')}. YouTube-Werbung kommt durch.`;
        if (moduleKnown) fix = 'resume';
      }
    }

    document.documentElement.dataset.level = level;
    $('status-card').dataset.level = level;
    $('status-mark').firstElementChild.setAttribute('href', MARKS[level]);
    $('status-title').textContent = title;
    $('status-text').textContent = text;
    $('btn-setup').hidden = !showSetup;
    $('btn-fix').hidden = !fix;
    $('btn-fix').dataset.fix = fix;
    $('btn-fix').textContent = fix === 'start' ? 'Schutz einschalten' : 'Alles einschalten';
    $('btn-fix').disabled = busy('all');

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
      else balloon('Status nicht abrufbar', 'Später noch einmal auf „Prüfen“ tippen.');
    }
    return result;
  }
  async function runNextDnsCheck(quiet) {
    setDns('idle', 'NextDNS: prüfe …', '');
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
        if (!quiet) log('NextDNS geprüft: aktiv');
        return 'ok';
      }
      setDns('bad', 'NextDNS nicht aktiv', 'Dieses iPhone nutzt gerade nicht NextDNS.');
      if (!quiet) log('NextDNS geprüft: nicht aktiv', 'bad');
      return 'bad';
    } catch {
      setDns('idle', 'NextDNS: Status nicht abrufbar', 'Später noch einmal auf „Prüfen“ tippen.');
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
    const initLocal = init.filter((r) => r.modified || (r.notes || []).some((n) => /map local|mock|script/i.test(n)));
    const adBreak = yt.filter((r) => /\/youtubei\/v1\/player\/ad_break/.test(r.URL || ''));
    const notes = [];
    for (const r of [...yt, ...video]) {
      for (const n of r.notes || []) {
        if (/mitm|script|error|fail|reject|certificate|quic|map local/i.test(n) && !notes.includes(n)) notes.push(n);
      }
    }
    return {
      moduleOn: st.enabled.includes(settings.module),
      moduleKnown: st.available.includes(settings.module),
      mitm: st.mitm, scripting: st.scripting,
      total: reqs.length, yt: yt.length, decrypted: decrypted.length, scripted: scripted.length,
      video: video.length, init: init.length, initLocal: initLocal.length,
      adBreak: adBreak.length,
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
      `Letzte Anfragen gesamt: ${a.total}`,
      `YouTube-API: ${a.yt} · entschlüsselt: ${a.decrypted} · vom Skript verändert: ${a.scripted}`,
      `Video-Server: ${a.video} · Video-Start (initplayback): ${a.init} · davon vom Skript bearbeitet: ${a.initLocal}`,
      `Zwischen-Werbung (player/ad_break): ${a.adBreak} Anfragen`,
      a.notes.length ? `Hinweise von Surge:\n${a.notes.map((n) => `  - ${n}`).join('\n')}` : 'Hinweise von Surge: keine',
      a.samples.length ? `Beispiele:\n${a.samples.map((s) => `  - ${s}`).join('\n')}` : '',
      feedReport(a.feed),
    ].filter(Boolean).join('\n');
  }
  // Feed-Protokoll des YouTube-Skripts: pro Antwort die Einträge (Vorlagen-Name, Größe, Treffer),
  // ohne Titel oder andere Inhalte. „übrig“ = nach dem Filtern noch Werbe-Merkmale in der Antwort.
  const FEED_DIAG_KEY = 'werbefrei.feed.diag';
  async function readFeedDiag() {
    try {
      const res = await backend.evaluate(`$done({ feed: $persistentStore.read(${JSON.stringify(FEED_DIAG_KEY)}) });`);
      const v = res && res.result && res.result.feed;
      const d = v ? JSON.parse(v) : null;
      return d && Array.isArray(d.list) ? d.list : [];
    } catch { return null; }
  }
  function feedReport(list) {
    if (list === undefined) return '';
    if (list === null) return 'Feed-Protokoll: nicht lesbar';
    if (!list.length) return 'Feed-Protokoll: noch leer – Skript aktualisieren und YouTube-Startseite öffnen';
    const hits = (m, g) => [...(m || []), ...(g ? [`Kennzeichnung ×${g}`] : [])].join(', ');
    const lines = ['Feed-Protokoll (neueste zuerst):'];
    for (const r of list.slice(0, 3)) {
      const t = new Date(r.t).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
      const items = Array.isArray(r.items) ? r.items : [];
      const left = hits(r.rm, r.rg);
      lines.push(`  ${t} ${r.ep} · Stand ${r.v || '?'}${r.ms != null ? ` · ${r.ms} ms` : ''} · ${Math.round((r.len || 0) / 1024)} KB · ${items.length} Einträge, ${items.filter((x) => x.x).length} entfernt · übrig: ${left || 'nichts'}`);
      for (const x of items) {
        const h = hits(x.m, x.g);
        const extra = `${x.r ? ` · ${x.r} Teil${x.r > 1 ? 'e' : ''} entfernt` : ''}${x.k ? ' · zeigt auf Werbe-Inhalt' : ''}`;
        if (x.x || h) lines.push(`    ${x.x ? '✂︎' : '⚠︎'} ${x.n} · ${x.s} B${h ? ` · ${h}` : ''}${extra}`);
      }
      const names = [...new Set(items.filter((x) => !x.x && !hits(x.m, x.g)).map((x) => x.n))].slice(0, 8);
      if (names.length) lines.push(`    behalten: ${names.join(', ')}`);
    }
    return lines.join('\n');
  }
  // ---------- Werbung melden: Spurensuche + genauer Bericht ----------
  // Die App legt ein Suchwort in Surge ab; das YouTube-Skript beschreibt dann, wo dieses Wort in den
  // YouTube-Antworten steckt (Feldnummern, Größen, Vorlagen-Namen, Server-Namen – keine Texte).
  const FEED_SEARCH_KEY = 'werbefrei.feed.search';
  const FEED_RUNS_KEY = 'werbefrei.feed.runs';
  const FEED_ERRORS_KEY = 'werbefrei.feed.errors';
  const SEARCH_MINUTES = 20;
  const COVERED_ENDPOINTS = /^(browse|next|player|search|reel\/reel_watch_sequence|guide|account\/get_setting|get_watch)$/;
  const parseJson = (v) => { try { return v ? JSON.parse(v) : null; } catch { return null; } };
  const hhmmss = (t) => new Date(t).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const kb = (n) => `${Math.round((n || 0) / 1024)} KB`;

  async function readAdData() {
    const read = (k) => `$persistentStore.read(${JSON.stringify(k)})`;
    const res = await backend.evaluate(`$done({ search: ${read(FEED_SEARCH_KEY)}, runs: ${read(FEED_RUNS_KEY)}, errors: ${read(FEED_ERRORS_KEY)}, feed: ${read(FEED_DIAG_KEY)}, init: ${read(INIT_STATS_KEY)} });`);
    const r = (res && res.result) || {};
    const feed = parseJson(r.feed);
    return { search: parseJson(r.search), runs: parseJson(r.runs), errors: parseJson(r.errors), init: parseJson(r.init), feed: feed && Array.isArray(feed.list) ? feed.list : [] };
  }
  async function writeSearch(obj) {
    await backend.evaluate(`$persistentStore.write(${JSON.stringify(JSON.stringify(obj))}, ${JSON.stringify(FEED_SEARCH_KEY)}); $done({});`);
  }
  function describeSearch(sr) {
    if (!sr || !sr.word) return 'Keine aktiv';
    const n = Array.isArray(sr.checked) ? sr.checked.length : 0;
    const hits = Array.isArray(sr.hits) ? sr.hits.length : 0;
    const found = `${n} Antwort${n === 1 ? '' : 'en'} geprüft · ${hits} Fundstelle${hits === 1 ? '' : 'n'}`;
    if (sr.until > Date.now()) {
      const min = Math.max(1, Math.round((sr.until - Date.now()) / 60000));
      return `Sucht nach „${sr.word}“ · noch ${min} min · ${found}${n ? '' : ' – jetzt YouTube öffnen und die Startseite neu laden'}`;
    }
    return `Beendet: „${sr.word}“ · ${found}`;
  }
  function renderSearchStatus(sr) { $('ar-status').textContent = describeSearch(sr); }
  async function refreshSearchStatus() {
    try { renderSearchStatus((await readAdData()).search); } catch (e) { $('ar-status').textContent = `Nicht lesbar: ${errorText(e)}`; }
  }
  async function startSearch() {
    const word = $('ar-word').value.trim();
    if (word.length < 2) { $('ar-status').textContent = 'Bitte mindestens 2 Buchstaben eingeben'; $('ar-word').focus(); return; }
    try {
      await writeSearch({ word, t: Date.now(), until: Date.now() + SEARCH_MINUTES * 60000 });
      storage.set('adWord', word);
      log(`Spurensuche gestartet: „${word}“`, 'info');
      await refreshSearchStatus();
    } catch (e) { $('ar-status').textContent = `Nicht gestartet: ${errorText(e)}`; }
  }
  async function stopSearch() {
    try {
      const { search } = await readAdData();
      if (search && search.word) await writeSearch({ ...search, until: Date.now() - 1 });
      await refreshSearchStatus();
    } catch (e) { $('ar-status').textContent = `Nicht beendet: ${errorText(e)}`; }
  }
  function initReport(s) {
    if (!s) return 'Video-Start-Skript: noch nicht gelaufen';
    return `Video-Start-Skript: durchgelassen ${s.durchgelassen || 0} · ausgewichen ${s.ausgewichen || 0} · Schlüssel geholt ${s.schluesselHolen || 0} (zuletzt ${ago(s.t)}: ${s.last || '?'})`;
  }
  function runsReport(runs) {
    if (!runs || !runs.eps) return 'Skript-Läufe: noch keine – Skript aktualisieren und YouTube öffnen';
    const parts = Object.entries(runs.eps).sort((a, b) => b[1].t - a[1].t)
      .map(([ep, o]) => `${ep} ${o.n}× (zuletzt ${ago(o.t)}, ${o.ms} ms, ${kb(o.len)}, verändert ${o.c}×)`);
    return `Skript-Läufe (Stand ${runs.v || '?'}): ${parts.join(' · ')}`;
  }
  function errorsReport(errs) {
    const list = errs && Array.isArray(errs.list) ? errs.list : [];
    return list.length ? `Fehler im Skript:\n${list.map((x) => `  ${hhmmss(x.t)} ${x.v || ''} ${x.w}: ${x.e}`).join('\n')}` : 'Fehler im Skript: keine';
  }
  function endpointSummary(recent) {
    const reqs = Array.isArray(recent && recent.requests) ? recent.requests : [];
    const by = new Map();
    let tunnel = 0;
    for (const r of reqs) {
      if (/^youtubei\.googleapis\.com:443/.test(r.URL || '')) { tunnel++; continue; }
      const m = /^https?:\/\/youtubei\.googleapis\.com\/youtubei\/v1\/([a-z_/]+)/i.exec(r.URL || '');
      if (!m) continue;
      const o = by.get(m[1]) || { n: 0, mod: 0, fail: 0, notes: new Set() };
      o.n++;
      if (r.modified) o.mod++;
      if (r.failed) o.fail++;
      for (const n of r.notes || []) if (/script|error|fail|timeout|reject|map local/i.test(n) && o.notes.size < 2) o.notes.add(String(n).slice(0, 120));
      by.set(m[1], o);
    }
    const lines = [...by].sort((a, b) => b[1].n - a[1].n).map(([ep, o]) =>
      `  ${ep}: ${o.n}× · verändert ${o.mod}${o.fail ? ` · FEHLER ${o.fail}` : ''}${COVERED_ENDPOINTS.test(ep) ? '' : ' · nicht im Filter'}${o.notes.size ? ` · ${[...o.notes].join(' | ')}` : ''}`);
    if (tunnel) lines.push(`  nicht entschlüsselt: ${tunnel}×`);
    return lines;
  }
  function searchReport(sr) {
    if (!sr || !sr.word) return 'Spurensuche: keine – oben ein Wort aus der Anzeige eingeben und starten';
    const lines = [`Spurensuche: ${describeSearch(sr)}${sr.v ? ` · Skript ${sr.v}` : ''}`];
    for (const c of (Array.isArray(sr.checked) ? sr.checked : []).slice(0, 12)) {
      lines.push(`  ${hhmmss(c.t)} ${c.ep} · ${kb(c.len)} · ${c.n ? `${c.n} Treffer · nach dem Filter ${c.out ? 'NOCH DA ❗' : 'entfernt ✅'}` : 'kein Treffer'}`);
    }
    (Array.isArray(sr.hits) ? sr.hits : []).forEach((h, i) => {
      lines.push(`Fundstelle ${i + 1} · ${h.ep} · ${hhmmss(h.t)} · nach dem Filter ${h.out ? 'NOCH DA ❗' : 'entfernt ✅'}`);
      lines.push(`  Pfad: ${h.p}`);
      lines.push(`  An der Stelle: ${h.leaf}`);
      for (const e of h.e || []) {
        lines.push(`  Eintrag ${e.i} von ${e.n} (Ebene ${e.at}): ${e.skel}`);
        if (e.sibs && e.sibs.length) lines.push(`  Nachbarn: ${e.sibs.join(' | ')}`);
      }
    });
    return lines.join('\n');
  }
  // ---------- Bericht für Claude: alles in einem Text ----------
  // Zustand, YouTube-Diagnose, Skript-Stand, Läufe, Fehler, Surge-Anfragen, Spurensuche, Feed-Protokoll
  // und die letzten Aktionen. Ohne Abfrage-Parameter, Videotitel oder Schlüssel.
  let lastFullReport = '';
  async function buildFullReport() {
    const [data, st, recent, online] = await Promise.all([
      readAdData(), backend.status().catch(() => null), backend.recentRequests().catch(() => null),
      backend.demo ? Promise.resolve(null) : onlineFeedVersion(),
    ]);
    renderSearchStatus(data.search);
    const loaded = data.runs && data.runs.v;
    const a = st && recent ? analyse(st, recent) : null;
    const yn = (b) => (b ? 'an' : 'AUS ❗');
    const recentLog = entries.slice(0, 8).map((x) => `  ${new Date(x.t).toLocaleString('de-DE', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })} ${x.text}`);
    return [
      `Bericht für Claude · ${new Date().toLocaleString('de-DE')}`,
      `App: ${document.querySelector('meta[name="werbefrei-version"]')?.content || '?'} · ${settings.demo ? 'Demo-Modus' : `Surge ${st ? 'verbunden' : 'nicht erreichbar'}`}`,
      st ? `Modul „${settings.module}“: ${st.available.includes(settings.module) ? yn(st.enabled.includes(settings.module)) : 'nicht installiert ❗'} · MitM: ${yn(st.mitm)} · Skripte: ${yn(st.scripting)}` : '',
      `NextDNS (dieses iPhone): ${$('dns-title').textContent}`,
      a ? `Ergebnis: ${verdict(a)}` : '',
      a ? `YouTube-API: ${a.yt} · entschlüsselt: ${a.decrypted} · vom Skript verändert: ${a.scripted} · Video-Server: ${a.video} · Video-Start bearbeitet: ${a.initLocal}/${a.init} · Zwischen-Werbung (ad_break): ${a.adBreak}` : '',
      `Modul-Fassung: ${!Array.isArray(state.scripts) ? 'unbekannt' : state.scripts.includes(MODULE_V2_RULE) ? 'v2 (Video-Start lokal gefiltert) ✅' : 'v1 (alt) ❗ Wartung → YouTube-Modul neu installieren'}`,
      initReport(data.init),
      a && a.notes.length ? `Hinweise von Surge:\n${a.notes.map((n) => `  - ${n}`).join('\n')}` : '',
      `YouTube-Skript: geladen ${loaded || 'unbekannt'} · online ${online || 'unbekannt'}${loaded && online && loaded !== online ? ' ❗ „Regeln & Skripte aktualisieren“ tippen' : ''}`,
      runsReport(data.runs),
      errorsReport(data.errors),
      recent ? `Surge, letzte YouTube-Anfragen:\n${endpointSummary(recent).join('\n') || '  keine'}` : 'Surge-Anfragen: nicht lesbar',
      searchReport(data.search),
      feedReport(data.feed),
      recentLog.length ? `Letzte Aktionen:\n${recentLog.join('\n')}` : '',
    ].filter(Boolean).join('\n');
  }
  // Kopiert mit einem Tipp. iOS erlaubt das Kopieren nur direkt nach dem Tippen; darum bekommt die
  // Zwischenablage ein „Versprechen“ auf den Text, der erst danach fertig wird.
  async function copyFullReport() {
    const btn = $('btn-rep-copy');
    btn.disabled = true;
    $('rep-note').textContent = 'Erstelle Bericht …';
    const textPromise = buildFullReport();
    let copied = false;
    try {
      if (window.ClipboardItem && navigator.clipboard && navigator.clipboard.write) {
        await navigator.clipboard.write([new ClipboardItem({ 'text/plain': textPromise.then((t) => new Blob([t], { type: 'text/plain' })) })]);
        copied = true;
      }
    } catch { /* unten mit writeText versuchen */ }
    try {
      lastFullReport = await textPromise;
      $('rep-out').textContent = lastFullReport;
      if (!copied) {
        try { await navigator.clipboard.writeText(lastFullReport); copied = true; } catch { /* manuell */ }
      }
      $('rep-note').textContent = copied
        ? `Kopiert (${new Date().toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })}). Jetzt hier im Chat einfügen.`
        : 'Kopieren nicht möglich: unten den Text lange antippen, „Alles auswählen“ und „Kopieren“.';
      if (copied) balloon('Bericht kopiert', 'Jetzt im Chat mit Claude einfügen.');
      log('Bericht für Claude erstellt', 'info');
    } catch (e) {
      $('rep-note').textContent = `Bericht nicht möglich: ${errorText(e)}`;
    } finally {
      btn.disabled = false;
    }
  }
  function openReport(focusSearch) {
    if (!$('ar-word').value) $('ar-word').value = storage.get('adWord', '');
    $('dlg-report').showModal();
    refreshSearchStatus();
    if (focusSearch) $('rep-search').scrollIntoView({ block: 'start' });
  }

  let lastReport = '';
  async function runDiagnosis() {
    const out = $('diag-out');
    out.hidden = false;
    out.textContent = 'Prüfe …';
    $('btn-diag').disabled = true;
    try {
      const [st, recent, feed] = await Promise.all([backend.status(), backend.recentRequests(), readFeedDiag()]);
      const a = { ...analyse(st, recent), feed };
      lastReport = report(a);
      out.textContent = lastReport;
      log(`Diagnose: ${verdict(a)}`, a.scripted > 0 ? 'info' : 'bad');
    } catch (e) {
      lastReport = '';
      out.textContent = `Diagnose nicht möglich: ${errorText(e)}`;
    } finally {
      $('btn-diag').disabled = false;
    }
  }

  // ---------- Hilfsfunktionen ----------
  const ago = (t) => {
    const s = Math.max(0, Math.round((Date.now() - t) / 1000));
    return s < 90 ? `vor ${s} s` : s < 5400 ? `vor ${Math.round(s / 60)} min` : `um ${new Date(t).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })}`;
  };

  // Holt Module und Skripte frisch aus dem Repo und lädt das Profil neu.
  async function updateRulesAndScripts() {
    let summary = '';
    try {
      const res = await backend.updateResources();
      const values = Object.values(res || {});
      const failed = values.filter((v) => v !== 'success');
      summary = failed.length ? `${failed.length} Datei(en) mit Fehler: ${String(failed[0]).slice(0, 80)}` : 'Module und Skripte sind aktuell.';
    } catch (e) {
      if (e && e.kind === 'http' && e.status === 404) summary = 'Diese Surge-Version kann Skripte nicht per Knopf aktualisieren.';
      else throw e;
    }
    await backend.reloadProfile();
    return summary;
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

    // „YouTube ohne Werbung“: Modul, Entschlüsselung und Skripte zusammen
    const pauseAll = () => act('all', async () => {
      if (state.status && state.status.available.includes(settings.module)) await backend.setModule(settings.module, false);
      await backend.setFeature('mitm', false);
      await backend.setFeature('scripting', false);
    }, 'YouTube-Filter pausiert', 'Surge läuft weiter, YouTube zeigt wieder Werbung.');
    const resumeAll = () => act('all', async () => {
      await backend.setFeature('mitm', true);
      await backend.setFeature('scripting', true);
      if (state.status && state.status.available.includes(settings.module)) await backend.setModule(settings.module, true);
    }, 'YouTube-Filter eingeschaltet', 'Die YouTube-App einmal ganz schließen und neu öffnen.');
    $('sw-youtube').addEventListener('click', () => {
      if ($('sw-youtube').getAttribute('aria-checked') === 'true') pauseAll(); else resumeAll();
    });
    $('btn-fix').addEventListener('click', () => {
      if ($('btn-fix').dataset.fix === 'start') openSurge('start'); else resumeAll();
    });

    $('btn-reload').addEventListener('click', async () => {
      if (state.busy.size) return;
      state.busy.add('all'); render();
      try {
        const summary = await updateRulesAndScripts();
        log(`Aktualisiert: ${summary}`);
        balloon('Aktualisiert', `${summary} YouTube einmal ganz schließen und neu öffnen.`);
      } catch (e) {
        log(`Fehler: ${errorText(e)}`, 'bad');
        balloon('Hat nicht geklappt', errorText(e), 'bad');
      } finally {
        state.busy.delete('all');
        await refresh();
      }
    });
    $('btn-flush').addEventListener('click', () => act('all', () => backend.flushDns(),
      'DNS-Cache geleert', 'Neue Anfragen gehen wieder frisch an NextDNS.'));

    $('btn-dns-check').addEventListener('click', () => checkNextDns(false));
    $('btn-diag').addEventListener('click', runDiagnosis);
    $('btn-ar-start').addEventListener('click', startSearch);
    $('btn-ar-stop').addEventListener('click', stopSearch);
    $('btn-rep-copy').addEventListener('click', copyFullReport);
    $('ar-word').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); startSearch(); } });
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
      else if (action === 'tech') { $('dlg-tech').showModal(); if (state.reach === 'ok') runDiagnosis(); }
      else if (action === 'report') openReport(item.dataset.focus === 'search');
      else if (action === 'home') $('dlg-home').showModal();
    });
    for (const b of document.querySelectorAll('[data-copy]')) {
      b.addEventListener('click', () => copyText(b.dataset.copy));
    }
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
  runNextDnsCheck(true); // still beim Start, damit Statuskarte und Bericht den NextDNS-Zustand kennen
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
