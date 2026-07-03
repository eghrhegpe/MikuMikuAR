// Minimal Engine mock — replaces @babylonjs/core/Engines/engine
// to avoid esbuild parsing the real source (which has _renderLoops
// class fields that CI esbuild cannot handle).

export class Engine {
    _renderLoops: Array<() => void> = [];
    _features: Record<string, boolean> = {};

    runRenderLoop(cb?: () => void) {
        if (cb) this._renderLoops.push(cb);
    }
    stopRenderLoop() {
        this._renderLoops = [];
    }
    getRenderWidth() { return 800; }
    getRenderHeight() { return 600; }
    resize() {}
    clear() {}
    getClassName() { return 'Engine'; }
    setHardwareScalingLevel() {}
    getHardwareScalingLevel() { return 1; }
    createRenderPassId() { return 0; }
    releaseRenderPassId() {}
}
