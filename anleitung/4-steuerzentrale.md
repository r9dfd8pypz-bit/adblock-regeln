# Schritt 4: Die Werbefrei-Zentrale als App aufs iPhone

Eine eigene kleine App, schlicht im Stil der iPhone-Einstellungen. Hell und Dunkel folgen dem iPhone. Damit schaltest du die wichtigsten Dinge mit einem Tipp:

- **Hauptschalter und „Alles sofort stoppen“** für Surge. Das funktioniert **immer**, auch ohne weitere Einrichtung.
- **YouTube werbefrei**, **HTTPS-Entschlüsselung** und **Skripte** einzeln oder alle zusammen („Alles pausieren“ / „Alles an“).
- Den **NextDNS-Status** prüfen und die Logs öffnen.
- **Profil neu laden** (holt neue Regeln aus dem Repo) und **DNS-Cache leeren**.

Die App öffnet sich auch ohne Internet, denn genau dann brauchst du „Alles sofort stoppen“.

## 1. App veröffentlichen (einmalig)

Die App liegt im Ordner `app/` deines öffentlichen Repos. GitHub Pages stellt sie kostenlos ins Netz:

1. In Safari **github.com/r9dfd8pypz-bit/adblock-regeln** öffnen und anmelden.
2. **Settings** → **Pages**. Falls „Settings“ fehlt: unten in Safari auf **aA** tippen → **Desktop-Website anfordern**.
3. Bei *Source* **Deploy from a branch** wählen, bei *Branch* **main** und **/ (root)**, dann **Save**.
4. Nach 1–2 Minuten ist die App erreichbar unter:
   ```
   https://r9dfd8pypz-bit.github.io/adblock-regeln/app/
   ```

## 2. Auf den Home-Bildschirm legen

1. Die Adresse oben in **Safari** öffnen.
2. Auf **Teilen** (Quadrat mit Pfeil) → **Zum Home-Bildschirm** → **Hinzufügen** tippen.
3. Ab jetzt öffnet das Symbol mit dem grünen Schild die App ohne Adressleiste, wie eine normale App.

Zum Ausprobieren ohne Surge: **Mehr → Verbindung & Design → Demo-Modus**.

## Am einfachsten: der Einrichtungs-Assistent

**Mehr → Einrichtung** (oder „Jetzt einrichten“ auf der Startseite). Dort gibt es für jeden Schritt einen Knopf: NextDNS-Konto, NextDNS-Profil, Surge im App Store, **YouTube-Modul mit einem Tipp in Surge installieren**, und die **drei fertigen Zeilen fürs Surge-Profil** (NextDNS und Schnittstelle in einem Rutsch). Erledigte Schritte hakst du ab, ein grüner Balken zeigt den Fortschritt. Die folgenden Abschnitte beschreiben dieselben Schritte ausführlich.

## 3. Mit Surge verbinden

Das geht erst, wenn Surge nach [Schritt 2](2-surge-youtube.md) eingerichtet ist, inklusive vertrautem Zertifikat.

1. In der App: **Mehr → Verbindung & Design**. Ein zufälliger Schlüssel ist schon eingetragen.
2. **Zeilen kopieren** tippen.
3. In Surge das Profil im **Textmodus** öffnen und die Zeilen unter `[General]` einfügen. Sie sehen etwa so aus:
   ```
   http-api = DEIN-SCHLUESSEL@127.0.0.1:6171
   http-api-tls = true
   ```
   Speichern und Surge einmal stoppen und wieder starten.
4. Zurück in der App: **Verbindung testen**. Erwartet ist „Verbindung klappt – Modul ‚YouTube werbefrei‘ gefunden“.
5. **Speichern** tippen. Oben steht jetzt **„Schutz aktiv“** mit grünem Schild.

### Wenn „Keine Verbindung“ kommt

- Läuft Surge? (In der Statusleiste steht „VPN“.)
- Stehen die zwei Zeilen wirklich unter `[General]` und ist der Schlüssel genau gleich?
- **Zertifikat laden** tippen und das Zertifikat installieren und vertrauen, genau wie in Schritt 2.4. Meist ist das schon erledigt, denn die Verbindung nutzt dasselbe Surge-Zertifikat wie YouTube.

## Was die Farben bedeuten

