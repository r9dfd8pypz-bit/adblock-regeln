# Herkunft und Prüfung des YouTube-Skripts

`youtube.response.js` stammt von **Maasea/sgmodule** und steht unter der Apache-2.0-Lizenz (siehe `LICENSE` in diesem Ordner). **Seit 06.11.2026 ist die Datei geändert** (siehe unten); die Änderung ist im Dateikopf vermerkt.

| | |
|---|---|
| Quelle | https://github.com/Maasea/sgmodule/blob/65075cdb388fc5e3094afd7e7314c67b243f3525/Script/Youtube/youtube.response.js |
| Commit | `65075cdb388fc5e3094afd7e7314c67b243f3525` vom 19.07.2026 („#100 fix ad judgment“) |
| SHA-256: | `e4c210098b45bd95a985e9bef8ec5b1c0e842b943fe0746e6d7e9307fb87e61f` (geänderte Fassung, Stand „werbefrei-8“) |
| Original-Prüfsumme | `f98483d5f5017514f82502253c0db5ce2d4ffb7839887aa2cadc22666f5a7f12` (unverändert vom Autor) |
| Geprüft am | 02.11.2026 |

## Änderungen gegenüber dem Original (06.11.2026)

Anlass: Eine Shopping-Anzeige („Gesponsert · Music Store“, Produktkarussell) unter dem Video wurde nicht entfernt.

Das Original erkennt Werbung im Feed am Merkmal `pagead` und **merkt sich dauerhaft**, welche Vorlagen und Feldnummern „Werbung“ oder „keine Werbung“ sind. Zwei Schwächen:
1. Es sucht `pagead` nur im Inhalts-Teil (`videoContent`) eines Eintrags bzw. erst ab 1000 Byte. Steckt das Merkmal woanders, zum Beispiel beim Knopf „Zur Website“, gilt der Eintrag als „keine Werbung“.
2. Ein einmal als „keine Werbung“ gelernter Typ wird nie wieder geprüft. Eine einzige Fehleinschätzung lässt diese Anzeigenart dauerhaft durch.

Geändert:
- **`Ei` / `Fi`:** Ist ein Eintrag nicht sicher als Werbung bekannt, wird der **ganze Eintrag** (neu codiert mit `te.toBinary`) nach `pagead`, `googleadservices` und `doubleclick.net` durchsucht. Das geschieht bei jedem Eintrag neu, ohne Speichern.
- **Kein „keine Werbung“-Speicher mehr:** Es werden nur noch sichere Werbe-Typen gespeichert, also wie im Original `pagead` ab 1000 Byte.
- **Speicher-Reset:** Die Versionskennung des gelernten Speichers ist jetzt `1.0-werbefrei-2` statt `1.0`. Alte, eventuell falsche Einträge werden dadurch ignoriert.

### Nachtrag „werbefrei-3“ (06.11.2026): Video-Anzeigen auf der Startseite

Anlass: Eine Video-Anzeige („Gesponsert · Temu“, Knöpfe „Ansehen“ und „Zur Website“) in der Startseite blieb stehen. Solche Einträge enthalten nicht unbedingt eine Werbeadresse.

Zusätzlich geändert:
- **Kennzeichnung:** Ein Eintrag gilt auch dann als Werbung, wenn ein Textfeld mit „Gesponsert“ beginnt (ebenso „Sponsored“, „Sponsorisé“, „Sponsorizzato“, „Patrocinado“, „Gesponsord“). Gezählt wird nur ein Text, der **mit** dem Wort anfängt. Ein Videotitel wie „Warum ist so viel Gesponsert?“ bleibt also stehen.
- **Weitere Werbeadressen:** Neben `pagead`, `googleadservices` und `doubleclick.net` jetzt auch `googlesyndication` und `/aclk?`. Adressen zählen erst ab 300 Byte Eintragsgröße.
- **Feed-Protokoll:** Für `browse`, `next`, `search` und `get_watch` speichert das Skript lokal in Surge (`$persistentStore`, Schlüssel `werbefrei.feed.diag`) die letzten 4 Antworten: pro Eintrag nur den Namen der Vorlage (z. B. `video_lockup.eml`) oder die Feldnummer, die Größe, die gefundenen Merkmale und ob er entfernt wurde. Dazu kommt, ob nach dem Filtern noch Merkmale in der Antwort stecken. **Titel, Kanäle und andere Inhalte werden nicht gespeichert.** Die App zeigt das Protokoll in „YouTube-Diagnose“. Es verlässt das iPhone nur, wenn du den Bericht selbst kopierst.

### Nachtrag „werbefrei-4“ (06.11.2026): Werbe-Inhalte außerhalb des Feed-Eintrags

Anlass: Eine Anzeige „Gesponsert · Wingo“ mit Knopf „Jetzt einkaufen“ blieb auf der Startseite stehen. Laut Maasea-Issue #89 kann der Inhalt solcher Anzeigen getrennt vom Feed-Eintrag kommen: in `frameworkUpdates` als „Entität“. Der Feed-Eintrag selbst enthält dann nur einen Verweis (Schlüssel) darauf.

Zusätzlich geändert:
- **Oberste unbekannte Felder** (z. B. `frameworkUpdates`) werden nach Werbe-Merkmalen durchsucht. Gefundene Werbung wird nur dort entfernt, wo sie in einer Liste **neben** normalen Einträgen steht, also eine einzelne Entität und nicht das ganze Feld. Einträge unter 300 Byte bleiben stehen, damit nie nur das Wort „Gesponsert“ herausgeschnitten wird.
- **Verweise:** Der Schlüssel (Feld 1) jeder entfernten Entität wird gemerkt. Feed-Einträge und Abschnitte, die diesen Schlüssel enthalten, werden ebenfalls entfernt.
- **Unbekannte Abschnitte:** Ein Eintrag der Abschnittsliste, der zu keiner bekannten Art gehört und Werbe-Merkmale trägt, wird entfernt.
- **Protokoll:** Stand jetzt `werbefrei-4`. Neue Zeilen sind „oben feld N“ (mit Anzahl entfernter Teile), „abschnitt feld N“ und „zeigt auf Werbe-Inhalt“. Schlüssel und Texte werden weiterhin nicht gespeichert.

### Nachtrag „werbefrei-5“ (07.11.2026): Spurensuche und genauer Bericht

Anlass: Es kam wieder Werbung im Feed. Damit wir nicht mehr nach Screenshots raten müssen, kann das Skript jetzt genau beschreiben, wo eine Anzeige in der YouTube-Antwort steckt.

Zusätzlich geändert:
- **Spurensuche:** Die App legt ein Suchwort aus der Anzeige ab, zum Beispiel den Firmennamen (`werbefrei.feed.search`, gilt 20 Minuten). Das Skript sucht das Wort in jeder Antwort, die es bearbeitet. Für bis zu 3 Fundstellen hält es fest:
  - den Pfad aus Feldnummern mit Position in Listen,
  - einen Bauplan des umgebenden Eintrags: Feldnummern, Größen, Vorlagen-Namen, Server-Namen aus Adressen, Textlängen,
  - die Nachbar-Einträge zum Vergleich,
  - ob das Wort nach dem Filter noch in der Antwort steht.

  **Texte selbst werden nicht gespeichert**, nur das Suchwort. Ein Eintrag wird dabei nie entfernt.
- **Läufe und Fehler:** Das Skript zählt pro Schnittstelle, wie oft es lief, wie lange es brauchte und ob es etwas geändert hat (`werbefrei.feed.runs`). Fehler werden nicht mehr verschluckt, sondern festgehalten (`werbefrei.feed.errors`, die letzten 5).
- **Kennzeichnung strenger:** Ein Text zählt nur noch als „Gesponsert“-Etikett, wenn er höchstens 48 Byte lang ist und nach dem Wort endet oder ein Trenner folgt (· • | - – —). Eine Videobeschreibung wie „Sponsored by NordVPN – …“ oder „Gesponsert von …“ bleibt so stehen.
- **Entitäts-Schlüssel** zählen nur noch in Base64-Schreibweise, zum Beispiel nicht bei Vorlagen-Namen.

### Nachtrag „werbefrei-6“ (08.11.2026): Feed-Einträge in unbekanntem Aufbau

Anlass: Werbe-Bericht vom 08.11.2026, 11:42, zur Anzeige „BH ohne Bügel · Gesponsert · Velura Switzerland“. Eine Startseiten-Antwort von 623 KB hatte **0 erkannte Einträge**, nach dem Filter blieben `pagead`, `googleadservices`, `/aclk?` und zweimal die Kennzeichnung übrig. Die Feed-Einträge standen in einem Feld, das das Schema des Originals nicht kennt, und zwar innerhalb des Inhalts, nicht ganz oben. Die nächste Antwort, die übliche Fortsetzung, wurde normal gefiltert.

Zusätzlich geändert:
- **Tiefe Suche:** Nach dem bisherigen Filter werden alle unbekannten Felder der ganzen Antwort mit Werbe-Merkmalen untersucht, nicht nur die obersten.
  - Darin werden Listen von Feed-Einträgen gesucht, also Einträge mit `elementRenderer` (Feld 153515154) direkt oder eine Ebene tiefer.
  - Entfernt wird ein Eintrag aus so einer Liste nur, wenn er Werbe-Merkmale trägt und daneben mindestens ein normaler Feed-Eintrag steht, oder wenn er `pagead` enthält. So geht das Original auch sonst vor.
  - Feed-Einträge selbst werden nie teilweise beschnitten, Listen ohne Feed-Einträge (z. B. Beschreibungen) bleiben unangetastet.
- **Oberste Felder:** Findet die Listen-Regel dort nichts, wird dieselbe tiefe Suche versucht.
- **Protokoll:** Neue Zeilen „tief feld N“ (✂︎ mit Anzahl entfernter Einträge, ⚠︎ wenn nichts entfernt werden konnte).

### Nachtrag „werbefrei-7“ (15.11.2026): ganzer Filter auch für get_watch

Anlass: Sponsor-Bericht vom 15.11.2026, 16:18. Eine `get_watch`-Antwort (Video-Seite mit Player und Empfehlungen in einem Stück) hatte nach dem Filter noch `pagead`, `googleadservices`, `doubleclick.net`, `/aclk?` und viermal die Kennzeichnung. Das Original wendet bei `get_watch` auf den Next-Teil nur die Eintrags-Prüfung an. Unsere Zusätze (oberste unbekannte Felder, Abschnitte, tiefe Suche) liefen dort nicht.

Geändert: Bei `get_watch` laufen für den Next-Teil jetzt dieselben Schritte wie bei `next`.

`node tests/feed-ads-test.mjs` prüft das alles, auch Startseite, Nachladen beim Scrollen, unbekannten Aufbau mit und ohne Hülle, `get_watch` und dass die Antwort gültiges protobuf bleibt: Mit dem Original schlagen 32 Prüfungen fehl, mit der geänderten Fassung keine.

## Video-Start: `youtube.ump.js` und `youtube.init.js` (25.11.2026)

Anlass: Neue YouTube-Apps (21.46.3) zeigen beim Video bzw. beim automatischen Weiterspringen „Ein Fehler ist aufgetreten – Tippe, um es erneut zu versuchen“. Titel, Kommentare und Empfehlungen laden trotzdem. Gemeldet auch bei Maasea (Issue #111, 25.11.2026). Dort hilft das Zurückgehen auf Fassung `2ead6ff`.

Bis dahin hat unser Modul die Video-Startanfrage `initplayback` **immer** leer beantwortet. Die App ist dann auf `/youtubei/v1/player` ausgewichen, und das klappt mit den neuen App-Fassungen nicht mehr zuverlässig.

Jetzt läuft es wie in Maasea `2ead6ff`, aber ohne fremden Server:
- **`youtube.response.js`** liest zusätzlich `config` und `log_event` und merkt sich den Onesie-Schlüssel (`YouTubeConfig`). Diese Funktion steckt schon im Original 65075cd und war bei uns bisher nur nicht eingeschaltet. Am Skript selbst ändert sich nichts.
- **`youtube.init.js`** (eigenes Skript, ~120 Zeilen, lesbar):
  - `initplayback` geht unverändert durch, wenn der Schlüssel passt. Sonst kommt eine leere Antwort (Player-Weg) und der Schlüssel wird neu geholt.
  - Bei `log_event` ohne Schlüssel entfernt es die Köpfe `x-youtube-hot-hash-data` und `content-encoding` (wie Maasea 2ead6ff und Fix 6cf1621).
  - Kein Netzwerk, keine Mitteilung. Nur ein Zähler `werbefrei.init.stats` für den Bericht.
- **`youtube.ump.js`** (Kopie aus Maasea 2ead6ff, seit 27.11.2026 leicht geändert, siehe „Nachtrag UMP“):
  - Entschlüsselt den Player-Teil der `initplayback`-Antwort (UMP/Onesie) mit dem gespeicherten Schlüssel, entfernt die Werbung wie bei `/player` und verschlüsselt wieder.
  - Antworten ohne Player-Teil gehen unverändert durch.
  - Klappt das Entschlüsseln nicht, antwortet es leer (Player-Weg) und löscht den Schlüssel.

| | |
|---|---|
| Quelle | https://github.com/Maasea/sgmodule/blob/2ead6ff5950d7722c4aa6658998904ef78eee531/Script/Youtube/youtube.ump.js |
| Commit | `2ead6ff5950d7722c4aa6658998904ef78eee531` vom 11.07.2026 („fix: pip error #102 #101 #98 #83“), danach beim Autor durch einen Cloudflare-Worker ersetzt |
| UMP-Skript SHA-256: | `9753ed6f4c204f36c0bdc4545c72280e49a0d4a77c1cccf5df8b3a979661a1cb` (geänderte Fassung, siehe unten) |
| UMP-Original-Prüfsumme | `0694f1ec6ae1cd3406b8032777dbefaa1dc7a30bbb51f5c9de42cda4d5b246d4` (unverändert vom Autor) |
| Geprüft am | 25.11.2026 |

Was in `youtube.ump.js` geprüft wurde:
- **URLs:** Nur der Doku-Link der protobuf-Bibliothek und `translate.google.com` für die Übersetzung von Untertiteln und Liedtexten. Die Übersetzung ist im Modul abgeschaltet (`"captionLang":"off","lyricLang":"off"`, auch die Standardwerte sind „off“). Darum fragt das Skript nie dort an.
- **Kein Nachladen:** kein Worker, kein `eval`, kein `new Function`, kein `require`.
- **Verschlüsselung:** stammt aus @noble/ciphers bzw. @noble/hashes (MIT, im Skript gebündelt).
- **Speicher:** nur lokal in Surge, der Schlüssel `YouTubeConfig` und der Werbe-Zwischenspeicher `YouTubeAdvertiseInfo`. Es nutzt die Versionskennung des Originals, darum ignoriert unser Hauptskript diese Einträge, und umgekehrt.

`node tests/init-test.mjs` prüft:
- Durchlassen, Ausweichen, Schlüssel neu holen und Kopfzeilen bei `log_event`.
- Den Weg des Schlüssels von `youtube.response.js` (config) zu `youtube.init.js`.
- Das sichere Verhalten von `youtube.ump.js`: leere Antwort statt Absturz, kein Netzwerk.

`node tests/pruefen.mjs` prüft den Hash von `youtube.ump.js`.

### Nachtrag UMP (27.11.2026): Sicherheitsnetz, ungepackte Daten, Zähler

Anlass: Bericht vom 27.11.2026, 17:51.
- Mit Modul v2 kamen wieder **Werbevideos vor oder im Video**, und der Fehler „Ein Fehler ist aufgetreten“ trat noch manchmal auf.
- Surge zeigte nur 1 von 8 Video-Starts als verändert.
- Die Kopie des Originals lässt eine Antwort unverändert durch, **samt Werbung**, wenn sie keinen Player-Teil mit Kopf-Typ 25 findet.
- Sie erwartet den Inhalt außerdem immer gzip-gepackt.

Geändert (Kopfzeile im Skript vermerkt):
- **Sicherheitsnetz:**
  - Enthält eine Antwort Onesie-Teile (UMP-Typ 10), aber keinen bearbeitbaren Player-Teil, antwortet das Skript leer. Dann nimmt die App den Player-Weg, den `youtube.response.js` filtert. Der Schlüssel bleibt dabei erhalten.
  - Antworten ganz ohne Onesie-Teile gehen weiter unverändert durch.
- **Ungepackte Daten:**
  - Ist der entschlüsselte Inhalt nicht gzip-gepackt, wird er direkt gelesen und ungepackt zurückgeschrieben.
  - Brotli-gepackte Daten kann das Skript nicht lesen. Es meldet das klar, und das Sicherheitsnetz greift.
- **Zähler ohne Inhalte** (`werbefrei.ump.stats`):
  - Ergebnis pro Antwort: bearbeitet, ohne Player-Teil, ohne Onesie, Fehler.
  - Dazu Größe, Anzahl der UMP-Teil-Typen und Onesie-Kopf-Typen, Packart und Fehlermeldung.
  - Der Werbefrei-Bericht zeigt das.

`node tests/init-test.mjs` baut dafür eine echte verschlüsselte Onesie-Antwort nach (AES-128-CTR + HMAC-SHA256, gzip und ungepackt) und prüft:
- Die Werbung (`adPlacements`, `adSlots`) wird entfernt.
- Die Prüfsumme der neu verschlüsselten Antwort stimmt.
- Das Sicherheitsnetz greift.

### Nachtrag „werbefrei-8“ (27.11.2026)

`youtube.response.js` hält bei Fehlern zusätzlich die Schnittstelle und die ersten Zeilen der Fehlerstelle fest. Anlass: Im Bericht stand mehrmals nur „Ki: Type error“.

## Warum eine Kopie statt eines Links zum Original?

- **Kein ungeprüfter Code:** Das Original-Modul lädt das Skript immer in der neuesten Fassung. Jede Änderung beim Autor würde sofort auf deinem iPhone laufen und könnte deinen entschlüsselten YouTube-Verkehr sehen. Diese Kopie ändert sich nur, wenn wir sie bewusst aktualisieren und neu prüfen.
- **Kein fremder Server:** Das Original-Modul enthält heute noch ein zweites Skript, `youtube.request.js`. Es leitet die Video-Startanfrage (`initplayback`) an `https://init-stream.maasea.workers.dev/` um, einen Server des Skript-Autors. Dabei gehen die Video-Adresse und ein Schlüssel aus der YouTube-Sitzung an diesen Server. **Dieses Skript übernehmen wir nicht.** Bis 24.11.2026 hat unser Modul `initplayback` lokal leer beantwortet. Seit dem 25.11.2026 filtert es die Antwort lokal mit `youtube.ump.js`, siehe oben.

## Was geprüft wurde

- Das Skript enthält keine Server-Adressen. Die einzige URL ist ein Doku-Link in einer Fehlermeldung der protobuf-Bibliothek.
- Die Netzwerkfunktion (`fetch` über `$httpClient` bzw. `$task`) ist zwar definiert, wird aber **nirgends aufgerufen**. Früher war sie für die Untertitel-Übersetzung da.
- Es gibt kein `eval`, kein `new Function`, kein `require` und keinen Zugriff auf `process`.
- Gespeichert wird nur lokal in Surge (`$persistentStore`): ein Werbe-Zwischenspeicher, Konfigurationsschlüssel und (unsere Änderung) Feed-Protokoll, Läufe, Fehler und Spurensuche, jeweils ohne Inhalte.
- Was das Skript tatsächlich tut: Es liest die protobuf-Antworten von `youtubei.googleapis.com` und löscht Werbe-Einträge, also `adPlacements`, `adSlots`, Werbung im Shorts-Feed und Werbe-Elemente im Feed. Danach gibt es die Antwort zurück. Außerdem schaltet es Bild-in-Bild und Hintergrundwiedergabe frei und blendet auf Wunsch Knöpfe aus.

`node tests/pruefen.mjs` prüft die Punkte oben automatisch. Ändert sich das Skript, schlägt der Hash-Vergleich fehl, und es muss neu geprüft werden.

## Skript aktualisieren (wenn YouTube etwas ändert)

1. Neue Fassung bei Maasea ansehen und den Commit notieren.
2. Den Unterschied prüfen, vor allem auf neue URLs, `fetch`-Aufrufe und `workers.dev`.
3. Datei ersetzen, Commit und SHA-256 oben eintragen.
4. `node tests/pruefen.mjs` ausführen.
