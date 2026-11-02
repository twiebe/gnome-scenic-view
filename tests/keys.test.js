// SPDX-License-Identifier: MIT
import test from 'node:test';
import assert from 'node:assert/strict';

import {hasReliableModifier, usableShortcuts} from '../extension/keys.js';

test('shortcuts need a modifier every keyboard has', () => {
    assert.ok(hasReliableModifier('<Super><Alt>Return'));
    assert.ok(hasReliableModifier('<Shift><Control><Alt><Super>Return'));
    assert.ok(hasReliableModifier('<Primary>space'));
    assert.ok(hasReliableModifier('<Hyper><Super>Return'));
    assert.ok(!hasReliableModifier('<Hyper>Return'));
    assert.ok(!hasReliableModifier('<Meta>Return'));
    assert.ok(!hasReliableModifier('Return'));
    assert.ok(!hasReliableModifier(null));
});

test('usableShortcuts', () => {
    assert.ok(usableShortcuts(['<Super><Alt>Return']));
    assert.ok(!usableShortcuts([]));
    assert.ok(!usableShortcuts(['<Super>v', '<Hyper>Return']));
});
