#!/usr/bin/env bash
# Startet done-ban: prueft Node, installiert fehlende Abhaengigkeiten und startet den Server.
cd "$(dirname "$0")"

REQUIRED_MAJOR=26

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

node server.js
STATUS=$?
if [ $STATUS -ne 0 ]; then
  echo "done-ban wurde mit Fehler beendet (Exit-Code $STATUS)." >&2
  read -r -p "Enter zum Schließen ..." _
fi
exit $STATUS
