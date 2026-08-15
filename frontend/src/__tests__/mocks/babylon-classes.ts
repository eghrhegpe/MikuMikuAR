// [doc:mock-strategy] 统一 Babylon.js mock 类集合
// 所有测试文件共享同一套 mock 实现，避免重复定义和行为不一致
// 使用方式：在 vi.mock factory 中通过 require 引用此文件的导出

// ===== Engine =====
export class MockEngine {
    _features = { trackUbosInFrame: false, doNotHandleContextLost: true };
    _renderLoops: Array<() => void> = [];
    _renderPassIdCounter = 0;
    _renderPassIds: number[] = [];
    runRenderLoop(cb?: () => void) {
        if (cb) {
            this._renderLoops.push(cb);
        }
    }
    stopRenderLoop(_renderFunction?: () => void) {
        this._renderLoops = [];
    }
    getRenderWidth(_useScreen?: boolean) {
        return 800;
    }
    getRenderHeight(_useScreen?: boolean) {
        return 600;
    }
    resize(_forceSetSize?: boolean) {}
    clear(_color: any, _backBuffer: boolean, _depth: boolean, _stencil?: boolean, _stencilClearValue?: number) {}
    getClassName() {
        // 真实 Babylon Engine.getClassName() 继承自 ThinEngine，返回 'ThinEngine'
        return 'ThinEngine';
    }
    setHardwareScalingLevel(_level: number) {}
    getHardwareScalingLevel() {
        return 1;
    }
    createRenderPassId(_name?: string) {
        const id = this._renderPassIdCounter++;
        this._renderPassIds.push(id);
        return id;
    }
    releaseRenderPassId(id: number) {
        const i = this._renderPassIds.indexOf(id);
        if (i >= 0) {
            this._renderPassIds.splice(i, 1);
        }
    }
}

// ===== Scene =====
export class MockScene {
    _uniqueIdCounter = 0;
    clearColor = { r: 0, g: 0, b: 0, a: 1 };
    _engine: any = null;
    lights: any[] = [];
    meshes: any[] = [];
    materials: any[] = [];
    actionManager = null;
    metadata: any = null;
    _transformMatrix: any = {};
    activeCamera: any = null;
    animationPropertiesOverride: any = null;
    _pickWithRayInverseMatrix: any = null;
    _viewMatrix: any = null;
    _projectionMatrix: any = null;
    _shadowsGenerator: any = {};
    autoClear = true;
    _activeMeshes = { _length: 0 };
    _activeMeshesFrozen = false;
    _activeParticleSystems: any[] = [];
    _activeSkeletons: any[] = [];
    _activeAnimatables: any[] = [];
    onBeforeRenderObservable = { add: () => ({}), remove: () => {} };
    onDisposeObservable = {
        add: () => ({}),
        remove: () => {},
        notifyObservers: () => {},
        hasObservers: false,
    };
    _blockEntityCollection = false;

    constructor(engine?: any) {
        this._engine = engine ?? null;
    }
    getEngine() {
        return this._engine;
    }
    getClassName() {
        return 'Scene';
    }
    getUniqueId() {
        return this._uniqueIdCounter++;
    }
    registerBeforeRender(_func: () => void) {}
    unregisterBeforeRender(_func: () => void) {}
    executeWhenReady(_func: () => void, _checkRenderTargets?: boolean) {}
    addCamera(_camera: any) {}
    removeCamera(_camera: any) {}
    addLight(l: any) {
        this.lights.push(l);
    }
    removeLight(l: any) {
        const i = this.lights.indexOf(l);
        if (i >= 0) {
            this.lights.splice(i, 1);
        }
    }
    sortLightsByPriority() {}
    createDefaultCameraOrLight(
        _createArcRotateCamera?: boolean,
        _replace?: boolean,
        _attachCameraControls?: boolean
    ) {}
    _notifyIdleControllers() {}
    getBoundingBoxRenderer() {
        return { isEnabled: false };
    }
    attachControl(_attachUp?: boolean, _attachDown?: boolean, _attachMove?: boolean) {}
    detachControl() {}
    getLightByName(_name: string) {
        return null;
    }
    getMeshByName(_name: string) {
        return null;
    }
    getTransformMatrix() {
        return this._transformMatrix;
    }
    updateTransformMatrix(_force?: boolean) {}
    getProjectionMatrix() {
        return { clone: () => ({}) };
    }
    markAllMaterialsAsDirty(_flag: number, _predicate?: any) {}
}

