# Werbeblocker fürs iPhone: wie Brave, aber für Apps

Ziel: Apps auf dem iPhone so nutzen, als liefen sie in Brave. Den Anfang macht **YouTube ohne Werbung in der YouTube-App**.

## So funktioniert es

| Baustein | Was er macht | Wo |
|---|---|---|
| **NextDNS** | Sperrt bekannte Werbe- und Tracker-Domains in allen Apps, zum Beispiel Werbenetzwerke in Spielen | iPhone, später auch die Fritzbox |
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
3. **[Fritzbox auf NextDNS](anleitung/3-fritzbox.md)**: optional und erst später. Mit allen Geräten im Haushalt wird es mit 300.000 Anfragen im Monat knapp. Darum nutzt du NextDNS zuerst eine Woche nur am iPhone und schaust dir den Verbrauch an.
4. **[Werbefrei-Zentrale als App](anleitung/4-steuerzentrale.md)**: Schalter und „Alles sofort stoppen“ auf dem Home-Bildschirm, schlicht im Stil der iPhone-Einstellungen, hell und dunkel. Läuft kostenlos über GitHub Pages.

## Die App

Die **Werbefrei-Zentrale** (`app/`) bündelt alles Wichtige auf einem Bildschirm:

- **Hauptschalter** und **Alles sofort stoppen** für Surge. Das geht immer, auch ohne Einrichtung.
- Schalter für das **YouTube-Modul**, die **HTTPS-Entschlüsselung** und die **Skripte**, dazu „Alles pausieren“ und „Alles an“.
- **NextDNS-Status**, **Profil neu laden**, **DNS-Cache leeren** und ein **Ereignisprotokoll**.
- Ein **Demo-Modus** zum Ausprobieren ohne Surge.

Adresse nach dem Einrichten: `https://r9dfd8pypz-bit.github.io/adblock-regeln/app/`

## Sicherheitsregeln

- Surge entschlüsselt nur YouTube-Adressen: `youtubei.googleapis.com` und `*.googlevideo.com` (Werbefilter), dazu `s.youtube.com` und `www.youtube.com`, falls die Sponsor-Hinweise an sind. Bei diesen beiden liest das Skript nur die Wiedergabe-Position mit. Banking, Apple, Gesundheit und alles andere bleiben unberührt. `tests/pruefen.mjs` prüft das automatisch.
- Das YouTube-Skript liegt als **geprüfte, feste Kopie** in diesem Repo, siehe [scripts/youtube/HERKUNFT.md](scripts/youtube/HERKUNFT.md). Der Teil des Originals, der Daten an einen fremden Server schickt, ist entfernt, und die Werbe-Erkennung im Feed ist verbessert (dort dokumentiert).
- Das Surge-Zertifikat wird auf deinem iPhone erzeugt und bleibt dort. Exportiere oder teile es nie.
- Aufhören geht jederzeit: Surge löschen und das Zertifikat entfernen unter Einstellungen → Allgemein → VPN und Geräteverwaltung.

## Inhalt

```
modules/youtube-werbefrei.sgmodule   Surge-Modul gegen YouTube-Werbung (das abonniert Surge)
modules/youtube-sponsor-hinweise.sgmodule  Optional: Sponsor-Wächter, meldet Influencer-Werbung, während sie läuft (SponsorBlock)
scripts/youtube/sponsor-hinweise.js  Eigenes Skript dazu
scripts/youtube/youtube.response.js  YouTube-Skript (Apache-2.0, von Maasea/sgmodule)
scripts/youtube/HERKUNFT.md          Herkunft und Prüfbericht des Skripts
app/                                 Werbefrei-Zentrale (Web-App für den Home-Bildschirm)
anleitung/                           Schritt-für-Schritt-Anleitungen fürs iPhone
tests/pruefen.mjs                    Automatische Prüfung: node tests/pruefen.mjs
tests/app-e2e.cjs                    App-Test gegen eine nachgebaute Surge-Schnittstelle (braucht Playwright)
tests/sponsor-test.mjs               Test für das Sponsor-Skript: node tests/sponsor-test.mjs
tests/feed-ads-test.mjs              Test: Werbung im Feed (z. B. Shopping-Karussell) wird entfernt
```

## Etwas ändern lassen

Schreib in der Claude-App einfach, was dich stört, zum Beispiel „bei YouTube kommt vor manchen Videos noch Werbung“ oder „in App X ist noch ein Werbebanner“. Ich passe das Repo an, und Surge lädt das Modul neu.