| Schild | Bedeutung |
|---|---|
| Grün mit Haken | **Schutz aktiv**: alles an |
| Gelb mit Pause | **Teilweise aktiv** oder **Pausiert**: YouTube-Werbung kommt durch |
| Rot mit Kreuz | **Schlüssel passt nicht** |
| Grau | **Surge ist aus** oder noch nicht eingerichtet |

Unter **Werkzeuge → YouTube-Diagnose** siehst du, ob YouTube wirklich entschlüsselt und gefiltert wird. Unter **Werkzeuge → Verlauf** stehen die letzten Aktionen.

## Sicherheit

- Die Schnittstelle lauscht nur auf `127.0.0.1`, also **nur auf dem iPhone selbst**. Andere Geräte im WLAN kommen nicht heran. Trag dort nie `0.0.0.0` ein.
- Schlüssel und Einstellungen bleiben auf dem iPhone. Sie stehen nicht im Repo.
- Die App lädt nichts von fremden Servern. Sie spricht nur mit Surge (127.0.0.1) und mit `test.nextdns.io` für den Status. `node tests/pruefen.mjs` prüft das automatisch.

## Gut zu wissen

- Für **Alles sofort stoppen** und den **Hauptschalter** nutzt die App die offiziellen Surge-Befehle `surge:///stop` und `surge:///start`. Das iPhone fragt eventuell „In Surge öffnen?“. Danach wechselst du zurück in die App, und sie aktualisiert sich selbst.
- Laut dem Projekt hinter Surges Web-Dashboard kann die HTTP-Schnittstelle nach dem Kauf ein aktives Update-Abo brauchen. Das konnte ich nicht sicher klären. In der Testwoche geht alles, und „Alles sofort stoppen“ und der Hauptschalter funktionieren in jedem Fall.
- Wenn die App selbst einmal nicht reagiert: iPhone-**Einstellungen** öffnen und oben **VPN** ausschalten. Das stoppt Surge ebenfalls.

## Sponsor-Hinweise (Werbung der Influencer im Video)

Viele YouTuber sprechen im Video selbst Werbung ein. In **SponsorBlock** tragen Nutzer weltweit ein, von wann bis wann das passiert. Der **Sponsor-Wächter** nutzt das:

1. **Beim Öffnen eines Videos** holt er die eingetragenen Stellen. An SponsorBlock gehen dabei nur 4 Zeichen eines Hashes der Video-Kennung.
2. **Während das Video läuft**, meldet die YouTube-App etwa alle 10 Sekunden ihre Position an YouTube. Der Wächter liest diese Meldung nur mit.
3. **Läuft gerade eine Sponsor-Stelle**, kommt sofort eine Mitteilung: *„⏭ Sponsor läuft – noch 46 s · Tippen = weiter bei 2:06“*. Tippst du direkt auf das Banner, springt YouTube dahinter.

Einrichten:
- In der App unter **YouTube → Sponsor-Hinweise** auf **Installieren** tippen, dann den Schalter einschalten. Nach Änderungen am Modul: **Werkzeuge → Sponsor-Hinweise prüfen → Modul aktualisieren** und in Surge bestätigen. „Skript neu laden“ aktualisiert nur das Skript, nicht das Modul.
- Surge muss Mitteilungen senden dürfen: In Surge auf der Startseite (Tab *General*, ganz unten) Mitteilungen erlauben.

Prüfen: **Werkzeuge → Sponsor-Hinweise prüfen** zeigt die Stellen im aktuellen Video und die letzte gemeldete Position. Steht bei „Positions-Meldungen“ nach ein paar Sekunden Video noch „keine“, liest Surge nicht mit. Meist ist dann noch das alte Modul installiert: **Modul aktualisieren**, in Surge bestätigen und YouTube neu öffnen. Bis dahin meldet das Skript die Stellen wie früher beim Videostart.

Gut zu wissen:
- Es klappt nur bei Videos, die schon jemand eingetragen hat. Bei großen Kanälen ist das meist der Fall.
- Die Mitteilung kann bis zu etwa 10 Sekunden nach Beginn der Stelle kommen, weil die App ihre Position nur alle paar Sekunden meldet.
- Ein automatisches Überspringen ohne Antippen geht in der offiziellen YouTube-App nicht. Dafür bräuchte es eine umgebaute App, und bei uYouEnhanced ist diese Funktion seit August 2026 wegen Abstürzen abgeschaltet.
