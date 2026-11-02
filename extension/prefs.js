// SPDX-License-Identifier: MIT
//
// Settings dialog. Runs in its own process (the Extensions app), not in
// GNOME Shell; changes reach the extension through GSettings and take effect
// right away.

import Adw from 'gi://Adw';
import Gdk from 'gi://Gdk';
import Gio from 'gi://Gio';
import Gtk from 'gi://Gtk';
import {ExtensionPreferences} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

import {hasReliableModifier} from './keys.js';

const SHORTCUT_KEY = 'toggle-scenic-view';

function spinRow(settings, key, title, max) {
    const row = Adw.SpinRow.new_with_range(0, max, 1);
    row.title = title;
    settings.bind(key, row, 'value', Gio.SettingsBindFlags.DEFAULT);
    return row;
}

function shortcutLabel(settings) {
    const accel = settings.get_strv(SHORTCUT_KEY)[0];
    if (!accel)
        return 'Disabled';
    if (!hasReliableModifier(accel))
        return `${accel} (ignored: needs Ctrl, Alt, Shift or Super)`;
    const [ok, keyval, mods] = Gtk.accelerator_parse(accel);
    return ok ? Gtk.accelerator_get_label(keyval, mods) : accel;
}

// A small modal window that records the next key combination.
function captureShortcut(parent, settings) {
    const win = new Adw.Window({
        transient_for: parent,
        modal: true,
        title: 'Set Shortcut',
        default_width: 420,
        default_height: 260,
    });
    const view = new Adw.ToolbarView();
    view.add_top_bar(new Adw.HeaderBar());
    view.content = new Adw.StatusPage({
        icon_name: 'preferences-desktop-keyboard-shortcuts-symbolic',
        title: 'Press the new shortcut',
        description: 'Use Ctrl, Alt, Shift or Super. Esc to cancel, Backspace to disable the shortcut',
    });
    win.content = view;

    const keys = new Gtk.EventControllerKey();
    keys.connect('key-pressed', (c, keyval, keycode, state) => {
        const mask = state & Gtk.accelerator_get_default_mod_mask() & ~Gdk.ModifierType.LOCK_MASK;
        if (mask === 0 && keyval === Gdk.KEY_Escape) {
            win.close();
            return Gdk.EVENT_STOP;
        }
        if (mask === 0 && keyval === Gdk.KEY_BackSpace) {
            settings.set_strv(SHORTCUT_KEY, []);
            win.close();
            return Gdk.EVENT_STOP;
        }
        const key = Gdk.keyval_to_lower(keyval);
        // Require a modifier, and ignore modifier keys pressed on their own.
        if (mask === 0 || !Gtk.accelerator_valid(key, mask))
            return Gdk.EVENT_STOP;
        const accel = Gtk.accelerator_name(key, mask);
        if (!hasReliableModifier(accel))
            return Gdk.EVENT_STOP; // Hyper/Meta alone may end up as a bare key
        settings.set_strv(SHORTCUT_KEY, [accel]);
        win.close();
        return Gdk.EVENT_STOP;
    });
    win.add_controller(keys);
    win.present();
}

export default class ScenicViewPreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const settings = this.getSettings();
        window._settings = settings; // keep it alive as long as the window

        const page = new Adw.PreferencesPage({
            title: 'Scenic View',
            icon_name: 'preferences-system-symbolic',
        });
        window.add(page);

        const gaps = new Adw.PreferencesGroup({
            title: 'Gaps',
            description: 'For maximized and tiled windows, measured to panels. In logical pixels.',
        });
        gaps.add(spinRow(settings, 'outer-gap-horizontal', 'Edges, left/right', 200));
        gaps.add(spinRow(settings, 'outer-gap-vertical', 'Edges, top/bottom', 200));
        page.add(gaps);

        const maximized = new Adw.PreferencesGroup({title: 'Maximized Windows'});
        const keep = new Adw.SwitchRow({
            title: 'Keep shadow and rounded corners',
            subtitle: 'Maximized windows become normal windows sized to the gapped area. ' +
                'Apps may briefly redraw as maximized.',
        });
        settings.bind('keep-decoration-when-maximized', keep, 'active', Gio.SettingsBindFlags.DEFAULT);
        maximized.add(keep);
        page.add(maximized);

        const scenic = new Adw.PreferencesGroup({
            title: 'Scenic View',
            description: 'Maximize with larger margins, so more of the wallpaper stays visible.',
        });
        scenic.add(spinRow(settings, 'scenic-gap-horizontal', 'Margin, left/right', 1000));
        scenic.add(spinRow(settings, 'scenic-gap-vertical', 'Margin, top/bottom', 1000));

        const shortcut = new Adw.ActionRow({title: 'Toggle scenic view', activatable: true});
        const label = new Gtk.Label({label: shortcutLabel(settings), css_classes: ['dim-label']});
        shortcut.add_suffix(label);
        shortcut.add_suffix(new Gtk.Image({icon_name: 'document-edit-symbolic'}));
        shortcut.connect('activated', () => captureShortcut(window, settings));
        const id = settings.connect(`changed::${SHORTCUT_KEY}`, () => {
            label.label = shortcutLabel(settings);
        });
        window.connect('close-request', () => {
            settings.disconnect(id);
            return false;
        });
        scenic.add(shortcut);
        page.add(scenic);
    }
}
