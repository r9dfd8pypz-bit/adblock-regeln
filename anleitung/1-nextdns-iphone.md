# Schritt 1: NextDNS auf dem iPhone (kostenlos)

NextDNS sperrt Werbe- und Tracker-Domains in **allen Apps**, im WLAN und im Mobilfunk. Du brauchst etwa 10 Minuten und alles läuft am iPhone.

## 1. Konto anlegen

1. In Safari **my.nextdns.io** öffnen und ein kostenloses Konto anlegen.
2. Im Tab **Setup** steht deine **ID** (6 Zeichen, zum Beispiel `abc123`). Notier sie, du brauchst sie noch öfter.

## 2. Filter einstellen

1. Tab **Privacy** (Datenschutz) → **Blocklists** → *Add a blocklist*:
   - **NextDNS Ads & Trackers Blocklist** (ist oft schon aktiv)
   - **HaGeZi – Multi Normal**

   Für den Anfang reichen diese zwei Listen. Mehr Listen bedeuten auch mehr Fehlalarme.
2. Tab **Settings** (Einstellungen):
   - **Logs** einschalten. So siehst du später, was gesperrt wurde.
   - **Storage location** auf **Europe** oder **Switzerland** stellen.
   - **Retention** zum Beispiel auf *1 week*.

## 3. Auf dem iPhone aktivieren

1. In Safari **apple.nextdns.io** öffnen.
2. Deine ID eintragen. Bei *Device name* `iPhone` eintragen, dann ist dein iPhone in den Logs erkennbar.
3. Profil herunterladen und **Zulassen** tippen.
4. Einstellungen öffnen → oben erscheint **Profil geladen** → **Installieren**.
5. Prüfen: Einstellungen → Allgemein → **VPN und Geräteverwaltung** → **DNS** → NextDNS ist ausgewählt.

Statt des Profils kannst du auch die App **NextDNS** aus dem App Store nehmen (ID eintragen, einschalten). Die App hat einen bequemen Ein/Aus-Schalter. Nimm aber nur eins von beiden.

## 4. Testen

- In Safari **test.nextdns.io** öffnen. Dort muss `"status": "ok"` stehen.
- In my.nextdns.io den Tab **Logs** öffnen und ein paar Apps benutzen. Die Anfragen tauchen live auf, gesperrte sind rot.

Hinweis: Wenn bei dir *iCloud Privat-Relay* aktiv ist, umgeht Safari NextDNS. Apps betrifft das nicht.

## 5. Verbrauch im Blick behalten

Nach einer Woche im Tab **Analytics** nachsehen, wie viele Anfragen es waren. Die Zahl mal 4,3 ergibt ungefähr den Monatsverbrauch.

- **Unter 300.000:** Alles bleibt kostenlos.
- **Darüber:** Laut NextDNS funktioniert das Internet weiter, bis Monatsende wird aber nicht mehr gefiltert. NextDNS schickt vorher eine Warnung per E-Mail, ab 250.000 Anfragen.

## Wenn eine App nicht mehr richtig geht

1. my.nextdns.io → **Logs** → Haken bei *Blocked queries only* setzen.
2. Die App noch einmal benutzen und sehen, welche Domain gerade rot wird.
3. Auf die Domain tippen → **Allow**. Sie landet dann in der *Allowlist*.

Oder schreib mir den Namen der App, dann suche ich die passende Ausnahme.