// ===== Node =====
export class MockNode {
    _scene: any;
    name = '';
    constructor(name: string, scene: any) {
        this.name = name;
        this._scene = scene;
    }
    getScene() {
        return this._scene;
    }
    getClassName() {
        return 'Node';
    }
    // Babylon 在模块求值期调用 Node.AddNodeConstructor 注册相机/网格构造器
    static AddNodeConstructor(_type: string, _factory: any) {}
}

// ===== Lights =====
export class MockLight {
    _scene: any;
    intensity = 1;
    diffuse: any = null;
    specular: any = null;
    _parentNode: any = null;
    name = '';
    constructor(name: string, scene: any) {
        this.name = name;
        this._scene = scene;
    }
    getScene() {
        return this._scene;
    }
    dispose(_doNotRecurse?: boolean, _disposeMaterialAndTextures?: boolean) {}
    getClassName() {
        return 'Light';
    }
}

export class MockHemisphericLight {
    intensity = 1;
    diffuse: any = null;
    groundColor: any = null;
    specular: any = null;
    _scene: any;
    name = '';
    constructor(name: string, _dir: any, scene: any) {
        this.name = name;
        this._scene = scene;
        if (scene?.addLight) {
            scene.addLight(this);
        }
    }
    dispose(_doNotRecurse?: boolean, _disposeMaterialAndTextures?: boolean) {
        if (this._scene?.removeLight) {
            this._scene.removeLight(this);
        }
    }
    getClassName() {
        return 'HemisphericLight';
    }
}

export class MockDirectionalLight {
    intensity = 1;
    diffuse: any = null;
    specular: any = null;
    _scene: any;
    name = '';
    constructor(name: string, _dir: any, scene: any) {
        this.name = name;
        this._scene = scene;
        if (scene?.addLight) {
            scene.addLight(this);
        }
    }
    dispose(_doNotRecurse?: boolean, _disposeMaterialAndTextures?: boolean) {
        if (this._scene?.removeLight) {
            this._scene.removeLight(this);
        }
    }
    getClassName() {
        return 'DirectionalLight';
    }
}

// ===== Cameras =====
export class MockCamera {
    _scene: any;
    fov = 0.8;
    position = { x: 0, y: 0, z: 0 };
    name = '';
    constructor(..._args: any[]) {}
    getClassName() {
        return 'Camera';
    }
    attachControl(_noPreventDefault?: boolean, _useCtrlForPanning?: boolean) {}
    detachControl(_ignored?: any) {}
    dispose(_doNotRecurse?: boolean, _disposeMaterialAndTextures?: boolean) {}
}

export class MockArcRotateCamera {
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
    _scene: any;
    _cameraRotation = { x: 0, y: 0 };
    useNaturalPinchZoom = false;
    onViewMatrixChangedObservable = { add: (_cb: any) => {} };
    inputs = {
        add: (_input: any) => {},
        removeByType: (_type: string) => {},
        addGamepad: () => {},
    };
    name = '';
    constructor(..._args: any[]) {}
    getClassName() {
        return 'ArcRotateCamera';
    }
    // 真实 ArcRotateCamera.attachControl 有多个重载（含 3 个必选参数的重载），
    // 用 rest 参数收下所有合法调用形态。
    attachControl(..._args: any[]) {}
    setTarget(_target: any, ..._args: any[]) {}
    dispose() {}
}

