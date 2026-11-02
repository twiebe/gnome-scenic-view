// SPDX-License-Identifier: MIT
import test from 'node:test';
import assert from 'node:assert/strict';

import * as G from '../extension/geometry.js';

const monitor = {x: 0, y: 0, width: 1920, height: 1080};
const topBar = {x: 0, y: 0, width: 1920, height: 32};

test('inset caps margins at a quarter of the area', () => {
    assert.deepEqual(G.inset(monitor, 80, 80), {x: 80, y: 80, width: 1760, height: 920});
    assert.deepEqual(G.inset({x: 0, y: 0, width: 400, height: 400}, 300, 300),
        {x: 100, y: 100, width: 200, height: 200});
    assert.deepEqual(G.inset(monitor, -5, 0), monitor);
});

test('strutSide follows the LayoutManager rules', () => {
    assert.equal(G.strutSide(topBar, monitor), 'top');
    assert.equal(G.strutSide({x: 0, y: 1000, width: 1920, height: 80}, monitor), 'bottom');
    assert.equal(G.strutSide({x: 0, y: 0, width: 60, height: 1080}, monitor), 'left');
    assert.equal(G.strutSide({x: 1860, y: 0, width: 60, height: 1080}, monitor), 'right');
    // A dock in the middle of the bottom edge
    assert.equal(G.strutSide({x: 600, y: 1000, width: 700, height: 80}, monitor), 'bottom');
    assert.equal(G.strutSide({x: 600, y: 400, width: 100, height: 100}, monitor), null);
});

test('baseInsets takes the deepest strut per side and ignores other monitors', () => {
    const second = {x: 1920, y: 0, width: 1920, height: 1080};
    const ins = G.baseInsets(monitor, [
        topBar,
        {x: 0, y: 0, width: 1920, height: 20},
        {x: 600, y: 1000, width: 700, height: 80},
        {x: 1920, y: 0, width: 1920, height: 50}, // top bar of the second monitor
    ]);
    assert.deepEqual(ins, {top: 32, bottom: 80, left: 0, right: 0});
    assert.deepEqual(G.baseInsets(second, [topBar]), {top: 0, bottom: 0, left: 0, right: 0});
});

test('gap struts reach past the panels by the gap', () => {
    const base = {top: 32, bottom: 0, left: 0, right: 0};
    const r = G.gapStrutRects(monitor, base, 24, 16);
    assert.deepEqual(r.top, {x: 0, y: 0, width: 1920, height: 48});
    assert.deepEqual(r.bottom, {x: 0, y: 1064, width: 1920, height: 16});
    assert.deepEqual(r.left, {x: 0, y: 0, width: 24, height: 1080});
    assert.deepEqual(r.right, {x: 1896, y: 0, width: 24, height: 1080});
    // Our struts are attached to the side they are meant for.
    for (const side of ['top', 'bottom', 'left', 'right'])
        assert.equal(G.strutSide(r[side], monitor), side);
    // The resulting work area is the base area minus the gaps.
    const workArea = G.areaFromInsets(monitor, G.baseInsets(monitor, [topBar, ...Object.values(r)]));
    assert.deepEqual(workArea, {x: 24, y: 48, width: 1872, height: 1016});
});

test('gap 0 means no strut on that axis', () => {
    const r = G.gapStrutRects(monitor, {top: 32, bottom: 0, left: 0, right: 0}, 0, 10);
    assert.equal(r.left, null);
    assert.equal(r.right, null);
    assert.ok(r.top && r.bottom);
});

test('scenicRect measures from the base area', () => {
    const base = {x: 0, y: 32, width: 1920, height: 1048};
    assert.deepEqual(G.scenicRect(base, {scenicH: 80, scenicV: 80}),
        {x: 80, y: 112, width: 1760, height: 888});
});

test('roundedFrom accepts sizes rounded down by a size increment', () => {
    const r = {x: 10, y: 10, width: 1000, height: 800};
    assert.ok(G.roundedFrom({x: 10, y: 10, width: 993, height: 790}, r));
    assert.ok(!G.roundedFrom({x: 10, y: 10, width: 1001, height: 800}, r));
    assert.ok(!G.roundedFrom({x: 12, y: 10, width: 1000, height: 800}, r));
});

test('RateLimiter', () => {
    let now = 0;
    const rl = new G.RateLimiter(2, 1000, () => now);
    assert.ok(!rl.limited('a'));
    assert.ok(!rl.limited('a'));
    assert.ok(rl.limited('a'));
    assert.ok(!rl.limited('b'));
    now = 1500;
    assert.ok(!rl.limited('a'));
});
