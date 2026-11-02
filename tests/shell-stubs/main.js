import {addSignalMethods} from './signals.js';

// GNOME 50 js/ui/layout.js: defaultParams and Params.parse() without extras.
const defaultParams = {trackFullscreen: false, affectsStruts: false};
function parse(params = {}, defaults) {
    for (const prop in params) {
        if (!(prop in defaults))
            throw new Error(`Unrecognized parameter "${prop}"`);
    }
    return {...defaults, ...params};
}

const panelBox = {x: 0, y: 0, width: 1920, height: 32, visible: true,
    get_transformed_position() { return [this.x, this.y]; },
    get_transformed_size() { return [this.width, this.height]; }};

export const layoutManager = addSignalMethods({
    monitors: [{x: 0, y: 0, width: 1920, height: 1080}],
    panelBox,
    _trackedActors: [{actor: panelBox, affectsStruts: true, trackFullscreen: true}],
    addChrome(actor, params) {
        if (this._trackedActors.some(d => d.actor === actor))
            throw new Error('trying to re-track existing chrome actor');
        const data = parse(params, defaultParams);
        data.actor = actor;
        this._trackedActors.push(data);
    },
    removeChrome(actor) {
        const i = this._trackedActors.findIndex(d => d.actor === actor);
        if (i < 0)
            throw new Error('removeChrome: not tracked');
        this._trackedActors.splice(i, 1);
    },
}, ['monitors-changed']);

export const wm = {
    keybindings: new Map(),
    addKeybinding(name, settings, flags, modes, handler) {
        if (this.keybindings.has(name))
            throw new Error(`keybinding ${name} exists`);
        if (!settings.get_strv(name))
            throw new Error(`no key ${name}`);
        this.keybindings.set(name, handler);
    },
    removeKeybinding(name) {
        this.keybindings.delete(name);
    },
};
