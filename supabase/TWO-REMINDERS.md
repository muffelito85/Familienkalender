# Zwei frei wählbare Erinnerungen

## Verhalten

Termine und Aufgaben haben jeweils zwei unabhängige Felder mit NULL/15/30/60/1440/10080 Minuten. Beide Felder stehen bei neuen Einträgen auf „Keine Erinnerung“. Die zweite Erinnerung funktioniert auch bei leerer erster Auswahl. Gleiche Werte erzeugen nur einen Versandauftrag. Die Reihenfolge der Felder ist für den Benachrichtigungsschlüssel unerheblich.

Zeitgebundene Termine beziehen sich auf ihre Startzeit. Ganztägige Termine und Aufgaben ohne Uhrzeit beziehen sich auf 09:00 Uhr in Europe/Berlin. Bei Aufgaben ohne Uhrzeit liegen 15/30/60 Minuten vorher also um 08:45/08:30/08:00 Uhr am Fälligkeitstag. Nur ausdrücklich gewählte Tages-/Wochenabstände erinnern entsprechend früher. Ein ausgewähltes Aufgabenintervall setzt ein Fälligkeitsdatum voraus.

„1 Tag“ und „1 Woche“ sind lokale Kalenderabstände und erhalten über eine Zeitumstellung dieselbe Berliner Uhrzeit; Minuten-/Stundenabstände sind verstrichene Minuten. Für die doppelte Herbststunde wird der erste Zeitpunkt verwendet; eine nicht existierende Uhrzeit im Frühjahr wird um die Zeitlücke nach vorne verschoben.

## Migration und bestehende Einträge

Migration: `supabase/migrations/20261115190657_two_independent_reminders.sql`.

- `events.reminder_minutes` und alle bisherigen Werte bleiben erhalten; der bestehende CHECK wird um 30 Minuten erweitert.
- Neu: `events.reminder2_minutes`, `tasks.reminder_minutes`, `tasks.reminder2_minutes`, jeweils nullable Integer mit NULL als deaktiviertem Standard.
- Zusätzlich je Tabelle `legacy_due_notification` (Boolean, Standard false). Beim erstmaligen Anlegen werden ausschließlich bestehende Aufgaben ohne konfigurierte Intervalle sowie bestehende ganztägige Termine ohne konfigurierte Intervalle markiert. So bleibt ihre zuvor automatische Fälligkeits-/09:00-Nachricht erhalten. Es werden keine Intervalle automatisch ausgewählt.
- Beim Bearbeiten erscheint dafür „Bisherige … beibehalten“. Reines Bearbeiten des Titels erhält diese Nachricht. Explizites Abwählen deaktiviert sie. Sobald ein individuelles Intervall gespeichert wird, ersetzt es die Bestandsnachricht. Es entstehen niemals zusätzlich zwei konfigurierte Erinnerungen UND eine dritte Bestandsnachricht.
- Ein erneuter Migrationslauf ändert weder gespeicherte Intervalle noch deaktivierte Bestandsmarker. Keine Inhalte, Versandprotokolle, Claim-Funktionen oder RLS-Regeln werden gelöscht/geändert.

Der lokale PostgreSQL-Test enthält alte Aufgaben mit/ohne Uhrzeit, alte Termine mit/ohne Erinnerung, einen alten ganztägigen Termin und eine unveränderte Versandhistorie. Die Migration wird dreimal ausgeführt und anschließend auf Datenverlust, NULL-Standards und Constraint-Verhalten geprüft.

## Benachrichtigungsschlüssel und Nachholen

Event-Schlüssel bleiben `event:<id>:<Vorkommen-Datum>:<Intervall>`. Dadurch bleibt die bisherige erste Erinnerung dedupliziert; auch das Vertauschen der beiden Felder sendet nicht erneut. Neue Aufgabenstufen verwenden `task:<id>:<Datum>:<HH:MM>:lead:<Intervall>`. Die alte Fälligkeitsnachricht behält ihren bisherigen Schlüssel einschließlich des ursprünglichen Uhrzeitformats. Identische Intervalle werden bereits vor dem Claim zusammengefasst.

`claim_notification_delivery`, die eindeutige Benutzer/Schlüssel-Kombination, private Empfängerrechte, individuelle Ruhezeiten und Geburtstage/Jahrestage bleiben erhalten. Die zwei auswählbaren Felder ändern die separate Geburtstagsfunktion nicht.

Das bestehende Nachholfenster von 24 Stunden bleibt bewusst bestehen. Ein ausgefallener Aufruf, ein erst später angelegter/geänderter Eintrag, ein fehlgeschlagener Versand mit später erfolgreichem Retry oder eine Ruhezeit können deshalb zu einer späteren Sendung führen. Es werden keine Erinnerungen verworfen, um eine Verzögerung zu verstecken. Die bestehenden Grenzen für das Nachholen bleiben unverändert.

## Untersuchung der gemeldeten 137 Minuten (15.11.2026)

Read-only-Prüfung um ca. 19:57 Uhr Europe/Berlin:

