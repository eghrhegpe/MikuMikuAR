// @ts-nocheck — vi.hoisted mock 类导出（camera 拆分测试用）
// vi.mock 调用在各测试文件内（避免 vi.importActual 依赖解析不落回测试文件上下文）。
import { vi } from 'vitest';

export const MockCamera = vi.hoisted(() => {
    return class {
        fov = 0.8;
        position = { x: 0, y: 0, z: 0 };
        name = '';
        constructor(..._args: any[]) {}
        getClassName() {
            return 'Camera';
        }
        attachControl() {}
        detachControl() {}
        dispose() {}
    } as any;
});

export const MockArcRotateCamera = vi.hoisted(() => {
    return class {
        alpha = 0;
        beta = 0;
        radius = 0;
        lowerRadiusLimit = 0;
        upperRadiusLimit = 0;
        panningSensibility = 50;
        inertia = 0;
        angularSensibilityX = 0;
        angularSensibilityY = 0;
        pinchPrecision = 0;
        _panningMouseButton = 0;
        fov = 0.8;
        position = { x: 0, y: 0, z: 0 };
        target = { x: 0, y: 8, z: 0 };
        _scene: any;
        _cameraRotation = { x: 0, y: 0 };
        inputs = { addGamepad: () => {} };
        name = '';
        constructor(..._args: any[]) {}
        getClassName() {
            return 'ArcRotateCamera';
        }
        attachControl() {}
        detachControl() {}
        setTarget(_t: any) {
            this.target.x = _t.x;
            this.target.y = _t.y;
            this.target.z = _t.z;
        }
        dispose() {}
    } as any;
});

export const MockUniversalCamera = vi.hoisted(() => {
    return class {
        speed = 0.5;
        angularSensibility = 2000;
        fov = 0.8;
        name = '';
        position = { x: 0, y: 0, z: 0 };
        keysUp: number[] = [];
        keysDown: number[] = [];
        keysLeft: number[] = [];
        keysRight: number[] = [];
        constructor(..._args: any[]) {}
        getClassName() {
            return 'UniversalCamera';
        }
        attachControl() {}
        detachControl() {}
        setTarget() {}
        getDirection(_dir: any) {
            return { x: 0, y: 0, z: 1, scaleInPlace: () => {}, addInPlace: () => {} };
        }
        dispose() {}
    } as any;
});

export const MockVector3 = vi.hoisted(() => {
    const V3 = class {
        x = 0;
        y = 0;
        z = 0;
        constructor(x = 0, y = 0, z = 0) {
            this.x = x;
            this.y = y;
            this.z = z;
        }
        clone() {
            return new V3(this.x, this.y, this.z);
        }
        add(v: any) {
            return new V3(this.x + v.x, this.y + v.y, this.z + v.z);
        }
        scale(s: number) {
            return new V3(this.x * s, this.y * s, this.z * s);
        }
        length() {
            return Math.sqrt(this.x * this.x + this.y * this.y + this.z * this.z);
        }
        normalize() {
            return this;
        }
        set(x: number, y: number, z: number) {
            this.x = x;
            this.y = y;
            this.z = z;
            return this;
        }
        setAll(v: number) {
            this.x = this.y = this.z = v;
            return this;
        }
        static Zero() {
            return new V3(0, 0, 0);
        }
        static Right() {
            return new V3(1, 0, 0);
        }
        static Up() {
            return new V3(0, 1, 0);
        }
        static Forward() {
            return new V3(0, 0, 1);
        }
        static One() {
            return new V3(1, 1, 1);
        }
    };
    return V3 as any;
});

export const MockQuaternion = vi.hoisted(() => {
    return class {
        x = 0;
        y = 0;
        z = 0;
        w = 1;
        constructor(x = 0, y = 0, z = 0, w = 1) {
            this.x = x;
            this.y = y;
            this.z = z;
            this.w = w;
        }
        clone() {
            return new (this.constructor as any)(this.x, this.y, this.z, this.w);
        }
        static Identity() {
            return new this(0, 0, 0, 1);
        }
        static RotationYawPitchRoll() {
            return new this(0, 0, 0, 1);
        }
    } as any;
});

export const MockMatrix = vi.hoisted(() => {
    return class {
        m = new Float32Array(16);
        constructor() {
            this.m.fill(0);
        }
        getClassName() {
            return 'Matrix';
        }
        invertToRef() {}
        multiplyToRef() {}
        getRotationMatrixToRef() {}
        decompose() {
            return {
                translation: { x: 0, y: 0, z: 0 },
                rotation: { x: 0, y: 0, z: 0 },
                scaling: { x: 1, y: 1, z: 1 },
            };
        }
        static Identity() {
            return new this();
        }
        static IdentityToRef() {}
        static RotationYToRef() {}
    } as any;
});

export const MockMmdCamera = vi.hoisted(() => {
    return class {
        name: string;
        constructor(name: string, ..._args: any[]) {
            this.name = name;
        }
        createRuntimeAnimation() {
            return 0;
        }
        setRuntimeAnimation() {}
        animate(_frameTime: number) {}
        dispose() {}
        getClassName() {
            return 'MmdCamera';
        }
    } as any;
});

export const MockColor4 = vi.hoisted(() => {
    return class {
        r = 0;
        g = 0;
        b = 0;
        a = 1;
        constructor(r = 0, g = 0, b = 0, a = 1) {
            this.r = r;
            this.g = g;
            this.b = b;
            this.a = a;
        }
        set(r: number, g: number, b: number, a = this.a) {
            this.r = r;
            this.g = g;
            this.b = b;
            this.a = a;
            return this;
        }
        clone() {
            return new (this.constructor as any)(this.r, this.g, this.b, this.a);
        }
        toArray() {
            return [this.r, this.g, this.b, this.a];
        }
    } as any;
});

export const MockScene = vi.hoisted(() => {
    return class {
        _uniqueIdCounter = 0;
        clearColor = { r: 0, g: 0, b: 0, a: 1 };
        _engine: any = null;
        lights: any[] = [];
        meshes: any[] = [];
        materials: any[] = [];
        activeCamera: any = null;
        onBeforeRenderObservable = { add: () => ({}), remove: () => {} };
        onDisposeObservable = {
            add: () => ({}),
            remove: () => {},
            notifyObservers: () => {},
            hasObservers: false,
        };
        constructor(engine?: any) {
            this._engine = engine ?? null;
        }
        getEngine() {
            return this._engine;
        }
        getScene() {
            return this;
        }
        getClassName() {
            return 'Scene';
        }
        getUniqueId() {
            return this._uniqueIdCounter++;
        }
        registerBeforeRender() {}
        unregisterBeforeRender() {}
        executeWhenReady() {}
        addCamera() {}
        removeCamera() {}
        attachControl() {}
        detachControl() {}
        getTransformMatrix() {
            return {};
        }
        updateTransformMatrix() {}
        getProjectionMatrix() {
            return { clone: () => ({}) };
        }
        markAllMaterialsAsDirty() {}
    } as any;
});
