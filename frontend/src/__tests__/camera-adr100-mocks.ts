// @ts-nocheck — mock 类运行时替换（camera.adr100 拆分测试用）
// [doc:adr-204] camera-adr100-mocks.ts — 共享 vi.mock 工厂（拆自 camera.adr100.test.ts）
// 原文件用 vi.hoisted 定义 Mock 类；因 SUT 经 beforeAll 动态 vi.importActual 加载，
// vi.mock 工厂延迟到彼时才执行，故这里改为普通导出类 + 同步工厂（imported 绑定，无 TDZ）。
// Mock 类为 camera SUT 定制（setTarget 拷贝、_panningMouseButton 等），不复用 mocks/babylon-classes。
import { vi } from 'vitest';
import { sceneMockSuperset } from './mocks/scene-superset';

export const MockCamera = class {
    fov = 0.8;
    position = { x: 0, y: 0, z: 0 };
    name = '';
    constructor(..._a: any[]) {}
    getClassName() {
        return 'Camera';
    }
    attachControl() {}
    detachControl() {}
    dispose() {}
} as any;

export const MockArcRotateCamera = class {
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
    constructor(..._a: any[]) {}
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

export const MockUniversalCamera = class {
    speed = 0.5;
    angularSensibility = 2000;
    fov = 0.8;
    name = '';
    position = { x: 0, y: 0, z: 0 };
    keysUp: number[] = [];
    keysDown: number[] = [];
    keysLeft: number[] = [];
    keysRight: number[] = [];
    constructor(..._a: any[]) {}
    getClassName() {
        return 'UniversalCamera';
    }
    attachControl() {}
    detachControl() {}
    setTarget() {}
    getDirection(_d: any) {
        return { x: 0, y: 0, z: 1, scaleInPlace: () => {}, addInPlace: () => {} };
    }
    dispose() {}
} as any;

const V = class {
    x = 0;
    y = 0;
    z = 0;
    constructor(x = 0, y = 0, z = 0) {
        this.x = x;
        this.y = y;
        this.z = z;
    }
    clone() {
        return new V(this.x, this.y, this.z);
    }
    add(v: any) {
        return new V(this.x + v.x, this.y + v.y, this.z + v.z);
    }
    scale(s: number) {
        return new V(this.x * s, this.y * s, this.z * s);
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
        return new V(0, 0, 0);
    }
    static Right() {
        return new V(1, 0, 0);
    }
    static Up() {
        return new V(0, 1, 0);
    }
    static Forward() {
        return new V(0, 0, 1);
    }
    static One() {
        return new V(1, 1, 1);
    }
};
export const MockV3 = V as any;

export const MockQuat = class {
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

export const MockMtx = class {
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

export const MockMmdCam = class {
    name = '';
    constructor(name: string, ..._a: any[]) {
        this.name = name;
    }
    createRuntimeAnimation() {
        return 0;
    }
    setRuntimeAnimation() {}
    animate(_f: number) {}
    dispose() {}
    getClassName() {
        return 'MmdCamera';
    }
} as any;

export const MockC4 = class {
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

export const MockScene = class {
    _uc = 0;
    cc = { r: 0, g: 0, b: 0, a: 1 };
    _e: any = null;
    l: any[] = [];
    m: any[] = [];
    mats: any[] = [];
    ac: any = null;
    obr = { add: () => ({}), remove: () => {} };
    odd = { add: () => ({}), remove: () => {}, notifyObservers: () => {}, hasObservers: false };
    constructor(e?: any) {
        this._e = e ?? null;
    }
    getEngine() {
        return this._e;
    }
    getScene() {
        return this;
    }
    getClassName() {
        return 'Scene';
    }
    getUniqueId() {
        return this._uc++;
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

// ---- 跨用例共享状态（每测试文件独立模块图，天然隔离） ----
export const mockUiState: Record<string, unknown> = {};
export const mockPBD = vi.fn<() => any>(() => null);

// ---- 模块工厂 ----
export const mockConfigModule = () => ({
    focusedModelId: null,
    modelRegistry: new Map(),
    uiState: mockUiState,
    triggerAutoSave: vi.fn(),
    setStatus: vi.fn(),
});

export const mockSceneModule = () => ({
    ...sceneMockSuperset(),
    focusModel: vi.fn(),
    reattachPipeline: vi.fn(),
    setARMode: vi.fn(),
    getProcBeatDetector: mockPBD,
});

export const mockEnvPersist = () => ({ schedulePersistUI: vi.fn() });

export const mockCameraModule = () => ({
    initCameraSystem: vi.fn(),
    autoFrame: vi.fn(),
    getCameraMode: vi.fn(() => 'orbit'),
    getCurrentCamera: vi.fn(() => null),
    getFov: vi.fn(() => 0.8),
    setFov: vi.fn(),
    getOrbitParams: vi.fn(),
    getFreeflyParams: vi.fn(),
    getConcertParams: vi.fn(),
    getSurroundParams: vi.fn(),
    setOrbitParams: vi.fn(),
    setFreeflyParams: vi.fn(),
    setConcertParams: vi.fn(),
    setSurroundParams: vi.fn(),
    hasCameraVmd: vi.fn(() => false),
});

// ---- 共享 SUT 装配接线（guards/serialization/presets/vmd-state 4 文件原重复） ----
// 封装 beforeAll(vi.importActual + setSyncAxesCallback) 与 beforeEach(复位 preset/fov)。
// 关键：cam 是 beforeAll 异步赋值，不能通过返回值传递（返回的是求值期快照 undefined）。
// 改为 setCam 回调把真实 cam 写回测试文件的 `let cam` 绑定（live 引用，用例可见）。
// vi.mock 注册块受 Vitest hoist 限制保留在各测试文件。
// 用法：测试文件顶层 `let cam: any; installCameraSUT((c) => { cam = c; });`
export function installCameraSUT(setCam: (cam: any) => void): void {
    const holder: { cam: any } = { cam: null };
    beforeAll(async () => {
        const m = await vi.importActual('../scene/camera/camera');
        holder.cam = m as any;
        setCam(m as any);
        (m as any).setSyncAxesCallback(() =>
            (m as any)._syncAxesFromMode((m as any).getCameraMode())
        );
    });
    beforeEach(() => {
        holder.cam.setCameraPreset(holder.cam.defaultCameraPreset());
        holder.cam.setFov(0.8);
    });
}
