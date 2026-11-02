// SPDX-License-Identifier: MIT
//
// Runs extension.js enable()/disable() against stand-ins for the GNOME Shell
// modules (tests/shell-stubs). Catches integration mistakes such as wrong
// addChrome() parameters, unknown signals or keybinding/settings mismatches,
// which would put the extension into the ERROR state. Not GNOME Shell.

import './shell-stubs/hooks.js';

import test from 'node:test';
import assert from 'node:assert/strict';

import {addSignalMethods} from './shell-stubs/signals.js';
import {sources, runSources} from './shell-stubs/glib.js';
import * as Main from './shell-stubs/main.js';
import {Extension, settingsValues} from './shell-stubs/extension.js';

const DISPLAY_SIGNALS = ['window-created', 'grab-op-begin', 'grab-op-end', 'workareas-changed'];
const WINDOW_SIGNALS = ['size-changed', 'position-changed', 'unmanaged', 'unmanaging', 'notify'];

function fakeWindow(rect) {
    const w = addSignalMethods({
        rect: {...rect},
        maximized_horizontally: false,
        maximized_vertically: false,
        get_window_type: () => 0,
        is_fullscreen: () => false,
        allows_move: () => true,
        // Mutter: FALSE for maximized windows (meta_window_allows_resize()).
        allows_resize() { return !this.maximized_horizontally && !this.maximized_vertically; },
        can_maximize: () => true,
        get_monitor: () => 0,
        get_frame_rect() { return {...this.rect}; },
        get_work_area_current_monitor: () => ({x: 32, y: 64, width: 1856, height: 984}),
        maximize() { this.maximized_horizontally = this.maximized_vertically = true; },
        unmaximize() { this.maximized_horizontally = this.maximized_vertically = false; },
        move_resize_frame(userOp, x, y, width, height) {
            this.rect = {x, y, width, height};
        },
    }, WINDOW_SIGNALS);
    return w;
}

const window1 = fakeWindow({x: 300, y: 200, width: 900, height: 600});
globalThis.global = {
    display: addSignalMethods({focus_window: window1}, DISPLAY_SIGNALS),
    get_window_actors: () => [{meta_window: window1}],
};

const {default: ScenicViewExtension} = await import('../extension/extension.js');

const ours = () => Main.layoutManager._trackedActors.filter(d => d.actor.name?.startsWith('scenic-view'));

test('enable() and disable() run and clean up', () => {
    const ext = new ScenicViewExtension({uuid: 'scenic-view@twiebe.github.com'});
    ext.enable();

    assert.equal(ours().length, 4);
    const top = ours().find(d => d.actor.name.endsWith('top')).actor;
    // Top strut reaches past the 32 px top bar by the 32 px gap.
    assert.deepEqual([top.x, top.y, top.width, top.height], [0, 0, 1920, 64]);
    assert.ok(Main.wm.keybindings.has('toggle-scenic-view'));
    assert.ok(window1._handlers.length > 0);

    ext.disable();
    assert.equal(ours().length, 0);
    assert.ok(!Main.wm.keybindings.has('toggle-scenic-view'));
    assert.equal(window1._handlers.length, 0);
    assert.equal(global.display._handlers.length, 0);
    assert.equal(sources.size, 0);
});

test('the shortcut puts the focused window into scenic view and back', () => {
    const ext = new ScenicViewExtension({uuid: 'scenic-view@twiebe.github.com'});
    ext.enable();
    const before = window1.get_frame_rect();
    Main.wm.keybindings.get('toggle-scenic-view')();
    // Base area: below the 32 px top bar, minus the 80 px scenic margins.
    assert.deepEqual(window1.get_frame_rect(), {x: 80, y: 112, width: 1760, height: 888});
    Main.wm.keybindings.get('toggle-scenic-view')();
    assert.deepEqual(window1.get_frame_rect(), before);
    runSources();
    ext.disable();
});

test('gap 0 leaves empty struts, since GNOME Shell counts hidden chrome too', () => {
    const ext = new ScenicViewExtension({uuid: 'scenic-view@twiebe.github.com'});
    ext.enable();
    settingsValues['outer-gap-horizontal'] = 0;
    Extension.lastSettings.emit('changed', 'outer-gap-horizontal');
    for (const side of ['left', 'right']) {
        const a = ours().find(d => d.actor.name.endsWith(side)).actor;
        assert.equal(a.width * a.height, 0, side);
    }
    settingsValues['outer-gap-horizontal'] = 32;
    ext.disable();
});

test('new windows are tracked and removed windows forgotten', () => {
    const ext = new ScenicViewExtension({uuid: 'scenic-view@twiebe.github.com'});
    ext.enable();
    const w = fakeWindow({x: 10, y: 100, width: 500, height: 400});
    global.display.emit('window-created', w);
    w.maximize();
    w.emit('notify::maximized-vertically');
    runSources(); // pseudo-maximize
    assert.equal(w.maximized_horizontally, false);
    assert.deepEqual(w.get_frame_rect(), {x: 32, y: 64, width: 1856, height: 984});
    w.emit('unmanaged');
    assert.equal(w._handlers.length, 0);
    ext.disable();
});

test('a shortcut with only Hyper is not registered (it could become a bare Return)', () => {
    const ext = new ScenicViewExtension({uuid: 'scenic-view@twiebe.github.com'});
    const saved = settingsValues['toggle-scenic-view'];
    settingsValues['toggle-scenic-view'] = ['<Hyper>Return'];
    const warn = console.warn;
    console.warn = () => {};
    try {
        ext.enable();
        assert.ok(!Main.wm.keybindings.has('toggle-scenic-view'));
        // Fixing the setting registers it right away.
        settingsValues['toggle-scenic-view'] = ['<Super><Alt>Return'];
        Extension.lastSettings.emit('changed', 'toggle-scenic-view');
        assert.ok(Main.wm.keybindings.has('toggle-scenic-view'));
        // And breaking it again removes it.
        settingsValues['toggle-scenic-view'] = ['<Hyper>Return'];
        Extension.lastSettings.emit('changed', 'toggle-scenic-view');
        assert.ok(!Main.wm.keybindings.has('toggle-scenic-view'));
        ext.disable();
    } finally {
        console.warn = warn;
        settingsValues['toggle-scenic-view'] = saved;
    }
});

test('the default shortcut from the schema is usable', async () => {
    const {readFileSync} = await import('node:fs');
    const {usableShortcuts} = await import('../extension/keys.js');
    const xml = readFileSync(new URL('../extension/schemas/org.gnome.shell.extensions.scenic-view.gschema.xml', import.meta.url), 'utf8');
    const m = xml.match(/name="toggle-scenic-view"[\s\S]*?<default><!\[CDATA\[(.*?)\]\]><\/default>/);
    const accels = JSON.parse(m[1].replaceAll("'", '"'));
    assert.ok(usableShortcuts(accels), m[1]);
});
