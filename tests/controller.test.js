// SPDX-License-Identifier: MIT
//
// Tests of the window logic against a small Mutter mock. Modeled behavior:
// - maximize()/unmaximize() change the maximize state right away (and notify),
//   the geometry follows when the client acknowledges the configure (async).
// - un-maximize restores the geometry saved at maximize time.
// - a fully maximized window is constrained to the work area.
// - later() runs after the current operation (idle).
// This is not Mutter; check changes in a real session too.

import test from 'node:test';
import assert from 'node:assert/strict';

import {ScenicController, MAX_V, MAX_BOTH, SETTLE_MS} from '../extension/controller.js';
import {sameRect} from '../extension/geometry.js';

const MONITOR = {x: 0, y: 0, width: 1920, height: 1080};
const BASE = {x: 0, y: 32, width: 1920, height: 1048}; // top bar
const GAP = 32;

class World {
    constructor(cfg = {}) {
        this.clock = 0;
        this.queue = [];
        this.timers = [];
        this.base = {...BASE};
        this.gap = GAP;
        this.moveResizeCalls = 0;
        const world = this;
        this.platform = {
            maxFlags: w => w.flags,
            frameRect: w => ({...w.rect}),
            workArea: () => world.workArea(),
            baseArea: () => ({...world.base}),
            eligible: w => !w.fullscreen,
            canMaximize: () => true,
            maximize: w => world.maximize(w),
            unmaximize: w => world.unmaximize(w),
            moveResize: (w, r) => {
                world.moveResizeCalls++;
                world.configure(w, w.flags === MAX_BOTH ? world.workArea() : r);
            },
            later: fn => world.queue.push(fn),
            timeout: (ms, fn) => world.timers.push({at: world.clock + ms, fn}),
            now: () => world.clock,
            log: () => {},
        };
        this.c = new ScenicController(this.platform, {
            outerH: GAP, outerV: GAP, scenicH: 80, scenicV: 80, keepDecoration: true, ...cfg,
        });
    }

    workArea() {
        const b = this.base, g = this.gap;
        return {x: b.x + g, y: b.y + g, width: b.width - 2 * g, height: b.height - 2 * g};
    }

    scenic() {
        return {x: this.base.x + 80, y: this.base.y + 80, width: this.base.width - 160, height: this.base.height - 160};
    }

    window(rect, opts = {}) {
        const w = {rect: {...rect}, flags: 0, saved: null, fullscreen: false, ...opts};
        this.c.addWindow(w);
        this.run();
        return w;
    }

    // What the client makes of a requested size.
    adjust(w, r) {
        if (w.fixedSize)
            return {...r, width: w.rect.width, height: w.rect.height};
        if (w.step) {
            return {...r, width: r.width - (r.width % w.step), height: r.height - (r.height % w.step)};
        }
        return {...r};
    }

    configure(w, r) {
        const target = {...r};
        this.queue.push(() => {
            const next = this.adjust(w, target);
            if (sameRect(next, w.rect))
                return;
            w.rect = next;
            this.c.windowChanged(w);
        });
    }

    maximize(w) {
        if (w.flags === MAX_BOTH)
            return;
        if (w.flags === 0)
            w.saved = {...w.rect};
        w.flags = MAX_BOTH;
        this.c.windowChanged(w); // notify::maximized-*
        this.configure(w, this.workArea());
    }

    unmaximize(w) {
        if (w.flags === 0)
            return;
        w.flags = 0;
        this.c.windowChanged(w);
        if (w.saved)
            this.configure(w, w.saved);
    }

    // The user or the app maximizes / un-maximizes (button, double-click, Super+Up).
    userMaximize(w) {
        if (w.flags === MAX_BOTH)
            this.unmaximize(w);
        else
            this.maximize(w);
        this.run();
    }

    userTile(w) {
        w.saved = {...w.rect};
        w.flags = MAX_V;
        this.c.windowChanged(w);
        const a = this.workArea();
        this.configure(w, {x: a.x, y: a.y, width: a.width / 2, height: a.height});
        this.run();
    }

    drag(w, dx, dy, {dropOnTop = false} = {}) {
        this.c.grabBegin(w);
        w.rect = {...w.rect, x: w.rect.x + dx, y: w.rect.y + dy};
        this.c.windowChanged(w);
        if (dropOnTop)
            this.maximize(w);
        this.c.grabEnd(w);
        this.run();
    }

    shortcut(w) {
        this.c.toggleScenic(w);
        this.run();
    }

    advance(ms) {
        this.clock += ms;
        const due = this.timers.filter(t => t.at <= this.clock);
        this.timers = this.timers.filter(t => t.at > this.clock);
        due.forEach(t => this.queue.push(t.fn));
        this.run();
    }

    run() {
        for (let i = 0; this.queue.length; i++) {
            assert.ok(i < 1000, 'event loop does not settle');
            this.queue.shift()();
            this.clock += 1;
        }
    }
}

const FLOAT = {x: 300, y: 200, width: 900, height: 600};

