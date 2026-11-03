// Prüft Modul und YouTube-Skript, bevor etwas ins Repo kommt.
// Aufruf: node tests/pruefen.mjs
//
// 1. Module: Skripte dürfen nur aus diesem Repo kommen, entschlüsselt werden nur erlaubte Adressen.
// 2. Skript: Es muss genau die geprüfte Fassung sein (SHA-256) und darf keine fremden Server kennen.
// 3. Probelauf: Das Skript bekommt eine künstliche YouTube-Antwort mit Werbung und muss
//    die Werbung entfernen, ohne irgendeine Netzwerkanfrage zu stellen.

import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import vm from "node:vm";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const RAW_BASE = "https://raw.githubusercontent.com/r9dfd8pypz-bit/adblock-regeln/main/";
const ERLAUBTE_MITM_HOSTS = new Set(["*.googlevideo.com", "youtubei.googleapis.com", "s.youtube.com", "www.youtube.com"]);
// Die einzige URL im Skript ist ein Doku-Link in einer Fehlermeldung der protobuf-Bibliothek.
const ERLAUBTE_URLS_IM_SKRIPT = new Set([
  "https://github.com/timostamm/protobuf-ts/blob/v1.0.8/MANUAL.md#bigint-support",
]);

let fehler = 0;
function ok(bedingung, text) {
  console.log(`${bedingung ? "OK    " : "FEHLER"} ${text}`);
  if (!bedingung) fehler++;
}

