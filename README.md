# Werbeblocker fürs iPhone: wie Brave, aber für Apps

Ziel: Apps auf dem iPhone so nutzen, als liefen sie in Brave. Den Anfang macht **YouTube ohne Werbung in der YouTube-App**.

## So funktioniert es

| Baustein | Was er macht | Wo |
|---|---|---|
| **NextDNS** | Sperrt bekannte Werbe- und Tracker-Domains in allen Apps, zum Beispiel Werbenetzwerke in Spielen | iPhone |
| **AdGuard DNS** | Dasselbe für alle Geräte im WLAN, gratis und ohne Konto | Fritzbox |
| **Surge** | Läuft als lokales „VPN“ direkt auf dem iPhone. Es entschlüsselt *nur* YouTube und löscht die Werbung aus den Antworten, bevor die App sie anzeigt | iPhone |
| **Dieses Repo** | Deine eigene Regelsammlung. Surge lädt das Modul von hier und aktualisiert es selbst | GitHub |

Brave filtert die Webseite, bevor du sie siehst. Surge filtert die Daten der App, bevor die App sie sieht.

## Kosten: erst testen, dann entscheiden

| | Kosten | Bindung |
|---|---|---|
| NextDNS Free | 0 €, bis 300.000 Anfragen im Monat. Laut NextDNS wird danach bis Monatsende nur nicht mehr gefiltert, das Internet läuft weiter | keine |
| Surge | **7 Tage kostenlos mit allen Funktionen**. Danach ein Einmalkauf (laut Preisübersicht etwa 50 $, bitte im App Store prüfen). Ein Monatsabo gibt es nicht | keine, weil kein Abo |
| Günstigere Alternativen nach dem Test | Shadowrocket etwa 3 $, Egern Pro 6 $ (Grundversion kostenlos), Loon etwa 6–8 $, jeweils einmalig | keine |

Ein kündbares Monatsabo bietet keine dieser Apps an. Plan: Mit der kostenlosen Surge-Testwoche prüfen, ob YouTube werbefrei läuft. Wenn ja, entscheidest du, ob du Surge kaufst oder ob wir das Modul auf eine günstigere App umbauen.

## Reihenfolge

1. **[NextDNS auf dem iPhone](anleitung/1-nextdns-iphone.md)**: kostenlos, etwa 10 Minuten.
2. **[Surge-Testwoche mit YouTube-Modul](anleitung/2-surge-youtube.md)**: erst starten, wenn du 30 Minuten Zeit hast, denn ab dann laufen die 7 Tage.
3. **[Ganzer Haushalt über die Fritzbox](anleitung/3-fritzbox.md)**: gratis mit AdGuard DNS, ohne Konto. Gilt für alle Geräte im WLAN. YouTube-Werbung am Fernseher bleibt, das kann DNS nicht.
4. **[Werbefrei-Zentrale als App](anleitung/4-steuerzentrale.md)**: Schalter und „Alles sofort stoppen“ auf dem Home-Bildschirm, schlicht im Stil der iPhone-Einstellungen, hell und dunkel. Läuft kostenlos über GitHub Pages.

## Die App

Die **Werbefrei-Zentrale** (`app/`) bündelt alles Wichtige auf einem Bildschirm:

- **Statuskarte** mit Reparier-Knopf, **Schutz** (Surge an/aus), **YouTube ohne Werbung** und **Alles sofort stoppen**. Das geht immer, auch ohne Einrichtung.
- **Hilfe von Claude:** Spurensuche bei Werbung und ein **Bericht für Claude**, den ein Tipp kopiert.
- **Zuhause & Internet:** NextDNS-Status und die Anleitung für den ganzen Haushalt (Fritzbox).
- **Wartung:** Regeln & Skripte aktualisieren, Technik & Diagnose, Verlauf.
- Ein **Demo-Modus** zum Ausprobieren ohne Surge.

Adresse nach dem Einrichten: `https://r9dfd8pypz-bit.github.io/adblock-regeln/app/`

## Sicherheitsregeln

- Surge entschlüsselt nur YouTube-Adressen: `youtubei.googleapis.com` und `*.googlevideo.com` (Werbefilter). Banking, Apple, Gesundheit und alles andere bleiben unberührt. `tests/pruefen.mjs` prüft das automatisch.
- Die YouTube-Skripte liegen als **geprüfte, feste Kopien** in diesem Repo, siehe [scripts/youtube/HERKUNFT.md](scripts/youtube/HERKUNFT.md). Der Teil des heutigen Originals, der den Video-Start an einen fremden Server schickt, ist nicht dabei. Den Video-Start filtert stattdessen `youtube.ump.js` aus einer älteren Fassung des Originals lokal auf dem iPhone. Die Werbe-Erkennung im Feed ist verbessert (dort dokumentiert).
- Das Surge-Zertifikat wird auf deinem iPhone erzeugt und bleibt dort. Exportiere oder teile es nie.
- Aufhören geht jederzeit: Surge löschen und das Zertifikat entfernen unter Einstellungen → Allgemein → VPN und Geräteverwaltung.

## Inhalt

```
modules/youtube-werbefrei.sgmodule   Surge-Modul gegen YouTube-Werbung (das abonniert Surge)
modules/youtube-sponsor-hinweise.sgmodule  Stillgelegt (16.11.2026), tut nichts mehr, kann in Surge gelöscht werden
scripts/youtube/sponsor-hinweise.js  Stillgelegt: lässt jede Anfrage sofort durch
scripts/youtube/youtube.response.js  YouTube-Skript (Apache-2.0, von Maasea/sgmodule)
scripts/youtube/youtube.ump.js       Filtert den Video-Start lokal (Apache-2.0, Maasea-Fassung 2ead6ff, unverändert)
scripts/youtube/youtube.init.js      Eigenes Skript: lässt den Video-Start durch oder weicht auf den Player-Weg aus
scripts/youtube/HERKUNFT.md          Herkunft und Prüfbericht des Skripts
app/                                 Werbefrei-Zentrale (Web-App für den Home-Bildschirm)
anleitung/                           Schritt-für-Schritt-Anleitungen fürs iPhone
tests/pruefen.mjs                    Automatische Prüfung: node tests/pruefen.mjs
tests/app-e2e.cjs                    App-Test gegen eine nachgebaute Surge-Schnittstelle (braucht Playwright)
tests/sponsor-test.mjs               Prüft, dass das stillgelegte Sponsor-Skript nichts mehr tut
tests/feed-ads-test.mjs              Test: Werbung im Feed (z. B. Shopping-Karussell) wird entfernt
tests/init-test.mjs                  Test: Video-Start (initplayback) und Schlüssel aus config/log_event
```

## Etwas ändern lassen

Schreib in der Claude-App einfach, was dich stört, zum Beispiel „bei YouTube kommt vor manchen Videos noch Werbung“ oder „in App X ist noch ein Werbebanner“. Ich passe das Repo an, und Surge lädt das Modul neu.
