Minimal stand-ins for the GNOME Shell modules the extension imports, so that
`tests/shell-smoke.test.js` can run `enable()` / `disable()` under Node. They
mirror the GNOME 50 behavior that matters for catching integration mistakes,
e.g. `addChrome()` rejecting unknown parameters like `Params.parse()` does.
They are not GNOME Shell.