- Cronjob aktiv mit `* * * * *`; 3.468 gespeicherte Läufe ab 13.11., kein als fehlgeschlagen markierter SQL-Lauf. Einziger Abstand über 90 Sekunden: etwa vier Minuten während der Einrichtung am 13.11. gegen 10:07–10:11 Uhr. Das erklärt keine 137 Minuten beim späteren Test.
- Die vorhandenen erfolgreichen Versandzeilen zeigen keine serverseitige Verzögerung von 137 Minuten. Die zum geschilderten 11:30-Uhr-Plan passende Gruppe am 14.11. wurde um 11:30:01,646 bzw. 11:30:02,036 Uhr als angenommen protokolliert. Ohne eine eindeutige Zuordnung zum gemeldeten Handyhinweis ist dies kein abschließender Beweis für dessen konkrete Ursache.
- Die 24-Stunden-Logik könnte grundsätzlich einen Versand 137 Minuten nach Plan auslösen. Ein isolierter Test reproduziert exakt 11:30 → 13:47 Uhr und stellt sicher, dass diese Nachholung erhalten und mit 8.220 Sekunden protokolliert wird.
- `sent_at` bezeichnet die Annahme beim Push-Dienst; eine Empfangs-/Anzeigequittung des Android-Geräts existiert nicht. Android ist daher nicht als Ursache nachgewiesen. Die genaue Ursache der gemeldeten Anzeige um 13:47 Uhr bleibt offen.
- Es gibt fehlgeschlagene Aufgabenaufträge ohne Push-Abonnement für deren Empfänger. Diese Zeilen hatten keinen erfolgreichen Versand und belegen den genannten verspäteten Empfang nicht.

Neue strukturierte Logs `reminder_provider_accepted` enthalten Schlüssel (keinen Titel), Planzeit, Ruhezeit-Anpassung, tatsächlichen Versuch, Provider-Annahme und beide Zeitabstände. Die HTTP-Antwort ergänzt `late_sent` (>90 Sekunden) und `max_delay_seconds`. Die SQL-Abfragen in `supabase/reminder-timing-audit.sql` vergleichen weiterhin `scheduled_for` und `sent_at` und prüfen Cron-Abstände und HTTP-Ergebnisse. Eine erfolgreiche SQL-Cronzeile allein wird nicht als Zustellbeweis gewertet.

## Sichere produktive Übernahme

Dieser PR allein aktiviert die Erweiterung noch nicht. Bis zur Übernahme bleiben Produktionsschema und Edge Function auf ihrem bisherigen Stand.

1. In einer abgestimmten kurzen Übernahmephase den vorhandenen Cronjob pausieren: `select cron.alter_job(job_id:=1,active:=false);`. Bei abweichender Job-ID zuerst anhand des Namens ermitteln.
2. SQL-Migration im SQL Editor bzw. über den abgestimmten Migrationsweg ausführen. Sie ist additiv und idempotent; sie hält kurz Tabellenlocks, löscht aber keine Einträge. Ein lokal leerer Migrationsordner bildet die bereits vorhandene Remote-Historie nicht vollständig ab: nicht blind einen allgemeinen `db push`/`db reset` ausführen.
3. `supabase/functions/dynamic-api/index.ts` aus genau diesem PR deployen. Bestehende Secrets unverändert lassen, `verify_jwt=false` mit vorhandener HMAC-/Cron-Authentifizierung beibehalten. Scheduler-Setup oder Schlüsselrotation nicht erneut ausführen.
4. `select family_reminder_internal.invoke('dry-run');` ausführen. Die Request-ID in `net._http_response` prüfen: HTTP 200, `success=true`, `no_push_sent=true`. Der Probelauf claimt keine Versandzeilen und sendet keine Push-Nachricht.
5. Erst danach diesen PR nach `main` übernehmen; auf erfolgreiches GitHub-Pages-Deployment warten. Die Service-Worker-Version 20 lädt das geänderte Formular. Bereits geöffnete Apps anschließend neu laden; alte App-Versionen kennen die zweite Auswahl noch nicht und sollten während der Übernahme nicht bearbeiten.
6. Cronjob wieder aktivieren: `select cron.alter_job(job_id:=1,active:=true);`. Den nächsten Lauf UND dessen HTTP-Antwort kontrollieren. Ein echter Android-Test mit zwei kurzen Intervallen bleibt Teil der Abnahme.

Bei einem Fehler Cron pausiert lassen, keine Daten/Spalten löschen. Die additive Migration kann liegenbleiben. Vor einem Rollback des Senders beachten: der alte Sender würde neue Aufgaben mit NULL-Intervallen wieder automatisch zur Fälligkeit benachrichtigen und kennt die zweite Stufe nicht. Daher keinen unkoordinierten Backend-Rollback bei laufendem Cron durchführen.

## Tests

Mit Node 26 (getestet): `npm ci --prefix tests`, anschließend `npm test --prefix tests`.

Die bisherige Regression bleibt erhalten. Ergänzt sind 33 Versandfälle, reale lokale PostgreSQL-Migrationsprüfungen und Formular-Tests für Defaults, beide Auswahlfelder, erneutes Laden/Speichern, Sichtbarkeit und Bestandsnachrichten. Alle Tests arbeiten isoliert ohne produktiven Versand. PGlite ist ausschließlich eine fest versionierte Testabhängigkeit; das Frontend erhält keine neue Bibliothek.
