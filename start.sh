#!/usr/bin/env bash
# Startet done-ban: prueft Node, installiert fehlende Abhaengigkeiten und startet den Server.
# Mit DONE_BAN_DETACH=1 laeuft der Server im Hintergrund weiter und das Skript kehrt zurueck,
# sobald der Start geglueckt ist. Diesen Weg nutzt start.command fuer den Doppelklick.
cd "$(dirname "$0")"

REQUIRED_MAJOR=26
# Die Serverausgabe liegt bewusst nicht im Projektordner: Bei einem normalen
# Start soll dort keine Datei zurueckbleiben. Im Fehlerfall gibt start.sh den
# Inhalt ohnehin direkt aus.
LOG_FILE="${TMPDIR:-/tmp}/done-ban-server.log"

fail() {
  echo "$1" >&2
  read -r -p "Enter zum Schließen ..." _
  exit 1
}

# Beim Doppelklick fehlen unter Umstaenden Pfade aus der Shell-Konfiguration.
# nvm wird zusaetzlich geladen, damit die in .nvmrc genannte Version auch dann
# greift, wenn der nvm-Standard auf eine aeltere Version zeigt.
load_node() {
  export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
  if [ -s "$HOME/.nvm/nvm.sh" ]; then
    # shellcheck disable=SC1091
    . "$HOME/.nvm/nvm.sh"
    nvm use >/dev/null 2>&1 || true
  fi
}

node_major() {
  node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo "0"
}

if ! command -v node >/dev/null 2>&1; then
  load_node
fi

if ! command -v node >/dev/null 2>&1; then
  fail "Fehler: Node.js wurde nicht gefunden. Benötigt: Node $REQUIRED_MAJOR oder neuer (zum Beispiel per 'nvm install $REQUIRED_MAJOR')."
fi

MAJOR=$(node_major)
if [ "$MAJOR" -lt "$REQUIRED_MAJOR" ]; then
  # Vielleicht liegt eine passende Version per nvm bereit, ist aber nicht die Standardversion.
  load_node
  MAJOR=$(node_major)
fi

if [ "$MAJOR" -lt "$REQUIRED_MAJOR" ]; then
  echo "Gefunden: Node $MAJOR. Benötigt: Node $REQUIRED_MAJOR oder neuer." >&2
  fail "Installieren mit 'nvm install $REQUIRED_MAJOR'. Ist Node $REQUIRED_MAJOR bereits installiert, dauerhaft umstellen mit 'nvm alias default $REQUIRED_MAJOR'."
fi

if ! bash scripts/ensure-deps.sh; then
  fail "Fehler: Die Vorbereitung ist fehlgeschlagen. done-ban wurde nicht gestartet."
fi

# Hintergrundstart: Der Server wird vom Terminal geloest, die Ausgabe landet im Logfile.
if [ "${DONE_BAN_DETACH:-}" = "1" ]; then
  : > "$LOG_FILE"
  DONE_BAN_DETACHED=1 nohup node server.js >> "$LOG_FILE" 2>&1 </dev/null &
  SERVER_PID=$!
  disown "$SERVER_PID" 2>/dev/null || true

  # Bis zu 30 s auf die Startmeldung des Servers warten.
  for _ in $(seq 1 150); do
    if grep -q "läuft auf\|läuft bereits" "$LOG_FILE" 2>/dev/null; then
      echo "done-ban läuft im Hintergrund. Serverausgabe: $LOG_FILE"
      exit 0
    fi
    if ! kill -0 "$SERVER_PID" 2>/dev/null; then
      break
    fi
    sleep 0.2
  done

  echo "Fehler: done-ban konnte nicht gestartet werden." >&2
  [ -s "$LOG_FILE" ] && cat "$LOG_FILE" >&2
  fail "Bitte die Meldung oben prüfen."
fi

node server.js
STATUS=$?
if [ $STATUS -ne 0 ]; then
  echo "done-ban wurde mit Fehler beendet (Exit-Code $STATUS)." >&2
  read -r -p "Enter zum Schließen ..." _
fi
exit $STATUS
