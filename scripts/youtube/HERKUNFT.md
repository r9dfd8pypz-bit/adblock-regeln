# Herkunft und Prüfung des YouTube-Skripts

`youtube.response.js` stammt von **Maasea/sgmodule** und steht unter der Apache-2.0-Lizenz (siehe `LICENSE` in diesem Ordner). **Seit 06.11.2026 ist die Datei an drei Stellen geändert** (siehe unten); die Änderung ist im Dateikopf vermerkt.

| | |
|---|---|
| Quelle | https://github.com/Maasea/sgmodule/blob/65075cdb388fc5e3094afd7e7314c67b243f3525/Script/Youtube/youtube.response.js |
| Commit | `65075cdb388fc5e3094afd7e7314c67b243f3525` vom 19.07.2026 („#100 fix ad judgment“) |
| SHA-256: | `fd2e08c5e0f15468bdb4ee1312da03fdace8ce9bbe6847f66bfbea9ecb34f582` (geänderte Fassung) |
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

`node tests/feed-ads-test.mjs` prüft das: Mit dem Original schlagen 4 Prüfungen fehl, mit der geänderten Fassung keine.

## Warum eine Kopie statt eines Links zum Original?

- **Kein ungeprüfter Code:** Das Original-Modul lädt das Skript immer in der neuesten Fassung. Jede Änderung beim Autor würde sofort auf deinem iPhone laufen und könnte deinen entschlüsselten YouTube-Verkehr sehen. Diese Kopie ändert sich nur, wenn wir sie bewusst aktualisieren und neu prüfen.
- **Kein fremder Server:** Das Original-Modul enthält noch ein zweites Skript, `youtube.request.js`. Es leitet die Video-Startanfrage (`initplayback`) an `https://init-stream.maasea.workers.dev/` um, einen Server des Skript-Autors. Dabei gehen die Video-Adresse und ein Schlüssel aus der YouTube-Sitzung an diesen Server. **Dieses Skript übernehmen wir nicht.** Unser Modul beantwortet `initplayback` stattdessen lokal leer. Die App fällt dann auf die normale Player-Anfrage zurück. Das ist derselbe Rückfallweg, den das Original selbst nutzt, wenn es noch keinen Schlüssel kennt.

## Was geprüft wurde

- Das Skript enthält keine Server-Adressen. Die einzige URL ist ein Doku-Link in einer Fehlermeldung der protobuf-Bibliothek.
- Die Netzwerkfunktion (`fetch` über `$httpClient` bzw. `$task`) ist zwar definiert, wird aber **nirgends aufgerufen**. Früher war sie für die Untertitel-Übersetzung da.
- Es gibt kein `eval`, kein `new Function`, kein `require` und keinen Zugriff auf `process`.
- Gespeichert wird nur lokal in Surge (`$persistentStore`): ein Werbe-Zwischenspeicher und Konfigurationsschlüssel.
- Was das Skript tatsächlich tut: Es liest die protobuf-Antworten von `youtubei.googleapis.com` und löscht Werbe-Einträge, also `adPlacements`, `adSlots`, Werbung im Shorts-Feed und Werbe-Elemente im Feed. Danach gibt es die Antwort zurück. Außerdem schaltet es Bild-in-Bild und Hintergrundwiedergabe frei und blendet auf Wunsch Knöpfe aus.

`node tests/pruefen.mjs` prüft die Punkte oben automatisch. Ändert sich das Skript, schlägt der Hash-Vergleich fehl, und es muss neu geprüft werden.

## Skript aktualisieren (wenn YouTube etwas ändert)

1. Neue Fassung bei Maasea ansehen und den Commit notieren.
2. Den Unterschied prüfen, vor allem auf neue URLs, `fetch`-Aufrufe und `workers.dev`.
3. Datei ersetzen, Commit und SHA-256 oben eintragen.
4. `node tests/pruefen.mjs` ausführen.
