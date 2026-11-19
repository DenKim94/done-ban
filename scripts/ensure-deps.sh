#!/usr/bin/env bash
# Stellt sicher, dass alle Laufzeit-Abhaengigkeiten installiert und lauffaehig sind.
set -euo pipefail
cd "$(dirname "$0")/.."

NPM_FLAGS=(--omit=dev --ignore-scripts --no-audit --no-fund)
SQLITE_TEST="require('better-sqlite3')(':memory:').close()"

install_deps() {
  echo "Installiere Abhängigkeiten (einmalig, benötigt Internet) ..."
  if [ -f package-lock.json ] && npm ci "${NPM_FLAGS[@]}"; then
    return 0
  fi
  npm install "${NPM_FLAGS[@]}"
}

# D1: Ist npm vorhanden?
if ! command -v npm >/dev/null 2>&1; then
  echo "Fehler: npm wurde nicht gefunden. npm gehört zu Node.js, bitte Node.js 26 neu installieren." >&2
  exit 1
fi

# D2: Sind die Abhängigkeiten vollständig installiert?
if [ ! -d node_modules ] || ! npm ls --omit=dev --depth=0 >/dev/null 2>&1; then
  if ! install_deps; then
    echo "Fehler: Die Abhängigkeiten konnten nicht installiert werden." >&2
    echo "Bitte die Internetverbindung und die npm-Ausgabe oben prüfen." >&2
    exit 1
  fi
fi

# D3: Laesst sich das native SQLite-Modul laden?
if ! node -e "$SQLITE_TEST" >/dev/null 2>&1; then
  echo "Das SQLite-Modul passt nicht zur Node-Version. Baue es neu ..."
  npm rebuild better-sqlite3 >/dev/null 2>&1 || true
  if ! node -e "$SQLITE_TEST" >/dev/null 2>&1; then
    echo "Fehler: better-sqlite3 lässt sich nicht laden." >&2
    echo "macOS: 'xcode-select --install' ausführen. Linux: Paket 'build-essential' installieren." >&2
    exit 1
  fi
fi
