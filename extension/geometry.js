// SPDX-License-Identifier: MIT
//
// Pure geometry helpers. No GNOME imports, so the tests run under Node.
// All rects are {x, y, width, height} in logical pixels.

export const near = (a, b) => Math.abs(a - b) < 1;

export function rectOf(r) {
    return {x: r.x, y: r.y, width: r.width, height: r.height};
}

export function sameRect(a, b) {
    return near(a.x, b.x) && near(a.y, b.y) && near(a.width, b.width) && near(a.height, b.height);
}

// g is what a client with size increments (terminals) makes of the requested
// rect r: same position, size rounded down by less than one increment.
export function roundedFrom(g, r) {
    const maxStep = 48;
    return near(g.x, r.x) && near(g.y, r.y) &&
        g.width <= r.width + 0.5 && g.width > r.width - maxStep &&
        g.height <= r.height + 0.5 && g.height > r.height - maxStep;
}

// Shrink area by h on the left and right and v on the top and bottom. Never
// below half the area, whatever the configured margins.
export function inset(area, h, v) {
    h = Math.max(0, Math.min(h, Math.floor(area.width / 4)));
    v = Math.max(0, Math.min(v, Math.floor(area.height / 4)));
    return {x: area.x + h, y: area.y + v, width: area.width - 2 * h, height: area.height - 2 * v};
}

// Scenic view: the area without our edge gaps (panels excluded), shrunk by the
// scenic margins.
export function scenicRect(baseArea, cfg) {
    return inset(baseArea, cfg.scenicH, cfg.scenicV);
}

// Restore geometry for windows that were already maximized when we first saw
// them (we don't know their previous geometry).
export function defaultRestore(area) {
    const width = Math.round(area.width * 0.6);
    const height = Math.round(area.height * 0.7);
    return {
        x: area.x + Math.round((area.width - width) / 2),
        y: area.y + Math.round((area.height - height) / 2),
        width,
        height,
    };
}

function intersect(a, b) {
    const x1 = Math.max(a.x, b.x);
    const y1 = Math.max(a.y, b.y);
    const x2 = Math.min(a.x + a.width, b.x + b.width);
    const y2 = Math.min(a.y + a.height, b.y + b.height);
    return x2 > x1 && y2 > y1 ? {x: x1, y: y1, width: x2 - x1, height: y2 - y1} : null;
}

// Which side of the monitor a strut rect is attached to. Same rules as
// GNOME Shell's LayoutManager._updateRegions(): a rect spanning the full width
// is top/bottom, one spanning the full height is left/right, otherwise the
// first edge it touches. null if it touches no edge.
export function strutSide(rect, monitor) {
    const x1 = rect.x, y1 = rect.y;
    const x2 = rect.x + rect.width, y2 = rect.y + rect.height;
    const mx2 = monitor.x + monitor.width, my2 = monitor.y + monitor.height;
    if (x1 <= monitor.x && x2 >= mx2) {
        if (y1 <= monitor.y)
            return 'top';
        if (y2 >= my2)
            return 'bottom';
        return null;
    }
    if (y1 <= monitor.y && y2 >= my2) {
        if (x1 <= monitor.x)
            return 'left';
        if (x2 >= mx2)
            return 'right';
        return null;
    }
    if (x1 <= monitor.x)
        return 'left';
    if (y1 <= monitor.y)
        return 'top';
    if (x2 >= mx2)
        return 'right';
    if (y2 >= my2)
        return 'bottom';
    return null;
}

// How far the struts of other chrome (top bar, docks) reach into the monitor
// on each side. Mutter's work area is one rectangle per monitor, so the
// deepest strut on a side wins.
export function baseInsets(monitor, strutRects) {
    const ins = {top: 0, bottom: 0, left: 0, right: 0};
    for (const r of strutRects) {
        const c = intersect(r, monitor);
        if (!c)
            continue;
        const side = strutSide(c, monitor);
        if (side === 'top')
            ins.top = Math.max(ins.top, c.y + c.height - monitor.y);
        else if (side === 'bottom')
            ins.bottom = Math.max(ins.bottom, monitor.y + monitor.height - c.y);
        else if (side === 'left')
            ins.left = Math.max(ins.left, c.x + c.width - monitor.x);
        else if (side === 'right')
            ins.right = Math.max(ins.right, monitor.x + monitor.width - c.x);
    }
    return ins;
}

export function areaFromInsets(monitor, ins) {
    return {
        x: monitor.x + ins.left,
        y: monitor.y + ins.top,
        width: monitor.width - ins.left - ins.right,
        height: monitor.height - ins.top - ins.bottom,
    };
}

// Our own strut rects: each reaches from the monitor edge past the other
// chrome on that side, plus the gap. Mutter then shrinks the work area so
// maximized and tiled windows keep the gap, measured to panels. null for a
// side with gap 0.
export function gapStrutRects(monitor, base, gapH, gapV) {
    const m = monitor;
    const rect = (x, y, width, height) => ({x, y, width, height});
    return {
        top: gapV > 0 ? rect(m.x, m.y, m.width, base.top + gapV) : null,
        bottom: gapV > 0 ? rect(m.x, m.y + m.height - base.bottom - gapV, m.width, base.bottom + gapV) : null,
        left: gapH > 0 ? rect(m.x, m.y, base.left + gapH, m.height) : null,
        right: gapH > 0 ? rect(m.x + m.width - base.right - gapH, m.y, base.right + gapH, m.height) : null,
    };
}

// Safety net against clients that refuse a size: at most `max` geometry
// changes per window within `windowMs`.
export class RateLimiter {
    constructor(max, windowMs, now) {
        this._max = max;
        this._windowMs = windowMs;
        this._now = now;
        this._recent = new Map();
    }

    limited(key) {
        const now = this._now();
        const list = (this._recent.get(key) ?? []).filter(t => now - t < this._windowMs);
        this._recent.set(key, list);
        if (list.length >= this._max)
            return true;
        list.push(now);
        return false;
    }

    forget(key) {
        this._recent.delete(key);
    }
}