// ===== Math: Color3 / Color4 =====
export class MockColor3 {
    r: number;
    g: number;
    b: number;
    constructor(r = 0, g = 0, b = 0) {
        this.r = r;
        this.g = g;
        this.b = b;
    }
    getClassName() {
        return 'Color3';
    }
    set(r: number, g: number, b: number) {
        this.r = r;
        this.g = g;
        this.b = b;
        return this;
    }
    clone() {
        return new MockColor3(this.r, this.g, this.b);
    }
    toArray(_array?: any, _index?: number) {
        return [this.r, this.g, this.b];
    }
    toLinearSpace(_exact?: boolean) {
        return this;
    }
    toGammaSpace(_exact?: boolean) {
        return this;
    }
    scale(s: number) {
        return new MockColor3(this.r * s, this.g * s, this.b * s);
    }
}

export class MockColor4 {
    r: number;
    g: number;
    b: number;
    a: number;
    constructor(r = 0, g = 0, b = 0, a = 1) {
        this.r = r;
        this.g = g;
        this.b = b;
        this.a = a;
    }
    getClassName() {
        return 'Color4';
    }
    set(r: number, g: number, b: number, a = this.a) {
        this.r = r;
        this.g = g;
        this.b = b;
        this.a = a;
        return this;
    }
    clone() {
        return new MockColor4(this.r, this.g, this.b, this.a);
    }
    toArray(_array?: any, _index?: number) {
        return [this.r, this.g, this.b, this.a];
    }
    scale(s: number) {
        return new MockColor4(this.r * s, this.g * s, this.b * s, this.a * s);
    }
}

// ===== Math: Vector3 / Matrix / Quaternion =====
export class MockVector3 {
    x: number;
    y: number;
    z: number;
    constructor(x = 0, y = 0, z = 0) {
        this.x = x;
        this.y = y;
        this.z = z;
    }
    getClassName() {
        return 'Vector3';
    }
    clone() {
        return new MockVector3(this.x, this.y, this.z);
    }
    add(v: any) {
        return new MockVector3(this.x + v.x, this.y + v.y, this.z + v.z);
    }
    scale(s: number) {
        return new MockVector3(this.x * s, this.y * s, this.z * s);
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
        this.x = v;
        this.y = v;
        this.z = v;
        return this;
    }
    static Zero() {
        return new MockVector3(0, 0, 0);
    }
    static Right() {
        return new MockVector3(1, 0, 0);
    }
    static Up() {
        return new MockVector3(0, 1, 0);
    }
    static Forward() {
        return new MockVector3(0, 0, 1);
    }
    static One() {
        return new MockVector3(1, 1, 1);
    }
}

export class MockVector2 {
    x: number;
    y: number;
    constructor(x = 0, y = 0) {
        this.x = x;
        this.y = y;
    }
    getClassName() {
        return 'Vector2';
    }
    clone() {
        return new MockVector2(this.x, this.y);
    }
    add(v: any) {
        return new MockVector2(this.x + v.x, this.y + v.y);
    }
    subtract(v: any) {
        return new MockVector2(this.x - v.x, this.y - v.y);
    }
    scale(s: number) {
        return new MockVector2(this.x * s, this.y * s);
    }
    length() {
        return Math.sqrt(this.x * this.x + this.y * this.y);
    }
    normalize() {
        return this;
    }
    set(x: number, y: number) {
        this.x = x;
        this.y = y;
        return this;
    }
    setAll(v: number) {
        this.x = v;
        this.y = v;
        return this;
    }
    static Zero() {
        return new MockVector2(0, 0);
    }
    static One() {
        return new MockVector2(1, 1);
    }
}

export class MockQuaternion {
    x: number;
    y: number;
    z: number;
    w: number;
    constructor(x = 0, y = 0, z = 0, w = 1) {
        this.x = x;
        this.y = y;
        this.z = z;
        this.w = w;
    }
    getClassName() {
        return 'Quaternion';
    }
    clone() {
        return new MockQuaternion(this.x, this.y, this.z, this.w);
    }
    static Identity() {
        return new MockQuaternion(0, 0, 0, 1);
    }
    static RotationYawPitchRoll() {
        return new MockQuaternion(0, 0, 0, 1);
    }
}