test('pseudo-maximize: maximizing sizes the window to the gapped area, not maximized', () => {
    const t = new World();
    const w = t.window(FLOAT);
    t.userMaximize(w);
    assert.equal(w.flags, 0);
    assert.deepEqual(w.rect, t.workArea());
    assert.equal(t.c.pseudoKind(w), 'max');
});

test('pseudo-maximize: maximizing again restores the previous geometry', () => {
    const t = new World();
    const w = t.window(FLOAT);
    t.userMaximize(w);
    t.advance(SETTLE_MS * 2);
    t.userMaximize(w);
    assert.equal(w.flags, 0);
    assert.deepEqual(w.rect, FLOAT);
    assert.ok(!t.c.isPseudo(w));
    // ...and once more
    t.userMaximize(w);
    assert.deepEqual(w.rect, t.workArea());
});

test('a window that is maximized when first seen gets a centered restore size', () => {
    const t = new World();
    const w = {rect: t.workArea(), flags: MAX_BOTH, saved: null, fullscreen: false};
    t.c.addWindow(w);
    t.run();
    assert.equal(w.flags, 0);
    assert.equal(t.c.pseudoKind(w), 'max');
    t.advance(SETTLE_MS * 2);
    t.userMaximize(w);
    assert.ok(!t.c.isPseudo(w));
    assert.ok(w.rect.width < t.workArea().width && w.rect.height < t.workArea().height);
});

test('dragging a pseudo-maximized window makes it a normal window', () => {
    const t = new World();
    const w = t.window(FLOAT);
    t.userMaximize(w);
    t.advance(SETTLE_MS * 2);
    t.drag(w, 50, 40);
    assert.ok(!t.c.isPseudo(w));
    // Maximizing now pseudo-maximizes again and restores the dragged geometry.
    t.userMaximize(w);
    assert.equal(t.c.pseudoKind(w), 'max');
    t.advance(SETTLE_MS * 2);
    const dragged = {...t.workArea(), x: t.workArea().x + 50, y: t.workArea().y + 40};
    t.userMaximize(w);
    assert.deepEqual(w.rect, dragged);
});

test('dropping a pseudo-maximized window on the top edge keeps the original restore size', () => {
    const t = new World();
    const w = t.window(FLOAT);
    t.userMaximize(w);
    t.advance(SETTLE_MS * 2);
    t.drag(w, 50, 40, {dropOnTop: true});
    assert.equal(t.c.pseudoKind(w), 'max');
    assert.deepEqual(w.rect, t.workArea());
    t.advance(SETTLE_MS * 2);
    t.userMaximize(w);
    assert.deepEqual(w.rect, FLOAT);
});

test('scenic view from a floating window and back', () => {
    const t = new World();
    const w = t.window(FLOAT);
    t.shortcut(w);
    assert.deepEqual(w.rect, t.scenic());
    assert.equal(t.c.pseudoKind(w), 'scenic');
    t.shortcut(w);
    assert.deepEqual(w.rect, FLOAT);
    assert.ok(!t.c.isPseudo(w));
});

test('scenic view from a pseudo-maximized window goes back to maximized', () => {
    const t = new World();
    const w = t.window(FLOAT);
    t.userMaximize(w);
    t.shortcut(w);
    assert.deepEqual(w.rect, t.scenic());
    t.shortcut(w);
    assert.deepEqual(w.rect, t.workArea());
    assert.equal(t.c.pseudoKind(w), 'max');
    t.advance(SETTLE_MS * 2);
    t.userMaximize(w);
    assert.deepEqual(w.rect, FLOAT);
});

test('maximizing a window in scenic view maximizes it, maximizing again restores it', () => {
    const t = new World();
    const w = t.window(FLOAT);
    t.shortcut(w);
    t.advance(SETTLE_MS * 2);
    t.userMaximize(w);
    assert.equal(w.flags, 0);
    assert.deepEqual(w.rect, t.workArea());
    assert.equal(t.c.pseudoKind(w), 'max');
    t.advance(SETTLE_MS * 2);
    t.userMaximize(w);
    assert.deepEqual(w.rect, FLOAT);
    assert.ok(!t.c.isPseudo(w));
});

test('maximize, scenic view, maximize: maximized again, then the original size', () => {
    const t = new World();
    const w = t.window(FLOAT);
    t.userMaximize(w);
    t.shortcut(w);
    assert.deepEqual(w.rect, t.scenic());
    t.advance(SETTLE_MS * 2);
    t.userMaximize(w);
    assert.deepEqual(w.rect, t.workArea());
    assert.equal(t.c.pseudoKind(w), 'max');
    // The shortcut toggles scenic view from there as usual.
    t.shortcut(w);
    assert.deepEqual(w.rect, t.scenic());
    t.shortcut(w);
    assert.deepEqual(w.rect, t.workArea());
    t.advance(SETTLE_MS * 2);
    t.userMaximize(w);
    assert.deepEqual(w.rect, FLOAT);
    assert.ok(!t.c.isPseudo(w));
});

test('real maximize mode: maximize is left to Mutter and the struts', () => {
    const t = new World({keepDecoration: false});
    const w = t.window(FLOAT);
    t.userMaximize(w);
    assert.equal(w.flags, MAX_BOTH);
    assert.deepEqual(w.rect, t.workArea());
    assert.equal(t.moveResizeCalls, 0);
});

