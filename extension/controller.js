// SPDX-License-Identifier: MIT
//
// Window logic of Scenic View, independent of GNOME Shell so it can be tested
// under Node. extension.js feeds it Mutter signals and gives it a `platform`:
//
//   maxFlags(w)      0, MAX_H, MAX_V or MAX_BOTH
//   frameRect(w)     current frame rect
//   workArea(w)      Mutter's work area of the window's monitor (includes our
//                    gap struts, so it is the gapped area)
//   baseArea(w)      the same area without our gap struts (panels excluded)
//   eligible(w)      normal, movable, resizable, not fullscreen
//   canMaximize(w)
//   maximize(w), unmaximize(w), moveResize(w, rect)
//   later(fn)        run fn once Mutter has finished the current operation
//   timeout(ms, fn)  run fn after ms milliseconds
//   now()            milliseconds, monotonic
//   log(msg)
//
// Edge gaps for real maximize and native tiling come from struts (struts.js),
// not from here. This module does two things:
//
// 1. Pseudo-maximize ("keep decoration" setting): GTK/libadwaita apps drop
//    their shadow and rounded corners when maximized. So when a window gets
//    maximized, we un-maximize it right away and size it to the work area
//    instead. It stays a normal window. Maximizing it again (button,
//    double-click, Super+Up) restores the previous geometry. Mutter tells us
//    about a maximize only after the fact, so the app sees it briefly.
// 2. Scenic view: a floating window sized to the area minus the scenic
//    margins. Toggling again restores what was there before.

import * as G from './geometry.js';

export const MAX_H = 1;
export const MAX_V = 2;
export const MAX_BOTH = 3;

// After we size a pseudo window, geometry changes for this long are
// acknowledgements of our own (or of Mutter's un-maximize) requests: we fit
// the window again. Later unexpected changes mean the user or the app changed
// the window (keyboard tiling, app resize): it becomes a normal window.
export const SETTLE_MS = 1000;

export class ScenicController {
    constructor(platform, config) {
        this._p = platform;
        this._cfg = {...config};
        this._windows = new Set();
        // w -> {kind: 'max' | 'scenic', restore: rect, fromMax: bool, settleUntil: ms}
        this._pseudo = new Map();
        this._lastNormal = new Map(); // w -> last geometry while not maximized
        this._busy = new Set(); // windows we are changing right now
        this._grabbed = new Map(); // w -> pseudo state when a move/resize grab began
        this._pending = new Set(); // windows with an intercepted maximize queued
        this._maximizeAt = new Map(); // w -> rect to reach before maximizing for real
        this._rate = new G.RateLimiter(4, 1000, () => platform.now());
    }

    get config() {
        return {...this._cfg};
    }

    isPseudo(w) {
        return this._pseudo.has(w);
    }

    pseudoKind(w) {
        return this._pseudo.get(w)?.kind ?? null;
    }

    destroy() {
        this._windows.clear();
        this._pseudo.clear();
        this._lastNormal.clear();
        this._busy.clear();
        this._grabbed.clear();
        this._pending.clear();
        this._maximizeAt.clear();
    }

    // -----------------------------------------------------------------------
    // Signals from extension.js

    addWindow(w) {
        if (this._windows.has(w))
            return;
        this._windows.add(w);
        if (!this._p.eligible(w))
            return;
        const flags = this._p.maxFlags(w);
        if (flags === 0)
            this._lastNormal.set(w, G.rectOf(this._p.frameRect(w)));
        else if (flags === MAX_BOTH && this._cfg.keepDecoration)
            this._interceptMaximize(w);
    }

    removeWindow(w) {
        this._windows.delete(w);
        this._pseudo.delete(w);
        this._lastNormal.delete(w);
        this._busy.delete(w);
        this._grabbed.delete(w);
        this._pending.delete(w);
        this._maximizeAt.delete(w);
        this._rate.forget(w);
    }

