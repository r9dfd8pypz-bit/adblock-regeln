# Schritt 2: Surge-Testwoche mit werbefreiem YouTube

Surge läuft als lokales „VPN“ direkt auf deinem iPhone. Die Daten gehen also **nicht** über einen fremden Server. Surge entschlüsselt nur die YouTube-Verbindungen und löscht die Werbung aus den Antworten, bevor die App sie anzeigt.

> Die 7 Tage Testphase beginnen mit dem ersten Start. Fang an, wenn du etwa 30 Minuten Zeit hast.

## Vorher

- [Schritt 1 (NextDNS)](1-nextdns-iphone.md) ist erledigt und du kennst deine NextDNS-ID.
- Das öffentliche Repo `adblock-regeln` enthält die Dateien aus diesem Repo.

## 1. Surge installieren

1. Im App Store **Surge 5** (von Surge Networks Inc.) laden.
2. Öffnen und das vorgeschlagene **Standardprofil** anlegen. Einen Proxy-Server brauchst du nicht, der ganze Verkehr geht direkt ins Internet.
3. Die **kostenlose Testphase** starten. Achte darauf, dass du dabei nichts kaufst und kein Abo abschließt.

## 2. NextDNS in Surge eintragen

Solange Surge läuft, gehen alle DNS-Anfragen über Surge. Damit NextDNS auch unterwegs weiter filtert, muss Surge NextDNS selbst fragen.

Ins Surge-Profil kommt im Abschnitt `[General]` diese Zeile:

```
encrypted-dns-server = https://dns.nextdns.io/abc123/Surge-iPhone
```

Statt `abc123` trägst du deine NextDNS-ID ein. Dafür das Profil in Surge öffnen und im **Textmodus** bearbeiten, oder in den DNS-Einstellungen von Surge den Punkt **Encrypted DNS** suchen. Je nach Version heißt der Menüpunkt etwas anders.

Deine ID kommt absichtlich **nicht** ins öffentliche Repo.

## 3. YouTube-Modul installieren

1. Surge → **Module** → **Install New Module…** (Neues Modul installieren).
2. Diese Adresse eintragen:
   ```
   https://raw.githubusercontent.com/r9dfd8pypz-bit/adblock-regeln/main/modules/youtube-werbefrei.sgmodule
   ```
3. Das Modul **„YouTube werbefrei“** einschalten. Die Grundeinstellungen passen.

## 4. Zertifikat einrichten (für die Entschlüsselung)

1. Surge → **Home** → Tab **Capture** → Karte **MitM** → **Configure**.
2. Gibt es noch kein Zertifikat: **Generate A New CA Certificate** tippen. Das machst du **nur ein einziges Mal**. Ein neu erzeugtes Zertifikat passt nicht mehr zum installierten.
3. **Install CA Certificate to System** tippen und den Download erlauben.
   **Nur Safari kann Zertifikate installieren.** Ist Brave dein Standardbrowser, öffnet sich der Download dort und es passiert nichts. Dann stellst du vorübergehend Safari als Standardbrowser ein (Einstellungen → Apps → Standard-Apps → Browser-App). Oder du gehst in Surge auf **Export CA Certificate to .crt File** → **In Dateien sichern** → in der Dateien-App die Datei antippen. Ein geladenes Profil musst du innerhalb von 8 Minuten installieren, sonst löscht iOS es wieder.
4. In den Einstellungen bei **Profil geladen** auf **Installieren** tippen. Steht dort nichts, findest du es unter Einstellungen → Allgemein → VPN und Geräteverwaltung.
5. **Wichtig, sonst geht es nicht:** Einstellungen → Allgemein → **Info** → ganz unten **Zertifikatsvertrauenseinstellungen** → das Surge-Zertifikat **mit demselben Code** wie in Surge (z. B. `C51A7E98`) **einschalten**.
6. Zurück in Surge: Unter dem Zertifikat darf **nicht mehr „Not installed“** stehen. **Skip Server Certificate Verification** ausschalten. Den MitM-Schalter einschalten. Welche Adressen entschlüsselt werden, legt das Modul fest. Trag dort selbst **nichts** dazu ein.

