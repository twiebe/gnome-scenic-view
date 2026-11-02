// SPDX-License-Identifier: MIT
//
// Edge gaps via struts. For each monitor, four invisible chrome actors along
// the edges are registered with `affectsStruts`. Mutter shrinks the work area
// by them, so real maximize and native tiling (Super+Left/Right, dragging to
// an edge) keep the gap without us fighting Mutter's geometry constraints.
//
// Each strut reaches past the other chrome on its side (top bar, docks) plus
// the gap, so the gap is measured to panels, not to the screen edge.
//
// Mutter ignores struts on monitor edges that border another monitor, so in
// multi-monitor setups the gaps only appear on the outer edges.

import St from 'gi://St';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import * as G from './geometry.js';

const SIDES = ['top', 'bottom', 'left', 'right'];

export class GapStruts {
    constructor() {
        this._gapH = 0;
        this._gapV = 0;
        this._monitors = []; // per monitor: {side: actor}
        this._mine = new Set();
        this._base = []; // per monitor: base area (without our struts)
        this._rebuild();
    }

    setGaps(gapH, gapV) {
        this._gapH = gapH;
        this._gapV = gapV;
        this.update();
    }

    // The work area of a monitor without our gap struts.
    baseArea(monitorIndex) {
        const m = Main.layoutManager.monitors[monitorIndex];
        if (!m)
            return null;
        return this._base[monitorIndex] ?? G.rectOf(m);
    }

    monitorsChanged() {
        this._rebuild();
    }

    update() {
        const others = this._otherStrutRects();
        Main.layoutManager.monitors.forEach((monitor, i) => {
            const m = G.rectOf(monitor);
            const base = G.baseInsets(m, others);
            this._base[i] = G.areaFromInsets(m, base);
            const rects = G.gapStrutRects(m, base, this._gapH, this._gapV);
            const actors = this._monitors[i];
            if (!actors)
                return;
            for (const side of SIDES) {
                // GNOME Shell counts the struts of hidden chrome too, so a
                // side without gap gets an empty rect instead of hide().
                const r = rects[side] ?? {x: m.x, y: m.y, width: 0, height: 0};
                const actor = actors[side];
                // Only touch the actor if something changed: our own change
                // triggers workareas-changed, which calls update() again.
                if (actor.x !== r.x || actor.y !== r.y ||
                    actor.width !== r.width || actor.height !== r.height) {
                    actor.set_position(r.x, r.y);
                    actor.set_size(r.width, r.height);
                }
            }
        });
    }

    destroy() {
        this._destroyActors();
        this._base = [];
    }

    _rebuild() {
        this._destroyActors();
        this._base = [];
        for (let i = 0; i < Main.layoutManager.monitors.length; i++) {
            const actors = {};
            for (const side of SIDES) {
                const actor = new St.Widget({
                    name: `scenic-view-strut-${i}-${side}`,
                    reactive: false, // clicks go through to the windows
                    width: 0,
                    height: 0,
                });
                Main.layoutManager.addChrome(actor, {affectsStruts: true});
                this._mine.add(actor);
                actors[side] = actor;
            }
            this._monitors.push(actors);
        }
        this.update();
    }

    _destroyActors() {
        for (const actor of this._mine) {
            Main.layoutManager.removeChrome(actor);
            actor.destroy();
        }
        this._mine.clear();
        this._monitors = [];
    }

    // Rects of the struts of all other chrome. LayoutManager keeps no public
    // list of them, so this reads its private _trackedActors; if that ever
    // changes, fall back to the top bar.
    _otherStrutRects() {
        const lm = Main.layoutManager;
        const tracked = Array.isArray(lm._trackedActors)
            ? lm._trackedActors
            : [{actor: lm.panelBox, affectsStruts: true}];
        const rects = [];
        for (const data of tracked) {
            const actor = data?.actor;
            // Like LayoutManager._updateRegions(): hidden chrome counts too.
            if (!data?.affectsStruts || !actor || this._mine.has(actor))
                continue;
            const [x, y] = actor.get_transformed_position();
            const [width, height] = actor.get_transformed_size();
            if ([x, y, width, height].every(Number.isFinite) && width > 0 && height > 0)
                rects.push({x, y, width, height});
        }
        return rects;
    }
}