// ---------- 1. Module ----------
const MODULE = ["youtube-werbefrei.sgmodule", "youtube-sponsor-hinweise.sgmodule"];
for (const name of MODULE) {
  const text = readFileSync(join(ROOT, "modules", name), "utf8");
  const zeilen = text.split("\n").filter((z) => !z.startsWith("#") || z.startsWith("#!"));
  const skriptPfade = [...text.matchAll(/script-path=([^,\s]+)/g)].map((m) => m[1]);
  ok(skriptPfade.length > 0, `${name}: enthält mindestens ein Skript`);
  for (const url of skriptPfade) {
    ok(url.startsWith(RAW_BASE), `${name}: Skript kommt aus dem eigenen Repo: ${url}`);
    if (url.startsWith(RAW_BASE)) {
      const datei = url.slice(RAW_BASE.length);
      let vorhanden = true;
      try { readFileSync(join(ROOT, datei)); } catch { vorhanden = false; }
      ok(vorhanden, `${name}: Datei existiert im Repo: ${datei}`);
    }
  }
  const fremdeUrls = zeilen.join("\n").match(/https?:\/\/[^\s,"]+/g)?.filter((u) => !u.startsWith(RAW_BASE)) ?? [];
  ok(fremdeUrls.length === 0, `${name}: keine fremden URLs ${fremdeUrls.join(" ")}`);
  const mitmZeile = text.match(/^hostname\s*=\s*(.*)$/m)?.[1] ?? "";
  const mitmHosts = mitmZeile.replace("%APPEND%", "").split(",").map((h) => h.trim()).filter(Boolean);
  ok(mitmHosts.length > 0, `${name}: MITM-Adressen sind angegeben`);
  for (const h of mitmHosts) ok(ERLAUBTE_MITM_HOSTS.has(h), `${name}: MITM nur für erlaubte Adresse: ${h}`);
}
const modul = readFileSync(join(ROOT, "modules/youtube-werbefrei.sgmodule"), "utf8");

// ---------- 2. Skript ----------
const skriptPfad = join(ROOT, "scripts/youtube/youtube.response.js");
const skript = readFileSync(skriptPfad, "utf8");
const herkunft = readFileSync(join(ROOT, "scripts/youtube/HERKUNFT.md"), "utf8");
const erwarteterHash = herkunft.match(/SHA-256:[\s|`]*([0-9a-f]{64})/)?.[1];
const hash = createHash("sha256").update(readFileSync(skriptPfad)).digest("hex");
ok(hash === erwarteterHash, `Skript ist die geprüfte Fassung (SHA-256 ${hash.slice(0, 12)}…)`);

const urlsImSkript = new Set(skript.match(/https?:\/\/[A-Za-z0-9._~:/?#@!$&+;=%-]+/g) ?? []);
const unbekannt = [...urlsImSkript].filter((u) => !ERLAUBTE_URLS_IM_SKRIPT.has(u));
ok(unbekannt.length === 0, `Skript enthält keine fremden Server ${unbekannt.join(" ")}`);
ok(!/workers\.dev/.test(skript), "Skript enthält keinen Cloudflare-Worker");

// Eigenes Sponsor-Skript: darf nur SponsorBlock fragen und keinen Code nachladen
const sponsor = readFileSync(join(ROOT, "scripts/youtube/sponsor-hinweise.js"), "utf8");
const sponsorHosts = new Set([...sponsor.matchAll(/https?:\/\/([a-z0-9.-]+)/gi)].map((m) => m[1]));
ok([...sponsorHosts].every((h) => ["sponsor.ajay.app", "youtu.be", "www.youtube.com"].includes(h)), `Sponsor-Skript fragt nur SponsorBlock (dazu YouTube-Sprunglinks) ${[...sponsorHosts].join(" ")}`);
ok(/\$httpClient\.get\(\{ url,/.test(sponsor) && (sponsor.match(/\$httpClient\./g) || []).length === 1, "Sponsor-Skript stellt genau eine Netzwerkanfrage (an SponsorBlock)");
ok(!/\beval\(|new Function|\brequire\(|\bimport\(/.test(sponsor), "Sponsor-Skript lädt keinen fremden Code nach");
ok(/sha256Hex\(id\)\.slice\(0, 4\)/.test(sponsor), "Sponsor-Skript sendet nur 4 Zeichen des Hashes");

// ---------- App (Werbefrei-Zentrale) ----------
const appHtml = readFileSync(join(ROOT, "app/index.html"), "utf8");
const appJs = readFileSync(join(ROOT, "app/app.js"), "utf8");
const appCss = readFileSync(join(ROOT, "app/style.css"), "utf8");
const modulName = modul.match(/^#!name=(.*)$/m)?.[1]?.trim();
ok(appJs.includes(`module: '${modulName}'`), `App kennt den Modulnamen „${modulName}“`);
const fremdeQuellen = [...appHtml.matchAll(/<(?:script|link)[^>]+(?:src|href)="(https?:[^"]+)"/g)].map((m) => m[1]);
ok(fremdeQuellen.length === 0, `App lädt keine Skripte oder Styles von fremden Servern ${fremdeQuellen.join(" ")}`);
ok(!/@import|url\(\s*["']?https?:/.test(appCss), "Stylesheet lädt nichts von fremden Servern");
const ERLAUBTE_APP_HOSTS = new Set(["127.0.0.1", "my.nextdns.io", "test.nextdns.io", "apple.nextdns.io", "dns.nextdns.io", "github.com", "apps.apple.com", "raw.githubusercontent.com", "youtu.be", "www.youtube.com"]);
const appHosts = new Set([...(appHtml + appJs).matchAll(/https?:\/\/([a-z0-9.-]+)/gi)].map((m) => m[1]));
const fremdeHosts = [...appHosts].filter((h) => !ERLAUBTE_APP_HOSTS.has(h));
ok(fremdeHosts.length === 0, `App spricht nur mit Surge, NextDNS, GitHub und App Store ${fremdeHosts.join(" ")}`);
ok(/surge:\/\/\/\$\{stop \? 'stop' : 'start'\}/.test(appJs), "NOTAUS nutzt den offiziellen Befehl surge:///stop");
const installLinks = [...new Set([...appHtml.matchAll(/href="surge:\/\/\/install-module\?url=([^"]+)"/g)].map((m) => decodeURIComponent(m[1])))].sort();
ok(JSON.stringify(installLinks) === JSON.stringify([RAW_BASE + "modules/youtube-sponsor-hinweise.sgmodule", RAW_BASE + "modules/youtube-werbefrei.sgmodule"]),
  "Installieren-Knöpfe zeigen auf die Module im eigenen Repo");
ok(appJs.includes("const SPONSOR_MODULE = 'YouTube Sponsor-Hinweise';") && readFileSync(join(ROOT, "modules/youtube-sponsor-hinweise.sgmodule"), "utf8").includes("#!name=YouTube Sponsor-Hinweise"),
  "App kennt den Namen des Sponsor-Moduls");

// ---------- 3. Probelauf ----------
// Kleine protobuf-Helfer
function varint(n) {
  const out = [];
  while (n > 0x7f) { out.push((n & 0x7f) | 0x80); n >>>= 7; }
  out.push(n);
  return out;
}
function feld(nr, bytes) { return [...varint((nr << 3) | 2), ...varint(bytes.length), ...bytes]; }
function lies(bytes) {
  const felder = [];
  let i = 0;
  const v = () => { let r = 0, s = 0, b; do { b = bytes[i++]; r |= (b & 0x7f) << s; s += 7; } while (b & 0x80); return r >>> 0; };
  while (i < bytes.length) {
    const tag = v(), nr = tag >>> 3, typ = tag & 7;
    if (typ === 2) { const len = v(); felder.push({ nr, daten: bytes.slice(i, i + len) }); i += len; }
    else if (typ === 0) { felder.push({ nr, wert: v() }); }
    else throw new Error(`Unerwarteter Typ ${typ}`);
  }
  return felder;
}

const text = (s) => [...Buffer.from(s, "utf8")];
// Player-Antwort: playabilityStatus (Feld 2, ist in echten Antworten immer da), 2x adPlacements
// (Feld 7), 1x adSlots (Feld 68), dazu ein unbekanntes Feld 11, das unverändert bleiben muss.
const playerAntwort = [
  ...feld(2, []),
  ...feld(7, []),
  ...feld(7, []),
  ...feld(68, []),
  ...feld(11, text("video-details-bleibt")),
];

async function probelauf(url, body) {
  let netzwerk = false;
  const speicher = new Map();
  const ctx = vm.createContext({
    console: { log() {}, error() {}, warn() {} },
    TextEncoder, TextDecoder,
    $argument: '{"captionLang":"off","blockUpload":true,"blockImmersive":true,"blockShorts":false,"debug":false}',
    $persistentStore: { read: (k) => speicher.get(k) ?? null, write: (v, k) => { speicher.set(k, v); return true; } },
    $notification: { post() {} },
    $httpClient: new Proxy({}, { get() { netzwerk = true; return (_o, cb) => cb("gesperrt"); } }),
    __bytes: body,
  });
  vm.runInContext(`
    var $request = { url: ${JSON.stringify(url)}, method: "POST",
      headers: { "User-Agent": "com.google.ios.youtube/20.10.4 (iPhone16,2; U; CPU iOS 18_6 like Mac OS X)" } };
    var $response = { status: 200, headers: { "Content-Type": "application/x-protobuf" },
      body: new Uint8Array(__bytes) };
  `, ctx);
  const ergebnis = await new Promise((resolve, reject) => {
    ctx.$done = (r) => resolve(r ?? {});
    setTimeout(() => reject(new Error("Skript hat nicht geantwortet")), 5000);
    vm.runInContext(skript, ctx, { filename: "youtube.response.js" });
  });
  return { ergebnis, netzwerk };
}

{
  const { ergebnis, netzwerk } = await probelauf(
    "https://youtubei.googleapis.com/youtubei/v1/player?prettyPrint=false", playerAntwort);
  ok(!netzwerk, "Probelauf Player: keine Netzwerkanfrage");
  const body = ergebnis.body ?? ergebnis.response?.body;
  ok(body && body.length > 0, "Probelauf Player: Skript liefert eine Antwort");
  if (body) {
    const felder = lies([...body]);
    ok(!felder.some((f) => f.nr === 7), "Probelauf Player: adPlacements entfernt");
    ok(!felder.some((f) => f.nr === 68), "Probelauf Player: adSlots entfernt");
    const f11 = felder.find((f) => f.nr === 11);
    ok(f11 && Buffer.from(f11.daten).toString() === "video-details-bleibt",
      "Probelauf Player: übrige Daten bleiben unverändert");
  }
}
{
  const { netzwerk } = await probelauf(
    "https://youtubei.googleapis.com/youtubei/v1/browse?prettyPrint=false", []);
  ok(!netzwerk, "Probelauf Startseite (leer): läuft ohne Absturz und ohne Netzwerkanfrage");
}

console.log(fehler ? `\n${fehler} Fehler gefunden.` : "\nAlles in Ordnung.");
process.exit(fehler ? 1 : 0);
