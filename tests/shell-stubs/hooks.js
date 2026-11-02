// Maps the GNOME Shell imports of the extension to the stubs.
import {registerHooks} from 'node:module';

const stubs = {
    'gi://GLib': 'glib.js',
    'gi://Meta': 'meta.js',
    'gi://Shell': 'shell.js',
    'gi://St': 'st.js',
    'resource:///org/gnome/shell/ui/main.js': 'main.js',
    'resource:///org/gnome/shell/extensions/extension.js': 'extension.js',
};

registerHooks({
    resolve(specifier, context, nextResolve) {
        if (specifier in stubs)
            return {url: new URL(stubs[specifier], import.meta.url).href, shortCircuit: true};
        if (specifier.startsWith('gi://') || specifier.startsWith('resource://'))
            throw new Error(`no stub for ${specifier}`);
        return nextResolve(specifier, context);
    },
});
