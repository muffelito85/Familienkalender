# Push-Registrierung stabilisieren

Die Geräteabos von Dani und Caro waren am 19.11.2026 vorhanden. Der bisherige Client zeigte nach jedem Start ungeprüft „Noch nicht eingerichtet“. Es fehlte außerdem eine UPDATE-RLS-Policy für wiederholtes Upsert. Ein tatsächlicher Ablauf älterer Browserabos ist nicht abschließend belegt.

push.js prüft beim Benutzerwechsel, Wiederöffnen und Wiederverbinden das lokale Abo und synchronisiert es unter normalen Benutzerrechten. Bei bereits erteiltem Push-Recht und zuvor gespeichertem Opt-in wird ein verlorenes Abo erneut angelegt. Berechtigungsprompts bleiben nutzerinitiiert. Explizites Abmelden speichert einen geräte-/kontobezogenen Opt-out; vorübergehende Netzfehler und Logout löschen kein Abo. Fremde VAPID-Schlüssel werden gemeldet, nicht automatisch ersetzt. Ein Kontowechsel überträgt fremde Endpunkte nicht, RLS bleibt wirksam.

Die additive Policy in push-subscriptions-owner-update.sql wurde produktiv angewendet. Transaktionstest: eigenes Update 1, fremdes Update 0, anschließend Rollback. Keine vorhandenen Geräteabos oder Einstellungen geändert. Sender bleibt Version 13, Scheduler unverändert.

Service-Worker-Cache v21 enthält das neue Script. pushsubscriptionchange meldet offenen Fenstern eine notwendige Synchronisierung; ohne offenes Fenster erfolgt der Abgleich beim nächsten Start. Kein Versprechen ununterbrochener Zustellung bei vom Browser gelöschten Daten oder entzogener Berechtigung.

Tests: node tests/push-lifecycle.cjs prüft vorhandenes Abo, erneutes Öffnen, Opt-in-Wiederherstellung, erstmalige Aktivierung, Opt-out, blockierte Rechte, Netzfehler, Logout und Kontowechsel. Reale Android-Langzeitstabilität bleibt nach dem Update zu beobachten.