## 5. Surge starten

Auf **Start** tippen und die VPN-Konfiguration erlauben. Oben in der Statusleiste erscheint dann „VPN“.

## 6. Testen

Wische die YouTube-App im App-Umschalter **komplett weg** und öffne sie neu. Dann prüfst du:

- [ ] Startseite ohne Werbekacheln
- [ ] 5 verschiedene Videos ohne Werbung davor und zwischendurch
- [ ] Shorts ohne Werbe-Shorts
- [ ] Suche ohne Werbetreffer
- [ ] YouTube Music ohne Werbung
- [ ] Bonus: Bild-in-Bild (während ein Video läuft, zum Home-Bildschirm wischen) und Wiedergabe bei gesperrtem Bildschirm. Gegebenenfalls in den YouTube-Einstellungen *Bild-im-Bild* einschalten.
- [ ] Andere Apps funktionieren normal, vor allem Banking und WhatsApp. Sie werden nicht entschlüsselt.

In Surge zeigt **Recent Requests** (Letzte Anfragen), ob Anfragen an `youtubei.googleapis.com` entschlüsselt und vom Skript bearbeitet werden.

## 7. Die Testwoche

- Nutze YouTube ganz normal und notier, was dir auffällt: *was* (Werbung vor dem Video, auf der Startseite, in Shorts, Video lädt nicht, langsam) und *wann*.
- Schau unter Einstellungen → **Batterie**, wie viel Surge verbraucht.
- **Vor Tag 7 entscheiden:**
  - Es funktioniert und Surge ist dir das Geld wert: Surge kaufen.
  - Es funktioniert, aber Surge ist zu teuer: Sag mir Bescheid. Dann baue ich das Modul für **Shadowrocket, Egern oder Loon** um (einmalig etwa 3–8 $). Die YouTube-Skripte sind offiziell nur mit Surge getestet, darum testen wir dann erneut.
  - Es funktioniert nicht gut: Schreib mir, was passiert. Notfalls bleibt YouTube in Brave als kostenloser Plan B.

## Wenn etwas nicht klappt

| Problem | Was tun |
|---|---|
| Videos laden nicht oder drehen sich endlos | In Surge das Modul ausschalten. Wenn es dann geht, schreib mir: Wahrscheinlich hat YouTube etwas geändert. |
| Es kommt trotzdem Werbung | YouTube komplett schließen und neu öffnen. Dann prüfen, ob das Zertifikat volles Vertrauen hat (Schritt 4.4), MitM an ist und das Modul aktiv ist. Hilft das nicht, schreib mir, *wo* die Werbung kommt. |
| Mit Surge lädt gar nichts mehr | Die NextDNS-Zeile auf Tippfehler in der ID prüfen und zum Test entfernen. |
| test.nextdns.io zeigt bei laufendem Surge nicht „ok“ | Die NextDNS-Zeile in Surge fehlt oder ist falsch (Schritt 2). |
| Eine andere App meldet einen Zertifikatsfehler | Das sollte nicht passieren, weil nur YouTube entschlüsselt wird. Bitte melden. |

## Aufhören (zum Beispiel nach dem Test ohne Kauf)

1. In Surge auf **Stop** tippen und die App löschen.
2. Einstellungen → Allgemein → **VPN und Geräteverwaltung** → das Surge-Zertifikat **entfernen**. Dort auch das VPN von Surge löschen, falls es noch da ist.

## Gut zu wissen

- YouTubes Nutzungsbedingungen verbieten Werbeblocker, genau wie bei Brave auf youtube.com. YouTube könnte also theoretisch reagieren.
- YouTube ändert öfter etwas. Dann geht das Skript eine Zeit lang nicht, bis wir es aktualisieren. Wie das geht, steht in [HERKUNFT.md](../scripts/youtube/HERKUNFT.md).