    // Size, position or maximize state changed.
    windowChanged(w) {
        if (!this._windows.has(w) || this._busy.has(w) || !this._p.eligible(w))
            return;
        const flags = this._p.maxFlags(w);
        const p = this._pseudo.get(w);

        const at = this._maximizeAt.get(w);
        if (at && flags === 0) {
            const g = this._p.frameRect(w);
            if (G.sameRect(g, at) || G.roundedFrom(g, at))
                this._maximizeNow(w);
            return;
        }

        if (flags === MAX_BOTH) {
            if (this._cfg.keepDecoration)
                this._interceptMaximize(w);
            else if (p)
                this._pseudo.delete(w); // the user maximized a scenic window
            return;
        }
        if (flags !== 0) {
            // Partially maximized or tiled (Super+Left/Right): not ours any more.
            this._pseudo.delete(w);
            return;
        }
        if (p) {
            if (this._grabbed.has(w))
                return;
            if (this._p.now() < p.settleUntil) {
                this._fit(w);
                return;
            }
            const g = this._p.frameRect(w);
            const t = this._target(w, p);
            if (!G.sameRect(g, t) && !G.roundedFrom(g, t))
                this._pseudo.delete(w);
            else
                return;
        }
        if (!this._pending.has(w))
            this._lastNormal.set(w, G.rectOf(this._p.frameRect(w)));
    }

    grabBegin(w) {
        if (!this._windows.has(w))
            return;
        const p = this._pseudo.get(w);
        if (p)
            this._grabbed.set(w, p);
    }

    grabEnd(w) {
        if (!this._grabbed.has(w))
            return;
        const atStart = this._grabbed.get(w);
        // Wait for a maximize from dropping the window on the top edge, which
        // re-enters pseudo-maximize with a new state object.
        this._p.later(() => {
            this._grabbed.delete(w);
            const p = this._pseudo.get(w);
            if (!p || p !== atStart || !this._windows.has(w))
                return;
            const g = this._p.frameRect(w);
            const t = this._target(w, p);
            if (!G.sameRect(g, t) && !G.roundedFrom(g, t)) {
                this._pseudo.delete(w); // moved or resized: a normal window now
                this._lastNormal.set(w, G.rectOf(g));
            }
        });
    }

    workAreasChanged() {
        for (const w of this._pseudo.keys())
            this._refit(w);
    }

    setConfig(cfg) {
        const old = this._cfg;
        this._cfg = {...cfg};
        if (old.keepDecoration && !cfg.keepDecoration) {
            // Pseudo-maximized windows become really maximized.
            for (const [w, p] of [...this._pseudo]) {
                if (p.kind !== 'max')
                    continue;
                this._pseudo.delete(w);
                this._maximizeFrom(w, p.restore);
            }
        } else if (!old.keepDecoration && cfg.keepDecoration) {
            for (const w of this._windows) {
                if (this._p.eligible(w) && this._p.maxFlags(w) === MAX_BOTH)
                    this._interceptMaximize(w);
            }
        }
        this.workAreasChanged();
    }

    // -----------------------------------------------------------------------
    // Scenic view shortcut

    toggleScenic(w) {
        if (!w || !this._windows.has(w) || !this._p.eligible(w) || !this._p.canMaximize(w))
            return;
        const p = this._pseudo.get(w);

        if (p?.kind === 'scenic') {
            if (!p.fromMax) {
                this._leave(w);
            } else if (this._cfg.keepDecoration) {
                p.kind = 'max'; // back to a gapped pseudo-maximize
                p.fromMax = false;
                this._refit(w);
            } else {
                this._pseudo.delete(w); // back to a real maximize
                this._maximizeFrom(w, p.restore);
            }
            return;
        }
        if (p) {
            p.kind = 'scenic';
            p.fromMax = true;
            this._refit(w);
            return;
        }
        if (this._p.maxFlags(w) === MAX_BOTH) {
            const restore = this._lastNormal.get(w) ?? G.defaultRestore(this._p.workArea(w));
            this._enter(w, 'scenic', restore, true);
        } else {
            // Floating, or tiled/partially maximized: restored as a floating
            // window at the same geometry (GNOME has no API to re-tile).
            this._enter(w, 'scenic', G.rectOf(this._p.frameRect(w)), false);
        }
    }

