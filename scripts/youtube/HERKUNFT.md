# Herkunft und Prüfung des YouTube-Skripts

`youtube.response.js` stammt von **Maasea/sgmodule** und steht unter der Apache-2.0-Lizenz (siehe `LICENSE` in diesem Ordner). **Seit 06.11.2026 ist die Datei geändert** (siehe unten); die Änderung ist im Dateikopf vermerkt.

| | |
|---|---|
| Quelle | https://github.com/Maasea/sgmodule/blob/65075cdb388fc5e3094afd7e7314c67b243f3525/Script/Youtube/youtube.response.js |
| Commit | `65075cdb388fc5e3094afd7e7314c67b243f3525` vom 19.07.2026 („#100 fix ad judgment“) |
| SHA-256: | `ec095e9a3608827bbec7f00c73e9ed5c023a9f9b0410089f50eca0d7af108544` (geänderte Fassung, Stand „werbefrei-4“) |
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

`node tests/feed-ads-test.mjs` prüft das alles, auch Startseite, Nachladen beim Scrollen und dass die Antwort gültiges protobuf bleibt: Mit dem Original schlagen 18 Prüfungen fehl, mit der geänderten Fassung keine.

## Warum eine Kopie statt eines Links zum Original?

- **Kein ungeprüfter Code:** Das Original-Modul lädt das Skript immer in der neuesten Fassung. Jede Änderung beim Autor würde sofort auf deinem iPhone laufen und könnte deinen entschlüsselten YouTube-Verkehr sehen. Diese Kopie ändert sich nur, wenn wir sie bewusst aktualisieren und neu prüfen.
- **Kein fremder Server:** Das Original-Modul enthält noch ein zweites Skript, `youtube.request.js`. Es leitet die Video-Startanfrage (`initplayback`) an `https://init-stream.maasea.workers.dev/` um, einen Server des Skript-Autors. Dabei gehen die Video-Adresse und ein Schlüssel aus der YouTube-Sitzung an diesen Server. **Dieses Skript übernehmen wir nicht.** Unser Modul beantwortet `initplayback` stattdessen lokal leer. Die App fällt dann auf die normale Player-Anfrage zurück. Das ist derselbe Rückfallweg, den das Original selbst nutzt, wenn es noch keinen Schlüssel kennt.

## Was geprüft wurde

- Das Skript enthält keine Server-Adressen. Die einzige URL ist ein Doku-Link in einer Fehlermeldung der protobuf-Bibliothek.
- Die Netzwerkfunktion (`fetch` über `$httpClient` bzw. `$task`) ist zwar definiert, wird aber **nirgends aufgerufen**. Früher war sie für die Untertitel-Übersetzung da.
- Es gibt kein `eval`, kein `new Function`, kein `require` und keinen Zugriff auf `process`.
- Gespeichert wird nur lokal in Surge (`$persistentStore`): ein Werbe-Zwischenspeicher, Konfigurationsschlüssel und (unsere Änderung) das Feed-Protokoll ohne Inhalte.
- Was das Skript tatsächlich tut: Es liest die protobuf-Antworten von `youtubei.googleapis.com` und löscht Werbe-Einträge, also `adPlacements`, `adSlots`, Werbung im Shorts-Feed und Werbe-Elemente im Feed. Danach gibt es die Antwort zurück. Außerdem schaltet es Bild-in-Bild und Hintergrundwiedergabe frei und blendet auf Wunsch Knöpfe aus.

`node tests/pruefen.mjs` prüft die Punkte oben automatisch. Ändert sich das Skript, schlägt der Hash-Vergleich fehl, und es muss neu geprüft werden.

## Skript aktualisieren (wenn YouTube etwas ändert)

1. Neue Fassung bei Maasea ansehen und den Commit notieren.
2. Den Unterschied prüfen, vor allem auf neue URLs, `fetch`-Aufrufe und `workers.dev`.
3. Datei ersetzen, Commit und SHA-256 oben eintragen.
4. `node tests/pruefen.mjs` ausführen.
