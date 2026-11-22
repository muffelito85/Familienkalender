# Urlaubsplaner

## Stand und Freigabe

Entwicklungsbranch `codex/vacation-planner`, Ausgangspunkt `60ff38cf6f6b9204187bdae78c54f0927390b06e`.
Keine produktiven Tabellen, Rollen, Einstellungen, Urlaubsansprüche oder Edge Functions wurden für diese Erweiterung verändert. Die Migration erzeugt keine Konten und keine Beispielurlaube. Beispiele existieren ausschließlich in lokalen Tests und Vorschauen.

## Daten und Rechte

`vacation_accounts`: UUID, Familie, Benutzer, Kalenderjahr, Anspruch und Übertrag als halbtagsgenaue numerische Werte, ISO-Arbeitswoche (Montag=1 bis Sonntag=7), Arbeitsort als JSON, Zeitstempel. Ein Konto je Familie/Benutzer/Jahr. `work_location` ergänzt die angeforderten Felder um Bundesland, regionale Feiertagsmerkmale und optionale zusätzliche freie Datumswerte. Keine pauschale Annahme eines bayerischen Arbeitsorts; die Person muss ihn selbst festlegen.

`vacation_entries`: UUID, Familie, Benutzer, einschließliches Anfangs-/Enddatum, `planned`/`taken`/`cancelled`, Titel/Notiz, halbe Tage als Datumsobjekt (`{"2026-12-24":0.5}`), Zeitstempel. Fremdschlüssel zu vorhandenen Familien, Benutzern und Mitgliedschaften; Indizes für Familien-/Personenabfragen.

Die vorhandenen Rollen wurden lesend geprüft: ein `admin` (Dani), ein `adult` (Caro), ein `child` (Lara). Es werden keine UUIDs in neuem Anwendungscode oder SQL fest eingebaut. Die bestehenden Kalender-Schlüssel `daniel`/`caro` bleiben ausschließlich zur Farb-/Chip-Integration erhalten. Das begrenzte Mitgliederverzeichnis löst die tatsächlichen UUIDs aus `family_members` auf. Die Anzeigenamen Dani/Caro orientieren sich an der derzeitigen, geprüften Zuordnung admin/adult; bei einem späteren Rollentausch oder zusätzlichen Erwachsenen ist diese Namenszuordnung zu erweitern.

RLS gilt auch bei direkten API-Aufrufen: Erwachsene derselben Familie dürfen beide Konten lesen, schreiben aber ausschließlich ihr eigenes. Kinder lesen keine Konten. Alle Familienmitglieder sehen die gemeinsamen Urlaubszeiträume; nur der erwachsene Eigentümer darf diese ändern. Außenstehende sehen weder Konten noch Zeiträume. Notizen sind bewusst familienweit sichtbar. Neue Besitzer/Familien/IDs oder Erstellungszeitpunkte lassen sich bei Updates nicht unterschieben.

Die bestehende Mitgliedertabelle erlaubt nur das Lesen der eigenen Mitgliedschaft. Deshalb gibt es ein eng begrenztes Mitgliederverzeichnis: eine Funktion mit privilegiertem Lesen in `vacation_internal`, leerem `search_path`, obligatorischer Prüfung von `auth.uid()` und Familienmitgliedschaft; Rückgabe ausschließlich erwachsener IDs, Rollen und Anzeigenamen. Der öffentliche RPC-Wrapper ist `SECURITY INVOKER`, anonym nicht ausführbar. Keine E-Mails, Auth-Metadaten oder Kontosalden werden über das Verzeichnis ausgegeben. Die Triggerfunktion ist nicht direkt ausführbar.

## Berechnung

Verfügbar = Anspruch + Übertrag − Genommen − Geplant. Es wird nicht automatisch anteilig gekürzt oder anhand der Anzahl der Arbeitstage ein neuer Jahresanspruch erfunden. Auch negative Salden bleiben sichtbar.

Urlaubstage sind die im jeweiligen Jahreskonto eingestellten Arbeitstage, abzüglich gesetzlicher Feiertage am Arbeitsort. Standardmäßig sind im noch ungespeicherten Formular Montag bis Freitag vorgewählt; der Anspruch bleibt leer. Ein ausgewählter Samstag/Sonntag zählt als Arbeitstag, falls kein gesetzlicher Feiertag vorliegt. Halbe Tage zählen 0,5; an freien Tagen/Feiertagen weiterhin 0. Heiligabend und Silvester sind nicht automatisch frei. Betriebliche freie Tage lassen sich explizit ergänzen.

