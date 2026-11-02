// SPDX-License-Identifier: MIT
//
// Shortcut sanity check, no GNOME imports. Hyper and Meta are often not mapped
// to any key; Mutter then resolves e.g. <Hyper>Return to a plain Return and
// grabs it system-wide. So a shortcut needs at least one modifier that every
// keyboard has.

const RELIABLE = new Set(['control', 'ctrl', 'primary', 'alt', 'mod1', 'shift', 'super']);

export function hasReliableModifier(accel) {
    if (typeof accel !== 'string')
        return false;
    const mods = [...accel.matchAll(/<([^>]+)>/g)].map(m => m[1].toLowerCase());
    return mods.some(m => RELIABLE.has(m));
}

export function usableShortcuts(accels) {
    return Array.isArray(accels) && accels.length > 0 && accels.every(hasReliableModifier);
}
