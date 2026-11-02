// SPDX-License-Identifier: MIT
//
// Scenic View - GNOME Shell extension
//
// - Edge gaps for maximized and tiled windows, measured to panels (struts.js).
// - Optionally keeps shadow and rounded corners on maximized windows by
//   pseudo-maximizing them (controller.js).
// - A shortcut toggles the focused window into scenic view: maximized with
//   larger margins, so more of the wallpaper stays visible.

import GLib from 'gi://GLib';
import Meta from 'gi://Meta';
import Shell from 'gi://Shell';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';

import {ScenicController, MAX_H, MAX_V, MAX_BOTH} from './controller.js';
import {GapStruts} from './struts.js';
import {usableShortcuts} from './keys.js';

const SHORTCUT_KEY = 'toggle-scenic-view';
const MAXIMIZE_BOTH = Meta.MaximizeFlags?.BOTH ?? MAX_BOTH;

function readConfig(settings) {
    return {
        outerH: settings.get_int('outer-gap-horizontal'),
        outerV: settings.get_int('outer-gap-vertical'),
        scenicH: settings.get_int('scenic-gap-horizontal'),
        scenicV: settings.get_int('scenic-gap-vertical'),
        keepDecoration: settings.get_boolean('keep-decoration-when-maximized'),
    };
}

// Maximize state across Mutter versions: the maximized-horizontally/-vertically
// properties, with the older and newer getters as fallbacks.
function maxFlags(w) {
    if (typeof w.maximized_horizontally === 'boolean')
        return (w.maximized_horizontally ? MAX_H : 0) | (w.maximized_vertically ? MAX_V : 0);
    if (typeof w.get_maximized === 'function')
        return w.get_maximized();
    if (typeof w.is_maximized === 'function')
        return w.is_maximized() ? MAX_BOTH : 0;
    return 0;
}

// Mutter 49 dropped the MaximizeFlags argument of maximize()/unmaximize().
// Try without it first; GJS throws on missing arguments for older Mutter.
function callMaximize(w, method) {
    try {
        w[method]();
    } catch (e) {
        w[method](MAXIMIZE_BOTH);
    }
}

function rectOf(r) {
    return {x: r.x, y: r.y, width: r.width, height: r.height};
}

export default class ScenicViewExtension extends Extension {
    enable() {
        this._settings = this.getSettings();
        this._idles = new Set();
        this._tracked = new Set();
        this._struts = new GapStruts();

        const platform = {
            maxFlags,
            frameRect: w => rectOf(w.get_frame_rect()),
            workArea: w => rectOf(w.get_work_area_current_monitor()),
            baseArea: w => this._struts.baseArea(w.get_monitor()) ??
                rectOf(w.get_work_area_current_monitor()),
            // Mutter's allows_resize() is FALSE for every maximized window, so
            // for those can_maximize() (FALSE for fixed-size windows) decides.
            eligible: w => w.get_window_type() === Meta.WindowType.NORMAL &&
                !w.is_fullscreen() && w.allows_move() &&
                (maxFlags(w) !== 0 ? w.can_maximize() : w.allows_resize()),
            canMaximize: w => w.can_maximize(),
            maximize: w => callMaximize(w, 'maximize'),
            unmaximize: w => callMaximize(w, 'unmaximize'),
            moveResize: (w, r) => w.move_resize_frame(true, r.x, r.y, r.width, r.height),
            later: fn => this._later(fn),
            timeout: (ms, fn) => this._timeout(ms, fn),
            now: () => GLib.get_monotonic_time() / 1000,
            log: msg => console.log(`scenic-view: ${msg}`),
        };

        const cfg = readConfig(this._settings);
        this._controller = new ScenicController(platform, cfg);
        this._struts.setGaps(cfg.outerH, cfg.outerV);

        this._settings.connectObject('changed', (s, key) => this._onSettingsChanged(key), this);

        global.display.connectObject(
            'window-created', (d, w) => this._track(w),
            'grab-op-begin', (d, w) => w && this._controller.grabBegin(w),
            'grab-op-end', (d, w) => w && this._controller.grabEnd(w),
            'workareas-changed', () => {
                this._struts.update();
                this._controller.workAreasChanged();
            },
            this);
        Main.layoutManager.connectObject('monitors-changed', () => {
            this._struts.monitorsChanged();
            this._controller.workAreasChanged();
        }, this);

        for (const actor of global.get_window_actors())
            this._track(actor.meta_window);

        this._bindShortcut();
    }

    disable() {
        this._unbindShortcut();
        for (const w of this._tracked)
            w.disconnectObject(this);
        this._tracked.clear();
        global.display.disconnectObject(this);
        Main.layoutManager.disconnectObject(this);
        this._settings.disconnectObject(this);
        for (const id of this._idles)
            GLib.source_remove(id);
        this._idles.clear();

        this._controller.destroy();
        this._controller = null;
        this._struts.destroy();
        this._struts = null;
        this._settings = null;
    }

    _onSettingsChanged(key) {
        if (key === SHORTCUT_KEY) {
            this._unbindShortcut();
            this._bindShortcut();
            return;
        }
        const cfg = readConfig(this._settings);
        this._struts.setGaps(cfg.outerH, cfg.outerV);
        this._controller.setConfig(cfg);
    }

    _bindShortcut() {
        const accels = this._settings.get_strv(SHORTCUT_KEY);
        if (!usableShortcuts(accels)) {
            // e.g. <Hyper>Return without a key mapped to Hyper would grab a
            // plain Return system-wide.
            if (accels.length)
                console.warn(`scenic-view: ignoring shortcut ${JSON.stringify(accels)}: needs Ctrl, Alt, Shift or Super`);
            return;
        }
        Main.wm.addKeybinding(SHORTCUT_KEY, this._settings,
            Meta.KeyBindingFlags.IGNORE_AUTOREPEAT, Shell.ActionMode.NORMAL,
            () => this._controller.toggleScenic(global.display.focus_window));
        this._shortcutBound = true;
    }

    _unbindShortcut() {
        if (this._shortcutBound)
            Main.wm.removeKeybinding(SHORTCUT_KEY);
        this._shortcutBound = false;
    }

    _track(w) {
        if (!w || this._tracked.has(w) || w.get_window_type() !== Meta.WindowType.NORMAL)
            return;
        this._tracked.add(w);
        const changed = () => this._controller.windowChanged(w);
        w.connectObject(
            'size-changed', changed,
            'position-changed', changed,
            'unmanaged', () => {
                this._tracked.delete(w);
                w.disconnectObject(this);
                this._controller.removeWindow(w);
            },
            this);
        // Not every Mutter version has these properties; size-changed covers
        // maximize as well.
        for (const prop of ['maximized-horizontally', 'maximized-vertically']) {
            try {
                w.connectObject(`notify::${prop}`, changed, this);
            } catch (e) {
                // property missing
            }
        }
        this._controller.addWindow(w);
    }

    _later(fn) {
        this._addSource(cb => GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, cb), fn);
    }

    _timeout(ms, fn) {
        this._addSource(cb => GLib.timeout_add(GLib.PRIORITY_DEFAULT, ms, cb), fn);
    }

    // Sources still pending are removed in disable().
    _addSource(add, fn) {
        const id = add(() => {
            this._idles.delete(id);
            try {
                fn();
            } catch (e) {
                console.error(`scenic-view: ${e}\n${e.stack}`);
            }
            return GLib.SOURCE_REMOVE;
        });
        this._idles.add(id);
    }
}