test('real maximize mode: scenic view and back to a real maximize that restores the original size', () => {
    const t = new World({keepDecoration: false});
    const w = t.window(FLOAT);
    t.userMaximize(w);
    t.shortcut(w);
    assert.equal(w.flags, 0);
    assert.deepEqual(w.rect, t.scenic());
    t.shortcut(w);
    assert.equal(w.flags, MAX_BOTH);
    assert.deepEqual(w.rect, t.workArea());
    t.userMaximize(w); // un-maximize
    assert.deepEqual(w.rect, FLOAT);
});

test('scenic view from a tiled window restores the tile geometry as a floating window', () => {
    const t = new World();
    const w = t.window(FLOAT);
    t.userTile(w);
    const tiled = {...w.rect};
    t.shortcut(w);
    assert.equal(w.flags, 0);
    assert.deepEqual(w.rect, t.scenic());
    t.shortcut(w);
    assert.deepEqual(w.rect, tiled);
});

test('tiling a pseudo-maximized window ends pseudo-maximize', () => {
    const t = new World();
    const w = t.window(FLOAT);
    t.userMaximize(w);
    t.userTile(w);
    assert.ok(!t.c.isPseudo(w));
    assert.equal(w.flags, MAX_V);
});

test('work area changes refit pseudo windows', () => {
    const t = new World();
    const w = t.window(FLOAT);
    t.userMaximize(w);
    t.advance(SETTLE_MS * 2);
    t.base = {x: 0, y: 48, width: 1920, height: 1032}; // taller top bar
    t.c.workAreasChanged();
    t.run();
    assert.deepEqual(w.rect, t.workArea());
    t.gap = 10;
    t.c.setConfig({...t.c.config, outerH: 10, outerV: 10});
    t.run();
    assert.deepEqual(w.rect, t.workArea());
});

test('an app resizing a pseudo window after it settled makes it a normal window', () => {
    const t = new World();
    const w = t.window(FLOAT);
    t.userMaximize(w);
    t.advance(SETTLE_MS * 2);
    t.configure(w, {...w.rect, width: 700});
    t.run();
    assert.ok(!t.c.isPseudo(w));
    assert.equal(w.rect.width, 700);
});

test('size-increment clients are accepted a few pixels short', () => {
    const t = new World();
    const w = t.window({x: 300, y: 200, width: 800, height: 600}, {step: 20});
    t.userMaximize(w);
    t.advance(SETTLE_MS * 2);
    const a = t.workArea();
    assert.deepEqual(w.rect, {x: a.x, y: a.y, width: a.width - (a.width % 20), height: a.height - (a.height % 20)});
    assert.ok(t.moveResizeCalls <= 3, `moveResize called ${t.moveResizeCalls} times`);
    assert.equal(t.c.pseudoKind(w), 'max');
});

test('clients that refuse the size are not fought endlessly', () => {
    const t = new World();
    const w = t.window(FLOAT, {fixedSize: true});
    t.shortcut(w);
    assert.ok(t.moveResizeCalls <= 4, `moveResize called ${t.moveResizeCalls} times`);
});

test('switching keep-decoration off turns pseudo-maximized windows into real ones', () => {
    const t = new World();
    const w = t.window(FLOAT);
    t.userMaximize(w);
    t.c.setConfig({...t.c.config, keepDecoration: false});
    t.run();
    assert.equal(w.flags, MAX_BOTH);
    assert.ok(!t.c.isPseudo(w));
    t.userMaximize(w);
    assert.deepEqual(w.rect, FLOAT);
});

test('switching keep-decoration on turns maximized windows into pseudo ones', () => {
    const t = new World({keepDecoration: false});
    const w = t.window(FLOAT);
    t.userMaximize(w);
    t.c.setConfig({...t.c.config, keepDecoration: true});
    t.run();
    assert.equal(w.flags, 0);
    assert.equal(t.c.pseudoKind(w), 'max');
    t.advance(SETTLE_MS * 2);
    t.userMaximize(w);
    assert.deepEqual(w.rect, FLOAT);
});

test('removed windows are forgotten, queued work for them is dropped', () => {
    const t = new World();
    const w = t.window(FLOAT);
    t.maximize(w);
    t.c.removeWindow(w);
    t.run();
    assert.ok(!t.c.isPseudo(w));
    assert.equal(w.flags, MAX_BOTH);
});

test('fullscreen windows are left alone', () => {
    const t = new World();
    const w = t.window(FLOAT);
    w.fullscreen = true;
    t.shortcut(w);
    t.userMaximize(w);
    assert.ok(!t.c.isPseudo(w));
});

test('real maximize from a window that refuses the restore size still happens after a timeout', () => {
    const t = new World({keepDecoration: false});
    const w = t.window(FLOAT);
    t.userMaximize(w);
    t.shortcut(w);
    w.fixedSize = true; // from now on the client keeps its size
    t.shortcut(w);
    assert.equal(w.flags, 0);
    t.advance(SETTLE_MS + 1);
    assert.equal(w.flags, MAX_BOTH);
});
