# Familienkalender – Supabase + Android

## Was fertig ist
Die vorhandene HTML-Oberfläche bleibt erhalten. E-Mail/Passwort-Login, zentrale Speicherung mit Supabase, RLS-Zugriffsschutz, Realtime-Aktualisierung (mit 30-Sekunden-Fallback), PWA-Grundgerüst und Capacitor-Konfiguration sind ergänzt. **Es ist noch keine APK kompiliert.** Ohne Supabase-Konfiguration ist die App gesperrt. Offline-Bearbeitung ist nicht implementiert.

## 1. Supabase einrichten
1. Unter https://supabase.com ein Projekt erstellen.
2. Im **SQL Editor** `supabase.sql` ausführen. Für bestehende Tabellen/Policies SQL vor erneutem Ausführen prüfen.
3. Unter **Project Settings > API** Projekt-URL und **publishable / anon key** kopieren (niemals `service_role`). In `config.js` eintragen. `familyId` wie in `supabase.sql` belassen.
4. Unter **Authentication > Providers > Email** E-Mail-Anmeldung aktivieren. Registrierung ggf. nur während der Einrichtung zulassen und danach deaktivieren. E-Mail-Bestätigung für produktiven Einsatz aktiv lassen.
5. Unter **Authentication > URL Configuration** die spätere HTTPS-Webadresse als Site URL bzw. Redirect URL konfigurieren.
6. Unter **Database > Publications > supabase_realtime** Tabelle `events` aktivieren. Ohne diese Einstellung erfolgt Abgleich etwa alle 30 Sekunden, solange die App im Vordergrund ist.

## 2. Familienmitglieder freischalten
1. App im Browser öffnen und mit der E-Mail für jedes Mitglied ein Konto anlegen; E-Mail ggf. bestätigen.
2. Im Supabase-Dashboard unter **Authentication > Users** die jeweilige **User UID** kopieren.
3. Im SQL Editor für jede Person ausführen:

```sql
insert into public.family_members(family_id,user_id)
values ('11111111-1111-4111-8111-111111111111','HIER-USER-UUID-EINTRAGEN');
```

Danach neu anmelden bzw. die Seite neu laden. Die UUID ist kein Passwort. Keine anonyme öffentliche Schreibberechtigung vergeben. Für ein Kind ggf. ein von den Sorgeberechtigten verwaltetes Konto verwenden und Datenschutz-/Altersvorgaben des Anbieters prüfen.

## 3. Web-App / PWA
Die Dateien `index.html`, `config.js`, `manifest.webmanifest`, `icon.svg` und `service-worker.js` per HTTPS hosten, z.B. Netlify oder GitHub Pages. Supabase-Zugang wird auch mit PWA über das Internet benötigt. PWA-Installierbarkeit hängt vom Browser und Icon-Support ab; für zuverlässige Installation ggf. PNG-Icons in 192/512 Pixel ergänzen.

## 4. Android-Projekt / APK bauen
Voraussetzungen: Node.js, Android Studio + Android SDK, Java JDK.

```bash
npm install
mkdir www
cp index.html config.js manifest.webmanifest icon.svg service-worker.js www/
npm run android:add
npm run android:sync
npm run android:open
```

Unter Windows `mkdir www` und Dateien per Explorer nach `www` kopieren. In Android Studio: **Build > Build Bundle(s) / APK(s) > Build APK(s)**. Die Debug-APK liegt typischerweise unter `android/app/build/outputs/apk/debug/app-debug.apk`. Für Weitergabe/Updates eine signierte Release-APK erzeugen und den Signaturschlüssel sicher aufbewahren.

**Hinweis:** Die Supabase-JS-Bibliothek wird aktuell über CDN geladen; für einen robusten Release-Build sollte sie lokal gebündelt und eine CSP ergänzt werden. Keine Datenbank-Zugangsdaten mit Administratorrechten in die App einbauen.

## Bestehende Termine
Die alten Termine liegen nur im `localStorage` des ursprünglichen Browsers und werden **nicht automatisch übernommen**. Vor der Umstellung Daten sichern; bei Bedarf ein separates einmaliges Importskript erstellen. Diese Version enthält bewusst keinen automatischen Import, um versehentliche Duplikate zu vermeiden.

## Grenzen
Keine Push-Benachrichtigungen, kein Homescreen-Widget, keine vollständige Offline-Synchronisation. Die Anmeldung und Synchronisation müssen auf echten Geräten getestet werden. Android-Projekt wird erst durch `npm run android:add` erzeugt.