export class MockMatrix {
    m = new Float32Array(16);
    constructor() {
        this.m.fill(0);
    }
    getClassName() {
        return 'Matrix';
    }
    invertToRef(_other: any) {}
    multiplyToRef(_other: any, _result: any) {}
    getRotationMatrixToRef(_result: any) {}
    decompose(
        _scale?: any,
        _rotation?: any,
        _translation?: any,
        _preserveScalingNode?: any,
        _useAbsoluteScaling?: boolean
    ) {
        return {
            translation: new MockVector3(),
            rotation: new MockVector3(),
            scaling: new MockVector3(),
        };
    }
    static Identity() {
        return new MockMatrix();
    }
    static IdentityToRef() {}
    static RotationYToRef() {}
}

// ===== Materials =====
export class MockMaterial {
    static MATERIAL_OPAQUE = 0;
    static MATERIAL_ALPHABLEND = 2;
    name = '';
    constructor(name: string) {
        this.name = name;
    }
    getClassName() {
        return 'Material';
    }
    dispose(_forceDisposeEffect?: boolean, _forceDisposeTextures?: boolean, _notBoundToMesh?: boolean) {}
    clone(_name: string) {
        return this;
    }
}

/**
 * 可工作的 StandardMaterial mock — diffuseColor.set() / specularColor.set() 会真实修改值
 * 与 scene-material.ts 的 instanceof 守卫和 _applyAll 逻辑兼容
 */
export class MockStandardMaterial {
    name = '';
    alpha = 1;
    transparencyMode = 0;
    specularPower = 50;
    wireframe = false;
    backFaceCulling = true;

    diffuseColor = this._makeColor(1, 1, 1);
    specularColor = this._makeColor(0.8, 0.8, 0.8);
    ambientColor = this._makeColor(0.3, 0.3, 0.3);
    emissiveColor = this._makeColor(0, 0, 0);

    diffuseTexture: { level: number; setLevel(l: number): void } | null = null;
    bumpTexture: { level: number; setLevel(l: number): void } | null = null;
    toonTexture: { level: number; setLevel(l: number): void } | null = null;
    sphereTexture: { level: number; setLevel(l: number): void } | null = null;
    emissiveTexture: { level: number; setLevel(l: number): void } | null = null;

    private _makeColor(r: number, g: number, b: number) {
        const obj: any = {
            r,
            g,
            b,
            set(rv: number, gv: number, bv: number) {
                obj.r = rv;
                obj.g = gv;
                obj.b = bv;
                return obj;
            },
            clone() {
                return { ...obj, r: obj.r, g: obj.g, b: obj.b };
            },
            scale(s: number) {
                return { ...obj, r: obj.r * s, g: obj.g * s, b: obj.b * s };
            },
            toArray() {
                return [obj.r, obj.g, obj.b];
            },
            toLinearSpace() {
                return obj;
            },
            toGammaSpace() {
                return obj;
            },
        };
        return obj;
    }

    private _makeTexture(level: number = 1) {
        let _level = level;
        return {
            get level() {
                return _level;
            },
            setLevel(l: number) {
                _level = l;
            },
        };
    }

    constructor(name: string) {
        this.name = name;
    }
    getClassName() {
        return 'StandardMaterial';
    }
    getScene() {
        // Material 未挂载到 scene（独立 mock 材质），与 detachSharedTextures 的
        // `if (!scene) return;` 早退契约一致（model-manager.remove 经此路径）。
        return null;
    }
    clone(_name: string, ..._args: any[]) {
        return this;
    }
    dispose(_forceDisposeEffect?: boolean, _forceDisposeTextures?: boolean) {}
}

// ===== Meshes =====
export class MockAbstractMesh {
    position = { x: 0, y: 0, z: 0 };
    name = '';
    constructor(name = '') {
        this.name = name;
    }
    getClassName() {
        return 'AbstractMesh';
    }
    setEnabled(_value?: boolean) {}
    dispose(_doNotRecurse?: boolean, _disposeMaterialAndTextures?: boolean) {}
}

