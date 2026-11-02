#!/bin/bash
# SPDX-License-Identifier: MIT
# Packs the extension, installs (or upgrades) it for the current user and
# enables it. No root needed. Usage: ./install.sh
set -euo pipefail
cd "$(dirname "$0")"
UUID=scenic-view@twiebe.github.com

mkdir -p build
gnome-extensions pack extension --force --out-dir=build \
  --extra-source=controller.js \
  --extra-source=geometry.js \
  --extra-source=keys.js \
  --extra-source=struts.js \
  --schema=schemas/org.gnome.shell.extensions.scenic-view.gschema.xml
gnome-extensions install --force "build/$UUID.shell-extension.zip"

if gnome-extensions enable "$UUID" 2>/dev/null; then
  echo "Scenic View installed and enabled."
else
  # On a first install the running shell doesn't know the extension yet, so
  # enabling it over D-Bus fails. Add it to the enabled list directly; the
  # shell starts it at the next login.
  current=$(gsettings get org.gnome.shell enabled-extensions)
  if [[ $current != *"'$UUID'"* ]]; then
    if [[ $current == "@as []" || $current == "[]" ]]; then
      new="['$UUID']"
    else
      new="${current%]}, '$UUID']"
    fi
    gsettings set org.gnome.shell enabled-extensions "$new"
  fi
  echo "Scenic View installed and marked as enabled."
  echo "GNOME Shell loads new extension code only at login: log out and back in."
fi
echo "After an update, too: log out and back in (Wayland can't reload the shell)."
echo "Settings: gnome-extensions prefs $UUID (or the Extensions app)"
echo "Shortcut: Hyper+Enter, i.e. Ctrl+Alt+Shift+Super+Enter (changeable in the settings)"