    // -----------------------------------------------------------------------
    // Internals

    _own(w, fn) {
        this._busy.add(w);
        try {
            fn();
        } finally {
            this._busy.delete(w);
        }
    }

    _target(w, p) {
        return p.kind === 'scenic'
            ? G.scenicRect(this._p.baseArea(w), this._cfg)
            : G.rectOf(this._p.workArea(w));
    }

    _fit(w) {
        const p = this._pseudo.get(w);
        if (!p || this._busy.has(w) || this._grabbed.has(w))
            return;
        const t = this._target(w, p);
        const g = this._p.frameRect(w);
        if (G.sameRect(g, t) || G.roundedFrom(g, t) || this._rate.limited(w))
            return;
        this._own(w, () => this._p.moveResize(w, t));
    }

    _refit(w) {
        const p = this._pseudo.get(w);
        if (!p)
            return;
        p.settleUntil = this._p.now() + SETTLE_MS;
        this._fit(w);
    }

    _enter(w, kind, restore, fromMax) {
        const p = {kind, restore: G.rectOf(restore), fromMax, settleUntil: 0};
        this._pseudo.set(w, p);
        if (this._p.maxFlags(w) !== 0)
            this._own(w, () => this._p.unmaximize(w));
        this._refit(w);
    }

    _leave(w) {
        const p = this._pseudo.get(w);
        this._pseudo.delete(w);
        if (p)
            this._own(w, () => this._p.moveResize(w, p.restore));
    }

    // Really maximize w so that un-maximizing it later restores `restore`.
    // Mutter saves the current geometry when maximizing, and on Wayland the
    // geometry changes only once the client acknowledged it. So move the
    // window first and maximize once it got there (or after a timeout, for
    // clients that don't take the size).
    _maximizeFrom(w, restore) {
        const r = G.rectOf(restore);
        const g = this._p.frameRect(w);
        if (G.sameRect(g, r) || G.roundedFrom(g, r)) {
            this._own(w, () => this._p.maximize(w));
            return;
        }
        this._maximizeAt.set(w, r);
        this._own(w, () => this._p.moveResize(w, r));
        this._p.timeout(SETTLE_MS, () => {
            if (this._maximizeAt.get(w) === r && this._windows.has(w))
                this._maximizeNow(w);
        });
    }

    _maximizeNow(w) {
        this._maximizeAt.delete(w);
        this._own(w, () => this._p.maximize(w));
    }

    // The window was just maximized (or already was). Take the maximize back
    // and pseudo-maximize it. If it was pseudo-maximized already, treat the
    // maximize as un-maximize (its maximize button showed "not maximized");
    // if it was in scenic view, pseudo-maximize it instead.
    _interceptMaximize(w) {
        if (this._pending.has(w))
            return;
        this._pending.add(w);
        const p = this._pseudo.get(w);
        const dropped = p !== undefined && this._grabbed.has(w); // dragged to the top edge
        const restore = p ? p.restore : this._lastNormal.get(w);
        this._p.later(() => {
            this._pending.delete(w);
            if (!this._windows.has(w) || !this._cfg.keepDecoration ||
                this._p.maxFlags(w) !== MAX_BOTH)
                return;
            if (p && !dropped && this._pseudo.get(w) === p) {
                this._own(w, () => this._p.unmaximize(w));
                if (p.kind === 'scenic') {
                    // Scenic view isn't maximized (the button says so too):
                    // maximize, keeping the original restore geometry.
                    p.kind = 'max';
                    p.fromMax = false;
                    this._refit(w);
                } else {
                    this._leave(w);
                }
            } else {
                this._enter(w, 'max', restore ?? G.defaultRestore(this._p.workArea(w)), false);
            }
        });
    }
}
