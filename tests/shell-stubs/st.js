class Widget {
    constructor(props = {}) {
        this.x = 0;
        this.y = 0;
        this.width = 0;
        this.height = 0;
        this.visible = true;
        Object.assign(this, props);
        this.destroyed = false;
    }
    set_position(x, y) { this.x = x; this.y = y; }
    set_size(w, h) { this.width = w; this.height = h; }
    get_transformed_position() { return [this.x, this.y]; }
    get_transformed_size() { return [this.width, this.height]; }
    hide() { this.visible = false; }
    show() { this.visible = true; }
    destroy() { this.destroyed = true; }
}
export default {Widget};
