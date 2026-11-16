# Schritt 3: Ganzer Haushalt über die Fritzbox (gratis)

Damit sind **alle Geräte im WLAN** geschützt: Fernseher, Apple TV, Laptops, Tablets und Gäste. Die Fritzbox fragt dafür einen kostenlosen Werbefilter-DNS: **AdGuard DNS**. Es braucht kein Konto, kein Abo und kein zusätzliches Gerät. Die Fritzbox kann verschlüsseltes DNS selbst (DNS over TLS, ab FRITZ!OS 7.20).

Dein iPhone behält NextDNS und Surge, es nutzt sein eigenes Profil.

Dieselbe Anleitung mit Kopier-Knöpfen steht in der Werbefrei-App unter **Zuhause & Internet → Ganzer Haushalt**.

## Einstellen (im WLAN zu Hause, etwa 5 Minuten)

1. **fritz.box** öffnen und mit dem Fritzbox-Kennwort anmelden.
2. **Internet → Zugangsdaten →** Reiter **DNS-Server**.
3. **Andere DNSv4-Server verwenden** wählen und eintragen:
   - Bevorzugter DNSv4-Server: `94.140.14.14`
   - Alternativer DNSv4-Server: `94.140.15.15`
4. **Andere DNSv6-Server verwenden** wählen und eintragen:
   - Bevorzugter DNSv6-Server: `2a10:50c0::ad1:ff`
   - Alternativer DNSv6-Server: `2a10:50c0::ad2:ff`
5. Bei **Verschlüsselte Namensauflösung im Internet (DNS over TLS)**:
   - ☑ **Verschlüsselte Namensauflösung verwenden**
   - ☑ **Zertifikatsprüfung für verschlüsselte Namensauflösung im Internet erzwingen**
   - **Fallback auf unverschlüsselte Namensauflösung** darf an bleiben. Weil oben die AdGuard-Adressen stehen, filtert AdGuard auch dann, nur unverschlüsselt. So bleibt das Internet erreichbar, falls die Verschlüsselung einmal hakt.
   - Ins Feld **Auflösungsnamen der DNS-Server** kommt:
     ```
     dns.adguard-dns.com
     ```
6. **Übernehmen** tippen. Danach bei den anderen Geräten einmal WLAN aus- und wieder einschalten. Klappt es nicht sofort, die Fritzbox einmal neu starten.

Je nach FRITZ!OS-Version heißen die Menüpunkte etwas anders.

## Testen

Nimm ein Gerät **ohne** NextDNS-Profil, zum Beispiel das MacBook im WLAN. Öffne dort die Testseite **d3ward.github.io/toolz/adblock**. Ein hoher Prozentwert heißt, dass der Filter wirkt.

Am iPhone klappt dieser Test nicht, weil es sein eigenes NextDNS-Profil nutzt.

## Grenzen

- **YouTube am Apple TV (und am Fernseher):** Diese Werbung bleibt. Sie kommt von denselben Servern wie die Videos, das kann kein DNS-Filter trennen. Dafür planen wir ein eigenes Experiment.
- **Geräte mit eigenem DNS** fragen nicht die Fritzbox, zum Beispiel Chromecast oder Handys mit „Privatem DNS“. Sie werden nicht gefiltert.
- **Werbung in Apps mit eigenen Servern**, zum Beispiel Instagram, Facebook, TikTok oder Spotify, bleibt ebenfalls.

## Rückgängig machen

Im selben Menü wieder **DNS-Server des Internetanbieters verwenden** wählen und den Haken bei *Verschlüsselte Namensauflösung verwenden* entfernen. Dann ist alles wie vorher.

## Alternative: NextDNS auch für die Fritzbox

NextDNS lässt sich auch für die Fritzbox nutzen: Bei *Auflösungsnamen* `Fritzbox-abc123.dns.nextdns.io` eintragen, mit deiner ID statt `abc123`. Dann siehst du alle Geräte in den NextDNS-Logs und kannst eigene Listen nutzen. Gratis sind aber nur 300.000 Anfragen im Monat für alle Geräte zusammen. Mit dem ganzen Haushalt reicht das meist nicht, danach wird bis Monatsende nicht mehr gefiltert. Darum ist AdGuard DNS hier die gratis Wahl.
