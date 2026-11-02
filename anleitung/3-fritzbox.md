# Schritt 3 (optional, später): Fritzbox auf NextDNS

Damit sind **alle Geräte im WLAN** geschützt, zum Beispiel Fernseher, Konsole und Tablet. Einen Raspberry Pi brauchst du dafür nicht, die Fritzbox kann verschlüsseltes DNS selbst (DNS over TLS, ab FRITZ!OS 7.20).

> **Erst nach einer Woche iPhone-only machen.** Wenn alle Geräte über NextDNS laufen, steigt der Verbrauch deutlich. Prüf zuerst, wie viel dein iPhone allein verbraucht ([Schritt 1, Punkt 5](1-nextdns-iphone.md#5-verbrauch-im-blick-behalten)).

## Einstellen (am iPhone, im WLAN zu Hause)

1. In Safari **fritz.box** öffnen und anmelden.
2. **Internet → Zugangsdaten →** Tab **DNS-Server**.
3. Bei **Verschlüsselte Namensauflösung im Internet (DNS over TLS)**:
   - ☑ **Verschlüsselte Namensauflösung verwenden**
   - ☑ **Zertifikatsprüfung für verschlüsselte Namensauflösung im Internet erzwingen**
   - ☐ **Fallback auf unverschlüsselte Namensauflösung im Internet zulassen**: Haken *weg*. Sonst wechselt die Fritzbox manchmal unbemerkt zurück auf die DNS-Server deines Anbieters.
   - Ins Feld **Auflösungsnamen der DNS-Server** kommt:
     ```
     Fritzbox-abc123.dns.nextdns.io
     ```
     Statt `abc123` trägst du deine NextDNS-ID ein. Das `Fritzbox-` davor sorgt dafür, dass du die Fritzbox in den NextDNS-Logs erkennst.
4. Die DNSv4- und DNSv6-Server **so lassen, wie sie sind**. Laut AVM braucht die Fritzbox sie, um den Namen oben aufzulösen.
5. **Übernehmen** tippen. Wenn es danach nicht sofort klappt, die Fritzbox einmal neu starten.

Je nach FRITZ!OS-Version heißen die Menüpunkte etwas anders.

## Testen

Nimm ein Gerät **ohne** NextDNS-Profil, zum Beispiel das MacBook im WLAN, und öffne **test.nextdns.io**. Dort muss `"status": "ok"` stehen und bei `deviceName` muss `Fritzbox` stehen.

Am iPhone klappt dieser Test nicht, weil es über sein eigenes Profil ohnehin NextDNS nutzt.

## Gut zu wissen

- In den NextDNS-Logs erscheinen alle Geräte im Haushalt zusammen als „Fritzbox“.
- Ohne Fallback gilt: Fällt NextDNS aus, lädt im Heimnetz keine Seite mehr. Das ist selten. Wenn es passiert, setzt du den Fallback-Haken vorübergehend wieder.
- Rückgängig machen: Den Haken bei *Verschlüsselte Namensauflösung verwenden* entfernen.
