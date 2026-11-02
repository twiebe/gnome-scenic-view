import {addSignalMethods} from './signals.js';

export const settingsValues = {
    'outer-gap-horizontal': 32,
    'outer-gap-vertical': 32,
    'scenic-gap-horizontal': 80,
    'scenic-gap-vertical': 80,
    'keep-decoration-when-maximized': true,
    'toggle-scenic-view': ['<Shift><Control><Alt><Super>Return'],
};

function checked(key, type) {
    if (!(key in settingsValues))
        throw new Error(`settings: no key ${key}`);
    const v = settingsValues[key];
    if (typeof v !== type && !(type === 'object' && Array.isArray(v)))
        throw new Error(`settings: ${key} is not ${type}`);
    return v;
}

export class Extension {
    constructor(metadata = {}) {
        this.metadata = metadata;
    }

    getSettings() {
        const s = addSignalMethods({
            get_int: k => checked(k, 'number'),
            get_boolean: k => checked(k, 'boolean'),
            get_strv: k => checked(k, 'object'),
        }, ['changed']);
        Extension.lastSettings = s;
        return s;
    }
}
