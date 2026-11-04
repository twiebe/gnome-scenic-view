# Scenic View for GNOME Shell

A GNOME Shell extension that adds gaps around maximized and tiled windows and a
**scenic view**: a maximize with larger margins, so more of your wallpaper stays
visible.

GNOME port of [Scenic View for KDE Plasma](https://github.com/twiebe/kde-scenic-view).
It does no automatic tiling. It works with what GNOME already does: maximizing and
half tiling (Super+Left/Right, dragging to screen edges).

## Features

- **Gaps for maximized and tiled windows**, separately for left/right and
  top/bottom, measured to panels (top bar, docks), not to the screen edge.
- **Shadow and rounded corners stay**: GTK and libadwaita apps draw maximized
  windows without shadow and with square corners. By default, maximized windows
  therefore become normal windows sized to the gapped area. Maximizing again
  restores the previous size. Can be switched off (see [Maximize modes](#maximize-modes)).
- **Scenic view**: a shortcut (default **Hyper+Enter, i.e. Ctrl+Alt+Shift+Super+Enter**) toggles the focused window
  into a maximize with larger margins. Press it again and the window goes back to
  where it was.
- **Settings apply right away**, no reload needed.

## Compatibility

| GNOME Shell | Status |
|---|---|
| **50** | Tested (50.6, Wayland, Bazzite): gaps, pseudo-maximize, scenic view, shortcut and settings |
| **51** | Expected to work: all APIs the extension uses were checked against the 51.1 source, but not tested in a session yet |
| 45 – 49 | Not declared in `metadata.json`. The code has fallbacks for the older maximize API, but this is untested |

Wayland only (GNOME 50 and later have no X11 session).

## Installation

Needs `gnome-extensions` (part of GNOME Shell), no root.

```bash
git clone https://github.com/twiebe/gnome-scenic-view.git
cd gnome-scenic-view
./install.sh
```

GNOME Shell loads extension code only at login. After the first installation and
after every update: log out and back in. If `install.sh` could not enable the
extension, run `gnome-extensions enable scenic-view@twiebe.github.com` after logging
in again.

Uninstall with `./uninstall.sh`.

## Configuration

Open the settings with

```bash
gnome-extensions prefs scenic-view@twiebe.github.com
```

or in the Extensions app (or Extension Manager): Scenic View → gear icon / Settings.
The dialog has three groups: Gaps, Maximized Windows and Scenic View. All changes
apply right away.

| Setting | Default | Applies to |
|---|---|---|
| Edges, left/right | 32 px | maximized and tiled windows |
| Edges, top/bottom | 32 px | maximized and tiled windows |
| Keep shadow and rounded corners | on | maximized windows |
| Scenic view margin, left/right | 80 px | scenic view |
| Scenic view margin, top/bottom | 80 px | scenic view |
| Toggle scenic view | Ctrl+Alt+Shift+Super+Enter | shortcut |

Values are in logical pixels. Scenic margins are capped so a window never shrinks
below half the work area.

### Changing the shortcut

The shortcut is the **last row of the Scenic View group**, below the two margin
fields: "Toggle scenic view", with the current shortcut and a pencil icon (scroll down
if the window is small).

1. Click the row. A small window opens: "Press the new shortcut".
2. Press the new combination. It is saved and active right away, no logout needed.
3. Esc cancels, Backspace disables the shortcut.

The shortcut does not show up under Settings → Keyboard → Shortcuts, which lists only
shortcuts of GNOME's own components. If the row is missing after an update, close the
Extensions app completely and open the settings again; it may still have the old
settings dialog loaded.

The shortcut needs Ctrl, Alt, Shift or Super: Hyper and Meta alone are ignored,
because without a key mapped to them Mutter would grab the bare key (e.g. Return)
system-wide. The default is meant for a "Hyper" key in the sense of tools like keyd
(`[hyper:C-A-S-M]`), which sends Ctrl+Alt+Shift+Super; an XKB `Hyper_L` modifier is
something else.

From a terminal:

```bash
gsettings --schemadir ~/.local/share/gnome-shell/extensions/scenic-view@twiebe.github.com/schemas \
  set org.gnome.shell.extensions.scenic-view toggle-scenic-view "['<Shift><Control><Alt><Super>Return']"
```

## How it works

- **Edge gaps via struts:** for each monitor, the extension places four invisible,
  non-reactive actors along the edges and registers them with GNOME Shell's layout
  manager as struts, the same mechanism the top bar uses. Mutter shrinks the work
  area by them, so maximizing and tiling keep the gaps natively. Each strut reaches
  past the other chrome on its side plus the gap, so the gap is measured to panels.
- **Maximize:** see [Maximize modes](#maximize-modes).
- **Scenic view** makes the window a floating window sized to the work area (without
  the edge gaps) minus the scenic margins. Toggling again restores the previous
  geometry, or maximizes the window again if it was maximized.
- **Shortcut:** registered with `Main.wm.addKeybinding()` and active in normal mode
  only (not in the overview or on the lock screen).

## Maximize modes

**Keep shadow and rounded corners (default).** When a window gets maximized, the
extension un-maximizes it and sizes it to the gapped area. It stays a normal window
with shadow and rounded corners. The extension tracks this "maximized" state itself:

- Maximizing again (button, double-click, Super+Up) restores the previous size.
- Maximizing a window in scenic view maximizes it (with the normal gaps); maximizing
  it once more restores the size it had before.
- Dragging the window or resizing it makes it a normal window again. Dropping it on
  the top screen edge maximizes it again.
- Tiling it (Super+Left/Right) makes it a normal tiled window.
- Panel, monitor and gap changes are picked up.

Trade-offs: Mutter reports a maximize only after it happened, so the application
briefly gets the maximized state and may redraw once without shadow before it is
sized back. The maximize button shows these windows as *not* maximized, and
applications won't remember being maximized on their next start.

**Real maximize (option off).** Windows maximize normally into the gapped work area.
Everything behaves as usual, but GTK/libadwaita apps draw maximized windows without
shadow and with square corners.

## Known limitations

- **No gap between tiled windows.** Mutter puts two half-tiled windows edge to edge
  and enforces the tile geometry. A gap there would need the extension to replace
  GNOME's tiling, which it doesn't.
- **Multi-monitor:** Mutter ignores struts on monitor edges that border another
  monitor, so gaps appear only on the outer edges of the combined screen area.
- **Scenic view from a tiled window** restores it as a floating window at the same
  geometry, not as a tiled window (GNOME has no extension API to re-tile).
- **The overview** shows windows within the smaller work area, so the gaps are also
  visible there.
- **Lock screen:** the extension stays enabled on the lock screen
  (`session-modes`), so that windows don't jump when GNOME would otherwise remove and
  re-add the struts on every lock/unlock. The shortcut does nothing there.
- **Reading other panels' struts** uses `Main.layoutManager._trackedActors`, a
  private field. If a future GNOME version changes it, the extension falls back to
  the top bar only.

## Troubleshooting

```bash
journalctl --user -b | grep -iE 'scenic|JS ERROR'
```

## Development

```
extension/
  metadata.json   extension metadata (uuid, shell-version, session modes)
  extension.js    GNOME Shell integration: signals, keybinding, settings
  controller.js   window logic (pseudo-maximize, scenic view), no GNOME imports
  struts.js       gap struts on the monitor edges
  keys.js         shortcut sanity check
  geometry.js     pure geometry helpers, no GNOME imports
  prefs.js        settings dialog (libadwaita, runs outside the shell)
  schemas/        GSettings schema
tests/            Node tests: geometry, the controller against a Mutter mock,
                  and a smoke test of enable()/disable() against GNOME Shell stubs
```

Run the tests with Node.js 20+:

```bash
npm test
```

The mock models what matters for the window logic: the maximize state changes right
away while the geometry follows only when the client acknowledges, un-maximize
restores the geometry saved at maximize time, fully maximized windows are constrained
to the work area, and size-increment and fixed-size clients. It is not Mutter.

`tests/shell-smoke.test.js` runs `enable()` and `disable()` against small stand-ins
for the GNOME Shell modules (`tests/shell-stubs/`), modeled on the GNOME 50 sources:
for example, `addChrome()` rejects unknown parameters like the real one. This catches
mistakes that would put the extension into the ERROR state, and checks that
`disable()` cleans up everything.

To try changes without logging out, run a nested GNOME Shell (GNOME 49+, needs the
Mutter devkit):

```bash
./install.sh
dbus-run-session gnome-shell --devkit --wayland
```

## License

[MIT](LICENSE) © 2026 Thomas Wiebe
