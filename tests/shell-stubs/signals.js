// connectObject()/disconnectObject() as GNOME Shell adds them to GObjects.
export function addSignalMethods(obj, signals = null) {
    obj._handlers = [];
    obj.connectObject = (...args) => {
        const owner = args.pop();
        for (let i = 0; i < args.length; i += 2) {
            if (signals && !signals.includes(args[i].replace(/::.*/, '')))
                throw new Error(`unknown signal ${args[i]}`);
            obj._handlers.push({name: args[i], fn: args[i + 1], owner});
        }
    };
    obj.disconnectObject = owner => {
        obj._handlers = obj._handlers.filter(h => h.owner !== owner);
    };
    obj.emit = (name, ...args) => {
        for (const h of [...obj._handlers]) {
            if (h.name === name)
                h.fn(obj, ...args);
        }
    };
    return obj;
}
