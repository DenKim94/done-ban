#!/usr/bin/env bash
# macOS-Wrapper: .command-Dateien oeffnen sich per Doppelklick im Terminal, .sh-Dateien im Editor.
# Fuer den Start ganz ohne Fenster gibt es done-ban.app.
exec "$(dirname "$0")/start.sh"