export class MockMesh {
    position = { x: 0, y: 0, z: 0 };
    name = '';
    material: any = null;
    scaling = { x: 1, y: 1, z: 1, setAll() {} };
    rotation = { x: 0, y: 0, z: 0 };
    visibility = 1;
    constructor(name = '') {
        this.name = name;
    }
    getClassName() {
        return 'Mesh';
    }
    setEnabled(_value?: boolean) {}
    getTotalVertices() {
        return 1000;
    }
    getTotalIndices() {
        return 3000;
    }
    dispose(_doNotRecurse?: boolean, _disposeMaterialAndTextures?: boolean) {}
}

// ===== Textures =====
export class MockBaseTexture {
    name = '';
    constructor() {}
    getClassName() {
        return 'BaseTexture';
    }
    dispose() {}
}

export class MockTexture {
    _url: string;
    _scene: any;
    name = '';
    url = '';
    _texture: any = null;
    onLoadObservable = { add: () => {}, remove: () => {} };
    constructor(url: string, scene?: any) {
        this._url = url;
        this._scene = scene ?? null;
        this.name = url;
        this.url = url;
    }
    isReady() {
        return true;
    }
    dispose() {}
    getClassName() {
        return 'Texture';
    }
    clone() {
        return this;
    }
}

export class MockCubeTexture {
    name = '';
    constructor() {}
    getClassName() {
        return 'CubeTexture';
    }
    dispose() {}
}

// ===== Shadow / PostProcess / Pipeline =====
export class MockShadowGenerator {
    constructor() {}
    getClassName() {
        return 'ShadowGenerator';
    }
    addShadowCaster(_mesh: any, _includeDescendants?: boolean) {}
    getShadowMap() {
        return null;
    }
}

export class MockPostProcess {
    constructor() {}
    getClassName() {
        return 'PostProcess';
    }
}

export class MockDefaultRenderingPipeline {
    constructor() {}
    getClassName() {
        return 'DefaultRenderingPipeline';
    }
    dispose() {}
}

// ===== Particles =====
export class MockGPUParticleSystem {
    constructor() {}
    getClassName() {
        return 'GPUParticleSystem';
    }
}

export class MockParticleSystem {
    constructor() {}
    getClassName() {
        return 'ParticleSystem';
    }
}

// ===== GridMaterial =====
export class MockPBRMaterial {
    name = '';
    alpha = 1;
    wireframe = false;
    backFaceCulling = true;
    metallic = 0;
    roughness = 1;
    reflectionColor = this._makeColor(1, 1, 1);
    emissiveColor = this._makeColor(0, 0, 0);
    ambientColor = this._makeColor(0.5, 0.5, 0.5);
    albedoColor = this._makeColor(1, 1, 1);
    albedoTexture: { level: number; setLevel(l: number): void } | null = null;
    bumpTexture: { level: number; setLevel(l: number): void } | null = null;
    emissiveTexture: { level: number; setLevel(l: number): void } | null = null;

    private _makeColor(r: number, g: number, b: number) {
        const obj: any = {
            r,
            g,
            b,
            set(rv: number, gv: number, bv: number) {
                obj.r = rv;
                obj.g = gv;
                obj.b = bv;
                return obj;
            },
            clone() {
                return { ...obj, r: obj.r, g: obj.g, b: obj.b };
            },
            scale(s: number) {
                return { ...obj, r: obj.r * s, g: obj.g * s, b: obj.b * s };
            },
            toArray() {
                return [obj.r, obj.g, obj.b];
            },
        };
        return obj;
    }

    constructor(name: string) {
        this.name = name;
    }
    getClassName() {
        return 'PBRMaterial';
    }
    getScene() {
        return null;
    }
    clone(_name: string, ..._args: any[]) {
        return this;
    }
    dispose(_forceDisposeEffect?: boolean, _forceDisposeTextures?: boolean) {}
    markDirty(_forceMaterialDirty?: boolean) {}
}

export class MockGridMaterial {
    name = '';
    constructor() {}
    getClassName() {
        return 'GridMaterial';
    }
    dispose(_forceDisposeEffect?: boolean) {}
}

// ===== SceneLoader =====
export const MockImportMeshAsync = async () => ({ meshes: [] });

// ===== 空模块占位（用于 side-effect import）=====
export const emptyModule = {};
