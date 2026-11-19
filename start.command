#!/usr/bin/env bash
# macOS-Wrapper: .command-Dateien oeffnen sich per Doppelklick im Terminal, .sh-Dateien im Editor.
# Nach einem erfolgreichen Start laeuft der Server im Hintergrund weiter und dieses
# Terminal-Fenster schliesst sich von selbst. Bei einem Fehler bleibt es offen.
cd "$(dirname "$0")"

if ! DONE_BAN_DETACH=1 ./start.sh; then
  exit 1
fi

# Nur das eigene Fenster schliessen, erkannt am Terminal-Geraet dieser Shell.
TTY_NAME=$(tty 2>/dev/null || true)
if [ -n "$TTY_NAME" ] && command -v osascript >/dev/null 2>&1; then
  if ! osascript >/dev/null 2>&1 <<APPLESCRIPT
tell application "Terminal"
  repeat with w in windows
    repeat with t in tabs of w
      if tty of t is "$TTY_NAME" then
        close w saving no
      end if
    end repeat
  end repeat
end tell
APPLESCRIPT
  then
    echo "Hinweis: Das Fenster konnte nicht automatisch geschlossen werden und kann jetzt geschlossen werden."
  fi
fi

exit 0
