# Push-Erinnerungen

Der produktive Sender heißt `dynamic-api`. Der Quelltext liegt unter `supabase/functions/dynamic-api/index.ts`. Die Funktion verwendet weiterhin die bestehenden Tabellen und `claim_notification_delivery`; private Datensätze werden ausschließlich ihrem Ersteller mitgeteilt, passend zu den aktuellen SELECT-Policies.

## Betrieb

- Der Supabase-Cronjob `family-calendar-reminders` ruft die Funktion jede Minute auf.
- Zeiten für Kalender und Aufgaben werden in `Europe/Berlin` ausgewertet. Geburtstage und ganztägige Termine sind für 09:00 Uhr vorgesehen; Aufgaben ohne Uhrzeit ebenfalls für 09:00 Uhr.
- Ruhezeiten werden sowohl für den ursprünglichen Termin als auch beim tatsächlichen Versand geprüft. Verzögerte Erinnerungen bleiben bis zum Ende der Ruhezeit zurückgestellt, höchstens innerhalb des bestehenden 24-Stunden-Nachholfensters.
- Pro Person muss ein Gerät in der PWA unter Mehr registriert werden. Registrierung und `notification_settings.enabled` sind unterschiedliche Voraussetzungen.
- Die bestehende atomare Claim-Funktion und der eindeutige Index verhindern parallele doppelte Versandaufträge. Nach Netzwerkabbrüchen bleibt eine erneute Zustellung technisch möglich; eine exakt einmalige Anzeige auf jedem Gerät wird nicht garantiert.

## Authentifizierung

`verify_jwt=false` bleibt bestehen, weil die Funktion eigene Server-Authentifizierung prüft. Ein Aufruf ohne gültige Berechtigung wird abgelehnt.

Der bestehende manuelle Aufruf über `Authorization: Bearer REMINDER_CRON_SECRET` bleibt verfügbar (`dry-run`, `test`, `run`). Für den Cronjob erzeugt Postgres einen zufälligen HMAC-Schlüssel direkt in Supabase Vault. Über HTTP gehen ausschließlich die signierte Betriebsart und ein Zeitstempel; Signaturen gelten 90 Sekunden. Die Prüfung ist nur für `service_role` ausführbar und erlaubt dem Scheduler ausschließlich `dry-run` und `run`.

Vorausgesetzte vorhandene Edge-Function-Secrets: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `VAPID_SUBJECT`, `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`; optional weiterhin `REMINDER_CRON_SECRET`. Keine Werte dieser Secrets gehören ins Repository.

## Einrichtung und Änderungen

Die Einrichtung wurde im bestehenden Supabase-Projekt bereits durchgeführt. Die SQL-Dateien sind zur Nachvollziehbarkeit hinterlegt und müssen nicht nochmals ausgeführt werden.

Für eine erneute Einrichtung bzw. Änderung:

1. Bestehenden Cronjob zuerst mit `cron.alter_job(job_id := <id>, active := false)` pausieren.
2. `supabase/reminder-scheduler.sql` anwenden. Dies aktiviert `pg_cron`/`pg_net`, erzeugt bzw. rotiert den Vault-Schlüssel und setzt die eingeschränkten Hilfsfunktionen auf. Keine Änderungen an Familieninhalten oder deren RLS-Policies.
3. `dynamic-api` aus dem versionierten Quelltext deployen, JWT-Prüfung wie oben deaktiviert lassen. Der bisherige Sender ist zusätzlich außerhalb des Repositorys als lokale Sicherung aufbewahrt.
4. `select family_reminder_internal.invoke('dry-run');` ausführen. Die zurückgegebene Request-ID in `net._http_response` prüfen: HTTP 200, `success=true`, `no_push_sent=true`. Keine Request-Header oder Vault-Schlüssel ausgeben.
5. Erst nach erfolgreichem Probelauf `supabase/enable-reminder-scheduler.sql` ausführen bzw. den vorhandenen Job reaktivieren. Anschließend `cron.job_run_details` UND die HTTP-Antwort prüfen; ein erfolgreicher SQL-Job allein beweist noch keinen erfolgreichen Funktionsaufruf.

Zum Stoppen reicht das Pausieren des Jobs. Der bestehende manuelle Push-Test bleibt erhalten. Bei einem Rollback des Senders den Cronjob zuerst pausieren; die vorherige Version besitzt nicht die neuen Datenschutz- und Ruhezeitkorrekturen.

## Tests

`node tests/reminders.cjs` führt isolierte Funktionstests ohne Datenbankverbindung oder Push-Versand aus: private Empfänger, Familienzuweisung, Authentifizierung, Probelauf, Wiederholungsschutz, Ruhezeiten, Nachholen und Sommer-/Winterzeit.

Zusätzlich produktiv geprüft: HMAC-Prüfung mit gültiger, abgelaufener, verfälschter und ungültig formatierter Anfrage; Rollenberechtigungen; HTTP-Probelauf und automatischer Cron-Aufruf. Der tatsächliche Empfang auf Android muss mit einer fälligen Erinnerung kontrolliert werden.

Dokumentation: https://supabase.com/docs/guides/functions/schedule-functions
