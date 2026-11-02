#!/bin/bash
# SPDX-License-Identifier: MIT
set -euo pipefail
gnome-extensions uninstall scenic-view@twiebe.github.com
echo "Scenic View uninstalled. Log out and back in to unload it from GNOME Shell."
