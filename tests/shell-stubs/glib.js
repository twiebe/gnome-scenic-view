let nextId = 1;
export const sources = new Map();
const GLib = {
    PRIORITY_DEFAULT: 0,
    PRIORITY_DEFAULT_IDLE: 200,
    SOURCE_REMOVE: false,
    idle_add(prio, fn) { const id = nextId++; sources.set(id, fn); return id; },
    timeout_add(prio, ms, fn) { const id = nextId++; sources.set(id, fn); return id; },
    source_remove(id) {
        if (!sources.delete(id))
            throw new Error(`source_remove: no source ${id}`);
    },
    get_monotonic_time: () => Math.round(performance.now() * 1000),
};
export function runSources() {
    for (let i = 0; sources.size && i < 100; i++) {
        const [id, fn] = sources.entries().next().value;
        sources.delete(id);
        fn();
    }
}
export default GLib;