Die Feiertagsberechnung enthält die regelmäßigen Feiertage aller 16 Bundesländer sowie bayerische Gemeindeausnahmen, regionale Fronleichnamsausnahmen in Sachsen/Thüringen, Brandenburgs Oster-/Pfingstsonntag und den bereits beschlossenen Berliner Sonderfeiertag 17.06.2028. Mariä Himmelfahrt gilt in Augsburg automatisch. Regionale Geltung muss die Person bestätigen. Gesetzesstand geprüft am 22.11.2026; künftige neue Sonderregelungen erfordern eine Aktualisierung bzw. zusätzliche freie Tage.

Quellen:

- [Bayerisches Feiertagsgesetz](https://www.gesetze-bayern.de/Content/Document/BayFTG/true)
- [Bayerisches Innenministerium: örtliche Feiertage](https://www.stmi.bayern.de/staat-und-verfassung/feiertage/)
- [Feiertagsgesetz Brandenburg](https://bravors.brandenburg.de/gesetze/ftg_2015)
- [Berliner Feiertagsrecht](https://www.berlin.de/sen/inneres/buerger-und-staat/verfassungs-und-verwaltungsrecht/artikel.1435639.php)
- [Berliner Sonderfeiertage 2025/2028](https://www.berlin.de/aktuelles/9188766-958090-einmaliger-feiertag-am-8-mai-2025.html)
- [Feiertagsübersicht der BaFin](https://bafin.de/SharedDocs/Standardartikel/DE/kalender_handelstage.html)

Jahresübergreifende Einträge bleiben ein Datensatz. Die Tageszahl wird für jedes betroffene Kalenderjahr mit dessen eigenem Konto berechnet. Für aktive Einträge müssen alle betreffenden Jahreskonten vorhanden sein (Frontend und Datenbank prüfen dies). Überträge werden bewusst eingetragen; es gibt keinen automatischen Übertrag, Verfall oder arbeitsrechtliche Anspruchsprüfung. Statuswechsel von geplant zu genommen erfolgt ausdrücklich, nicht automatisch nach dem Datum. Bereits genommene Tage richten sich nach dem ausgewählten Status.

Aktive Überschneidungen derselben Person werden bereits im Formular und zusätzlich atomar durch eine GiST-Exclusion-Constraint auf dem Datumsbereich verhindert. Das schützt auch bei gleichzeitigen Schreibzugriffen. Auch zwei halbe Einträge am selben Tag sind als überlappend ausgeschlossen; sie sollen in einem Eintrag gepflegt werden. Verschiedene Personen dürfen gleichzeitig Urlaub haben. Stornierte Einträge blockieren keine Zeiträume, belasten keine Salden und erscheinen nicht im Kalender; in der Liste sind sie zuschaltbar. Reaktivieren unterliegt wieder der Überschneidungsprüfung.

## Integration und Synchronisation

Die neue Datenquelle ergänzt `evs()` und `evRow()`. Es gibt keinerlei Schreibzugriff auf `events`, Aufgaben, Push-Abos oder Auth aus dem Urlaubsmodul. Pro Urlaub existiert genau ein Datensatz. Im Kalender wird er mit Zeitraum und Person auf jedem betroffenen Tag dargestellt, blau für Dani und grün für Caro; die vorhandenen Personen-/Privatfilter bleiben wirksam. Anklicken führt zum Urlaub, niemals zum normalen Terminformular. Die vorhandenen Schulferien und Feiertage bleiben eigenständige Kalenderinformationen.

Änderungen laden die betroffenen Daten neu, statt sie mehrfach anzuhängen. Realtime-Kanäle und ein 30-Sekunden-Fallback, Aktualisieren-Button, Wiederöffnen und Online-Ereignisse übernehmen Änderungen anderer Geräte. Offene Formularentwürfe werden durch automatische Listenaktualisierung nicht überschrieben. Bearbeitung verwendet `updated_at` als Konfliktschutz. Bei einem Kontowechsel werden die Urlaubsdaten sofort über das neue Session-Ereignis geleert; langsame Antworten vorheriger Sitzungen werden verworfen. Die bestehende Loginlogik bleibt erhalten.

Der Shell-Cache wird auf Version 22 angehoben; die drei neuen Frontend-Dateien werden offline mitgespeichert. Urlaubsdaten selbst werden nicht dauerhaft im Shell-Cache abgelegt. Das Modul erfordert zum Laden und Speichern eine Verbindung; keine Offline-Schreibwarteschlange. Push-Sender Version 13 und Push-Client bleiben unverändert. Es gibt keine neu erfundenen Urlaubs-Pushs.

## Tests

`npm ci --prefix tests`, danach `npm test --prefix tests` (Node 26).

- Vorhandene Reminder-Regression plus 33 Zwei-Erinnerungen-Fälle, bisherige PostgreSQL-Migration und Formular-/Push-Lifecycle-Tests erfolgreich.
- Neue Berechnungstests: 30/8/7/15, Übertrag, Wochenenden, Feiertage/Regionen, halbe Tage, unterschiedliche Arbeitswochen, Silvester mit unterschiedlichen Jahresregeln, Überschneidung/Stornierung/Bearbeitung, getrennte Benutzer, Schaltjahre/DST und alle Bundesländer.
- Neue isolierte PostgreSQL-Tests mit PGlite und `btree_gist`: Migration dreimal, keine vorgegebenen Ansprüche, RLS für beide Erwachsene/Kind/fremde Familie, Eigentumsschutz, sichere Mitgliederauflösung, Eingabevalidierung, Datenbank-Überschneidungsschutz, Reaktivierung, optimistische Updates, fehlendes Folgejahreskonto und gemeinsame Leseaktualisierung. Die Realtime-Publikation enthält nach Wiederholung genau die zwei neuen Tabellen.
- Browser mit lokalen Beispieldaten: Speichern, Bearbeiten und erneutes Laden eines halben Tags, Kontoanlage ohne vorgegebenen Anspruch, eigener Kontosaldo, Caros getrennte Verwaltung, Lara ohne Salden/Editoren, zweite Ansicht übernimmt Änderungen, Stornierung gibt Guthaben frei und entfernt nur den Urlaub, Weihnachtsferien bleiben sichtbar. Keine JavaScript-Fehler.
- Größenprüfung im lokalen Vorschau-Frame bei 320/390/1024 px ohne horizontalen Inhaltsüberlauf; darunter verbleiben wegen der vertikalen Scrollbar 305/375/1009 CSS-Pixel. Androidähnliche mobile Darstellung im Browser geprüft; kein Test auf einem physischen Android-Gerät oder gegen produktiv aktivierte Realtime erfolgt.

## Erforderliche Übernahme nach ausdrücklicher Freigabe

1. PR prüfen. Nicht vor der freigegebenen Migration zusammenführen. Die produktive Migrationshistorie ist bereits vorhanden; kein blindes `db push`/`db reset` aus einem unvollständigen lokalen Checkout.
2. Ausschließlich `supabase/migrations/20261122183913_vacation_planner.sql` gegen das richtige Projekt anwenden. Die Migration erzeugt neue Tabellen/Indizes, eine private Hilfsfunktion plus öffentlichen Wrapper, Trigger, Policies und zwei Realtime-Publikationseinträge. `btree_gist` wird bei Bedarf aktiviert. Keine vorhandenen Kalender-/Push-/Auth-Tabellen oder Daten werden geändert; keine Urlaubskonten werden vorbefüllt.
3. Schema-/RLS-Advisors ausführen und neue Objekte prüfen. Mit Dani/Caro/Lara jeweils direkte Lese-/Schreibversuche abnehmen: eigener Kontozugriff erlaubt, fremde Änderungen abgewiesen, Kind bekommt null Kontenzeilen. Realtime zwischen zwei realen Geräten prüfen.
4. PR zusammenführen, erfolgreiches Pages-Deployment abwarten und PWA neu öffnen. Service-Worker 22 lädt die neuen Assets. Erst jetzt tragen Dani und Caro ihre tatsächlichen Jahresansprüche, Überträge und Arbeitsorte selbst ein.
5. Einen echten Testurlaub anlegen/bearbeiten/stornieren und Salden/Kalender/Synchronisation prüfen; danach bestehende Termin-/Aufgaben-/Push-Funktionen kurz abnehmen. Keine Änderung der Push-Secrets, Cronjobs oder Edge Functions nötig.

Rollback: Frontend auf vorherigen Stand zurücksetzen; die neuen Tabellen dürfen bestehen bleiben. Keine Tabellen/Daten löschen. Bei fehlender Migration zeigt ausschließlich der neue Reiter einen Fehler, die vorhandenen Bereiche bleiben nutzbar.

Grenzen: Jahre 2025–2100 (Jahresauswahl bietet die letzten zwei und nächsten zehn Jahre), maximal 731 Kalendertage je Eintrag, feste Arbeitswoche/Arbeitsort je Kalenderjahr, keine unterjährigen Schichtpläne oder automatisch verfallenden Resturlaube. Eine Arbeitszeitänderung im Jahreskonto berechnet deshalb auch bestehende Einträge dieses Jahres neu. Keine Urlaubsfreigabe durch Arbeitgeber, Reisebuchung oder Rechtsberatung. Die Farb-/Namenszuordnung folgt der bestehenden Zwei-Erwachsenen-Familie.
