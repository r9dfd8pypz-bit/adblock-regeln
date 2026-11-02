# Herkunft und Prüfung des YouTube-Skripts

`youtube.response.js` stammt unverändert von **Maasea/sgmodule** und steht unter der Apache-2.0-Lizenz (siehe `LICENSE` in diesem Ordner).

| | |
|---|---|
| Quelle | https://github.com/Maasea/sgmodule/blob/65075cdb388fc5e3094afd7e7314c67b243f3525/Script/Youtube/youtube.response.js |
| Commit | `65075cdb388fc5e3094afd7e7314c67b243f3525` vom 19.07.2026 („#100 fix ad judgment“) |
| SHA-256: | `f98483d5f5017514f82502253c0db5ce2d4ffb7839887aa2cadc22666f5a7f12` |
| Geprüft am | 02.11.2026 |

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
