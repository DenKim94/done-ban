# done-ban

**done-ban** ist ein lokales Kanban-Board für To-Dos. Es läuft vollständig auf dem eigenen Rechner:
ein kleines Node.js-Backend liefert die Oberfläche aus und speichert die Daten in der SQLite-Datei `todos.db`.
Es gibt keine Cloud, keinen Login und keine externen Ressourcen. Die App funktioniert offline.

Das Board hat fünf Spalten: **Offen, In Arbeit, On Hold, Canceled, Done**.
Karten lassen sich per Drag-and-Drop verschieben und neu sortieren, über Tags filtern und nach dem
Zieldatum sortieren. Erledigte Karten können archiviert werden.

## Voraussetzungen

- **Node.js 26 oder neuer.** Prüfen mit `node -v`.
  Installation zum Beispiel über [nvm](https://github.com/nvm-sh/nvm): `nvm install 26`.
  Die Datei `.nvmrc` enthält die Version 26. `start.sh` lädt nvm und wertet `.nvmrc` aus, wenn das
  gefundene Node zu alt ist. Es genügt also, dass Node 26 per nvm installiert ist, auch wenn
  `nvm alias default` noch auf eine ältere Version zeigt.
  Soll Node 26 überall gelten, hilft `nvm alias default 26`.
- Für den ersten Start einmalig eine **Internetverbindung** (siehe unten).
- macOS oder Linux.

## Start

Doppelklick auf **`done-ban.app`** (macOS). Es öffnet sich kein Terminal-Fenster,
der Browser zeigt die App unter `http://localhost:3003`.

Wird der letzte Tab geschlossen, beendet sich der Server nach etwa fünf Sekunden von selbst.
Ein Neuladen der Seite (F5) beendet ihn nicht.

Es gibt drei Startwege:

| Weg | Verhalten |
|---|---|
| Doppelklick auf `done-ban.app` | Kein Fenster, und im Projektordner bleibt nichts zurück. Schlägt der Start fehl, öffnet sich ein Terminal-Fenster mit der Meldung. |
| Doppelklick auf `start.command` | Terminal-Fenster bleibt offen, der Server läuft darin im Vordergrund. Das Fenster zu schließen beendet auch den Server. |
| `./start.sh` im Terminal | Wie `start.command`, nur von Hand gestartet. `Strg+C` beendet den Server. |

`done-ban.app` ist kein eigenes Programm, sondern ein kleines Bündel, das `start.sh` aufruft.
Es muss deshalb im Projektordner liegen bleiben.

**Wichtig: Das Projekt darf nicht im Schreibtisch-, Dokumente- oder Download-Ordner liegen.**
macOS schützt diese Ordner, und eine selbstgebaute App bekommt dort keinen Lesezugriff — ohne
Nachfrage, sie wird stillschweigend abgewiesen. Der Start über die App schlägt dann mit
`Operation not permitted` fehl und es öffnet sich ersatzweise ein Terminal-Fenster. Ein Ort wie
`~/Projekte/DoneBan` ist unproblematisch. Über `start.command` und `start.sh` funktioniert der Start
auch in den geschützten Ordnern, weil Terminal diese Freigabe in der Regel bereits hat.

Protokolliert wird nur im Fehlerfall: Scheitert der Start über die App, landen Zeitpunkt, `PATH`,
Projektordner und die Meldung in `~/Library/Logs/done-ban.log`. Ein erfolgreicher Start schreibt
nichts. Die laufende Serverausgabe steht in `done-ban-server.log` im temporären Ordner des Systems
(`$TMPDIR`), damit der Projektordner sauber bleibt; den vollständigen Pfad nennt die Startmeldung.

### Erster Start unter macOS

Lädt man das Projekt aus dem Internet herunter, blockiert Gatekeeper die Skripte beim ersten Mal.
Zwei Wege führen daran vorbei:

- Rechtsklick auf `done-ban.app` bzw. `start.command`, dann **"Öffnen"** wählen und die Rückfrage
  bestätigen, oder
- im Terminal: `xattr -dr com.apple.quarantine done-ban.app start.command start.sh scripts/ensure-deps.sh`

Fehlen die Ausführungsrechte, hilft:

```bash
chmod +x start.sh start.command scripts/ensure-deps.sh
```

### Abhängigkeiten

Beim Start prüft `scripts/ensure-deps.sh`, ob alle Abhängigkeiten vorhanden und lauffähig sind,
und installiert sie bei Bedarf automatisch. Das passiert einmalig und **benötigt Internet**.
Danach startet die App auch ohne Netzverbindung und ohne spürbare Verzögerung.

Wichtig: Ein direkter Aufruf von `node server.js` prüft die Abhängigkeiten **nicht**.
Dafür `npm start` oder `./start.sh` verwenden.

Beim Start über `done-ban.app` hängt der Server nicht am Terminal. Beendet wird er dadurch, dass der
letzte Browser-Tab geschlossen wird, oder von Hand mit `pkill -f "node server.js"`.

## Bedienung

| Aktion | So geht es |
|---|---|
| To-Do anlegen | Button "Neues To-Do" in der Kopfzeile |
| To-Do bearbeiten | Button "Bearbeiten" auf der Karte oder Doppelklick auf die Karte |
| Status ändern | Karte in eine andere Spalte ziehen oder das Feld "Status" im Dialog verwenden |
| Reihenfolge ändern | Karte innerhalb der Spalte an die gewünschte Stelle ziehen |
| Spalte sortieren | Button im Spaltenkopf. Jeder Klick wechselt die Richtung: "Neueste zuerst" sortiert absteigend, "Älteste zuerst" aufsteigend. Die Beschriftung nennt immer die Reihenfolge, die der nächste Klick herstellt. |
| Nach Tag filtern | Klick auf einen Tag in der Leiste unter der Kopfzeile. Nur passende Karten bleiben sichtbar, die Zähler zeigen die gefilterte Anzahl. Ein Klick auf "Alle" oder erneut auf den aktiven Tag hebt den Filter auf. |
| Archivieren | Button "Archivieren" auf einer Karte in der Spalte Done |
| To-Do löschen | Papierkorb-Button auf der Karte, mit Sicherheitsabfrage. Das löscht den Eintrag endgültig. |
| Archiv ansehen | Button "Archiv" in der Kopfzeile. Die archivierten Einträge erscheinen als Karten, neueste zuerst. |
| Archivierten Eintrag im Detail | Klick auf die Karte im Archiv. Die Detailansicht zeigt die vollständige Beschreibung mit Zeilenumbrüchen, den Tag, die Links sowie Zieldatum und Archivierungszeitpunkt. |
| Archiv leeren | Im Archiv-Dialog links unten, mit Sicherheitsabfrage |

### Felder eines To-Dos

| Feld | Pflicht | Hinweise |
|---|---|---|
| Titel | ja | Höchstens 120 Zeichen. Nur der Titel steht auf der Karte. |
| Beschreibung | ja | Höchstens 1000 Zeichen, Zeilenumbrüche bleiben erhalten. Sichtbar im Bearbeiten-Dialog, als Tooltip der Karte und in der Detailansicht archivierter Einträge. |
| Zieldatum | ja | Bestimmt die Einsortierung und die Hervorhebung überfälliger Einträge. |
| Status | nein | Standard ist Offen. |
| Tag | nein | Ein einzelnes Schlagwort, zum Beispiel `#Arbeit` oder `#ProjektXY`. Die Raute ist optional, gespeichert wird ohne sie. Erlaubt sind Buchstaben, Ziffern, Bindestrich und Unterstrich, höchstens 32 Zeichen. |
| Links | nein | Bis zu 20 Stück, `http` oder `https`, einer pro Zeile. |

Überfällige To-Dos werden hervorgehoben. Sind mehrere Tabs geöffnet, aktualisieren sich alle automatisch.
Beim Löschen und beim Leeren des Archivs erscheint eine Sicherheitsabfrage im Design der Anwendung.

Auf schmalen Fenstern (unter 768 Pixel) wird nur eine Spalte angezeigt, die Auswahl erfolgt über
Status-Tabs. Drag-and-Drop gibt es dort nicht, der Status wird über den Bearbeiten-Dialog geändert.

## Konfiguration

Alle Einstellungen laufen über Umgebungsvariablen:

| Variable | Standard | Zweck |
|---|---|---|
| `PORT` | `3003` | HTTP-Port |
| `TODO_DB` | `<Projektordner>/database/todos.db` | Pfad zur Datenbankdatei |
| `SHUTDOWN_GRACE_MS` | `5000` | Wartezeit nach dem Schließen des letzten Tabs |
| `STARTUP_TIMEOUT_MS` | `60000` | Wartezeit auf die erste Browser-Verbindung |
| `NO_OPEN` | – | `1` = Browser nicht automatisch öffnen |

Beispiel, wenn Port 3003 belegt ist:

```bash
PORT=3004 ./start.sh
```

Der Server lauscht ausschließlich auf `127.0.0.1` und ist damit aus dem Netzwerk nicht erreichbar.

## Datensicherung und Zurücksetzen

- **Backup:** Den Server beenden und `database/todos.db` kopieren. Das ist eine gewöhnliche SQLite-Datei.
- **Einzelne Einträge löschen:** Papierkorb-Button auf der Karte. Der Eintrag wird nach der
  Sicherheitsabfrage sofort und endgültig aus der Datenbank entfernt.
- **Zurücksetzen:** Den Server beenden und `database/todos.db` löschen. Beim nächsten Start wird eine
  leere Datenbank angelegt. Dieser Schritt löscht alle To-Dos, auch das Archiv.
- **Umzug einer älteren Datenbank:** Bis Version 1.0 lag die Datei direkt im Projektordner. Liegt dort
  noch eine `todos.db`, einfach nach `database/todos.db` verschieben, dann sind alle Einträge wieder da.
- **Ältere Datenbank:** Fehlen die Spalten `title` und `tag`, ergänzt der Server sie beim Start.
  Bestehende Einträge bekommen als Titel die erste Zeile ihrer Beschreibung. Vorhandene Daten
  bleiben dabei erhalten.

## Projektstruktur

```
done-ban/
├── server.js           # HTTP-Server, REST-API, Lebenszyklus
├── db.js               # Schema, Sortierlogik, Datenbankzugriff
├── validation.js       # Prüfung der Eingaben
├── start.sh            # Startskript
├── start.command       # macOS-Wrapper für den Doppelklick im Terminal
├── done-ban.app/       # Start ohne Terminal-Fenster
├── scripts/
│   └── ensure-deps.sh  # prüft und installiert Abhängigkeiten
├── public/             # Oberfläche (index.html, style.css, app.js, icon.png)
└── database/           # wird beim ersten Start angelegt
    └── todos.db        # die SQLite-Datei mit allen To-Dos
```

## Fehlersuche

| Meldung | Bedeutung |
|---|---|
| "Gefunden: Node 24. Benötigt: Node 26 oder neuer." | Node 26 ist weder im `PATH` noch über nvm erreichbar: `nvm install 26` ausführen. Ist es bereits installiert, prüfen, ob `.nvmrc` noch vorhanden ist, oder dauerhaft per `nvm alias default 26` umstellen. |
| "Port 3003 ist von einem anderen Programm belegt" | Ein fremdes Programm nutzt den Port. Mit `PORT=3004 ./start.sh` starten. |
| "done-ban läuft bereits auf ..." | Die App läuft schon. Der Browser wird nur erneut geöffnet. |
| "Die Abhängigkeiten konnten nicht installiert werden." | Keine Internetverbindung beim ersten Start. |
| "better-sqlite3 lässt sich nicht laden." | Build-Werkzeuge fehlen: macOS `xcode-select --install`, Linux `build-essential`. |
| Banner "Keine Verbindung zum Server." | Der Server läuft nicht mehr. `start.sh` erneut ausführen. |
