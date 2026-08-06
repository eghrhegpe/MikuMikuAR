// lighting-stage.test.ts — 舞台灯模块单测（ADR-159）
// 覆盖 _createStageLight（spot/point/directional + 零向量守卫）、_updateIndicator
// （指示器/方向线/材质重建/禁用）、get/set 状态、add/remove/load 生命周期、
// setStageLightState 类型切换与参数应用、光锥 ensure/dispose、transform adapter 回调。
// mock 全部 @babylonjs/core 深路径 + light-cone/lighting-shadow/lighting/transform-adapter，
// 保留真实 lighting-state（共享状态对象与 SHADOW/CONE 键集）。

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const shared = vi.hoisted(() => {
    class Vec3 {
        x: number;
        y: number;
        z: number;
        constructor(x = 0, y = 0, z = 0) {
            this.x = x;
            this.y = y;
            this.z = z;
        }
        static Zero() {
            return new Vec3(0, 0, 0);
        }
        static Up() {
            return new Vec3(0, 1, 0);
        }
        static Dot(a: Vec3, b: Vec3) {
            return a.x * b.x + a.y * b.y + a.z * b.z;
        }
        static Cross(a: Vec3, b: Vec3) {
            return new Vec3(a.y * b.z - a.z * b.y, a.z * b.x - a.x * b.z, a.x * b.y - a.y * b.x);
        }
        clone() {
            return new Vec3(this.x, this.y, this.z);
        }
        copyFrom(v: Vec3) {
            this.x = v.x;
            this.y = v.y;
            this.z = v.z;
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
        subtract(v: Vec3) {
            return new Vec3(this.x - v.x, this.y - v.y, this.z - v.z);
        }
        subtractToRef(v: Vec3, ref: Vec3) {
            ref.x = this.x - v.x;
            ref.y = this.y - v.y;
            ref.z = this.z - v.z;
            return ref;
        }
        length() {
            return Math.sqrt(this.x * this.x + this.y * this.y + this.z * this.z);
        }
        lengthSquared() {
            return this.x * this.x + this.y * this.y + this.z * this.z;
        }
        normalize() {
            const l = this.length();
            if (l > 0) {
                this.x /= l;
                this.y /= l;
                this.z /= l;
            }
            return this;
        }
        scale(s: number) {
            return new Vec3(this.x * s, this.y * s, this.z * s);
        }
        scaleInPlace(s: number) {
            this.x *= s;
            this.y *= s;
            this.z *= s;
            return this;
        }
        add(v: Vec3) {
            return new Vec3(this.x + v.x, this.y + v.y, this.z + v.z);
        }
    }
    class Color3 {
        r: number;
        g: number;
        b: number;
        constructor(r = 0, g = 0, b = 0) {
            this.r = r;
            this.g = g;
            this.b = b;
        }
    }
    class SpotLight {
        id: string;
        position: Vec3;
        direction: Vec3;
        angle: number;
        exponent: number;
        intensity = 1;
        diffuse = new Color3(1, 1, 1);
        specular = new Color3(0, 0, 0);
        disposed = false;
        constructor(
            id: string,
            position: Vec3,
            direction: Vec3,
            angle: number,
            exponent: number,
            _scene: unknown
        ) {
            this.id = id;
            this.position = position;
            this.direction = direction;
            this.angle = angle;
            this.exponent = exponent;
        }
        dispose() {
            this.disposed = true;
        }
        setDirectionToTarget(target: Vec3) {
            this.direction = target.subtract(this.position).normalize();
            return this;
        }
    }
    class PointLight {
        id: string;
        position: Vec3;
        intensity = 1;
        diffuse = new Color3(1, 1, 1);
        specular = new Color3(0, 0, 0);
        range = 50;
        disposed = false;
        constructor(id: string, position: Vec3, _scene: unknown) {
            this.id = id;
            this.position = position;
        }
        dispose() {
            this.disposed = true;
        }
    }
    class DirectionalLight {
        id: string;
        direction: Vec3;
        position = new Vec3();
        intensity = 1;
        diffuse = new Color3(1, 1, 1);
        specular = new Color3(0, 0, 0);
        disposed = false;
        constructor(id: string, direction: Vec3, _scene: unknown) {
            this.id = id;
            this.direction = direction;
        }
        dispose() {
            this.disposed = true;
        }
    }
    class Mesh {
        name: string;
        position = new Vec3();
        scaling = new Vec3(1, 1, 1);
        material: unknown = null;
        isPickable = false;
        color: unknown = null;
        _enabled = true;
        disposed = false;
        constructor(name: string, _scene?: unknown) {
            this.name = name;
        }
        setEnabled(b: boolean) {
            this._enabled = b;
        }
        isEnabled() {
            return this._enabled;
        }
        dispose() {
            this.disposed = true;
        }
    }
    class StandardMaterial {
        name: string;
        emissiveColor = new Color3();
        disableLighting = false;
        alpha = 1;
        disposed = false;
        constructor(name: string, _scene?: unknown) {
            this.name = name;
        }
        dispose() {
            this.disposed = true;
        }
    }
    const MeshBuilder = {
        CreateSphere: vi.fn((name: string, _opts: unknown, scene?: unknown) => new Mesh(name, scene)),
        CreateLines: vi.fn(
            (name: string, opts: { instance?: Mesh } & Record<string, unknown>, scene?: unknown) => {
                if (opts?.instance) {
                    return opts.instance;
                }
                return new Mesh(name, scene);
            }
        ),
        CreateCylinder: vi.fn(),
    };
    const defaultStageLightState = vi.fn((id: string, name: string) => ({
        id,
        name,
        enabled: false,
        type: 'spot',
        intensity: 0.8,
        color: [1, 1, 1],
        angle: 0.8,
        exponent: 2,
        range: 50,
        shadowEnabled: false,
        shadowType: 'soft',
        shadowResolution: 1024,
        shadowBias: 0.0001,
        posX: 0,
        posY: 35,
        posZ: 0,
        targetX: 0,
        targetY: 0,
        targetZ: 0,
        orbitAzimuth: 180,
        orbitElevation: 90,
        orbitDistance: 35,
        indicatorScale: 1,
        indicatorOpacity: 1,
        coneEnabled: false,
        coneIntensity: 0.5,
        coneLength: 30,
        coneSoftness: 0.5,
        followTarget: null,
    }));
    const col3FromTriple = vi.fn((t: readonly number[]) => new Color3(t[0] ?? 0, t[1] ?? 0, t[2] ?? 0));
    const logWarn = vi.fn();
    const ensureStageShadow = vi.fn();
    const disposeStageShadow = vi.fn();
    const createLightCone = vi.fn();
    const updateLightConeTransform = vi.fn();
    const updateLightConeUniforms = vi.fn();
    const rebuildLightConeGeometry = vi.fn();
    const setLightConeEnabled = vi.fn();
    const disposeLightCone = vi.fn();
    const registerTransformAdapter = vi.fn();
    const attachGizmoForKind = vi.fn();
    const isGizmoActive = vi.fn(() => false);
    const getGizmoTargetId = vi.fn(() => null);
    const setTransformMetadata = vi.fn();
    const triggerAutoSave = vi.fn();
    return {
        Vec3,
        Color3,
        SpotLight,
        PointLight,
        DirectionalLight,
        Mesh,
        StandardMaterial,
        MeshBuilder,
        defaultStageLightState,
        col3FromTriple,
        logWarn,
        ensureStageShadow,
        disposeStageShadow,
        createLightCone,
        updateLightConeTransform,
        updateLightConeUniforms,
        rebuildLightConeGeometry,
        setLightConeEnabled,
        disposeLightCone,
        registerTransformAdapter,
        attachGizmoForKind,
        isGizmoActive,
        getGizmoTargetId,
        setTransformMetadata,
        triggerAutoSave,
    };
});

// ── Babylon.js 最小假对象（绝不真实例化）──
vi.mock('@babylonjs/core/Lights/spotLight', () => ({ SpotLight: shared.SpotLight }));
vi.mock('@babylonjs/core/Lights/pointLight', () => ({ PointLight: shared.PointLight }));
vi.mock('@babylonjs/core/Lights/directionalLight', () => ({ DirectionalLight: shared.DirectionalLight }));
vi.mock('@babylonjs/core/Maths/math.vector', () => ({ Vector3: shared.Vec3 }));
vi.mock('@babylonjs/core/Maths/math.color', () => ({ Color3: shared.Color3 }));
vi.mock('@babylonjs/core/Meshes/mesh', () => ({ Mesh: shared.Mesh }));
vi.mock('@babylonjs/core/Meshes/meshBuilder', () => ({ MeshBuilder: shared.MeshBuilder }));
vi.mock('@babylonjs/core/Materials/standardMaterial', () => ({ StandardMaterial: shared.StandardMaterial }));

// ── 被测文件依赖（相对测试文件路径）──
vi.mock('../scene/render/light-cone', () => ({
    createLightCone: shared.createLightCone,
    updateLightConeTransform: shared.updateLightConeTransform,
    updateLightConeUniforms: shared.updateLightConeUniforms,
    rebuildLightConeGeometry: shared.rebuildLightConeGeometry,
    setLightConeEnabled: shared.setLightConeEnabled,
    disposeLightCone: shared.disposeLightCone,
}));
vi.mock('../scene/render/lighting-shadow', () => ({
    _ensureStageShadow: shared.ensureStageShadow,
    _disposeStageShadow: shared.disposeStageShadow,
}));
vi.mock('../scene/render/lighting', () => ({
    _defaultStageLightState: shared.defaultStageLightState,
}));
vi.mock('@/core/color-helpers', () => ({ col3FromTriple: shared.col3FromTriple }));
vi.mock('@/core/logger', () => ({ logWarn: shared.logWarn }));
vi.mock('../scene/transform/transform-adapter', () => ({
    registerTransformAdapter: shared.registerTransformAdapter,
    attachGizmoForKind: shared.attachGizmoForKind,
    isGizmoActive: shared.isGizmoActive,
    getGizmoTargetId: shared.getGizmoTargetId,
}));
vi.mock('../scene/transform/transform-pick', () => ({
    setTransformMetadata: shared.setTransformMetadata,
}));

import { lightingState } from '../scene/render/lighting-state';
import type { StageLightEntry } from '../scene/render/lighting-state';
import type { StageLightState, StageLightType } from '../scene/render/lighting';
import {
    _createStageLight,
    _updateIndicator,
    getStageLights,
    getActiveStageLightId,
    setActiveStageLightId,
    getStageLightState,
    setStageLightState,
    _disposeStageLightEntry,
    addStageLight,
    removeStageLight,
    loadStageLights,
    rebuildStageLightShadows,
} from '../scene/render/lighting-stage';

interface AdapterLike {
    kinds: string[];
    getNode: (id: string) => unknown;
    gizmoTypes: (id: string) => string[];
    onPositionDragEnd: (id: string, n: unknown) => void;
    onRotationDragEnd?: (id: string, n: unknown) => void;
    capabilities: string[];
    getScale: (id: string) => number;
    setScale: (id: string, v: number) => void;
    getOpacity: (id: string) => number;
    setOpacity: (id: string, v: number) => void;
}

// 模块加载时 registerTransformAdapter 被调用一次，捕获注册的适配器
const adapter = shared.registerTransformAdapter.mock.calls[0][0] as AdapterLike;

// mock 类的实例类型（供测试中访问类型专属字段时断言）
type MockSpotLight = InstanceType<typeof shared.SpotLight>;
type MockPointLight = InstanceType<typeof shared.PointLight>;
type MockDirectionalLight = InstanceType<typeof shared.DirectionalLight>;
type MockMesh = InstanceType<typeof shared.Mesh>;

function makeEntry(
    type: StageLightType = 'spot',
    overrides: Partial<StageLightState> = {}
): StageLightEntry {
    const state = {
        ...shared.defaultStageLightState('light-1', type),
        type,
        ...overrides,
    } as unknown as StageLightState;
    const light = _createStageLight(type, state);
    return { state, light, indicator: null, dirLine: null };
}

function seedEntry(
    id: string,
    type: StageLightType = 'spot',
    overrides: Partial<StageLightState> = {}
): StageLightEntry {
    const state = {
        ...shared.defaultStageLightState(id, id),
        type,
        ...overrides,
    } as unknown as StageLightState;
    const light = _createStageLight(type, state);
    const entry: StageLightEntry = { state, light, indicator: null, dirLine: null };
    lightingState.stageLights.set(id, entry);
    return entry;
}

beforeEach(() => {
    vi.clearAllMocks();
    lightingState.stageLights.clear();
    lightingState.stageShadows.clear();
    lightingState.stageCones.clear();
    lightingState.activeStageLightId = null;
    lightingState.stageLightCounter = 0;
    lightingState.scene = {} as never;
    lightingState.triggerAutoSave = shared.triggerAutoSave;
    lightingState.skipLightAutoSave = false;
    shared.isGizmoActive.mockReturnValue(false);
    shared.getGizmoTargetId.mockReturnValue(null);
    shared.attachGizmoForKind.mockReturnValue(true);
    shared.createLightCone.mockReturnValue({
        mesh: new shared.Mesh('cone'),
        material: {},
        geoLength: 30,
        geoAngle: 0.8,
    });
});

afterEach(() => {
    vi.unstubAllGlobals();
});

describe('_createStageLight（三种灯光类型 + 零向量守卫）', () => {
    it('正常：spot 创建 SpotLight 并应用强度/颜色/朝向', () => {
        const state = {
            ...shared.defaultStageLightState('l1', '聚光灯'),
            enabled: true,
            intensity: 0.5,
        } as unknown as StageLightState;
        const light = _createStageLight('spot', state) as unknown as MockSpotLight;
        expect(light).toBeInstanceOf(shared.SpotLight);
        expect(light.intensity).toBe(0.5);
        expect(light.diffuse.r).toBe(1);
        expect(light.specular.r).toBe(0.3);
        expect(light.angle).toBe(0.8);
        expect(light.exponent).toBe(2);
        expect(light.direction.y).toBeLessThan(0); // setDirectionToTarget 已调用
    });

    it('守卫：disabled 时 intensity 归零', () => {
        const state = {
            ...shared.defaultStageLightState('l1', '聚光灯'),
            enabled: false,
            intensity: 0.5,
        } as unknown as StageLightState;
        const light = _createStageLight('spot', state) as unknown as MockSpotLight;
        expect(light.intensity).toBe(0);
    });

    it('正常：point 创建 PointLight 并应用 range', () => {
        const state = {
            ...shared.defaultStageLightState('l1', '点光源'),
            type: 'point',
            range: 42,
        } as unknown as StageLightState;
        const light = _createStageLight('point', state) as unknown as MockPointLight;
        expect(light).toBeInstanceOf(shared.PointLight);
        expect(light.range).toBe(42);
    });

    it('正常：directional 由 target-pos 推导方向并归一化', () => {
        const state = {
            ...shared.defaultStageLightState('l1', '平行光'),
            type: 'directional',
            posX: 0,
            posY: 0,
            posZ: 0,
            targetX: 0,
            targetY: 10,
            targetZ: 0,
        } as unknown as StageLightState;
        const light = _createStageLight('directional', state) as unknown as MockDirectionalLight;
        expect(light).toBeInstanceOf(shared.DirectionalLight);
        expect(light.direction.y).toBeCloseTo(1);
        expect(light.position.x).toBe(0);
    });

    it('守卫：directional target===pos 时 fallback 朝下', () => {
        const state = {
            ...shared.defaultStageLightState('l1', '平行光'),
            type: 'directional',
            posX: 0,
            posY: 0,
            posZ: 0,
            targetX: 0,
            targetY: 0,
            targetZ: 0,
        } as unknown as StageLightState;
        const light = _createStageLight('directional', state) as unknown as MockDirectionalLight;
        expect(light.direction.y).toBe(-1);
        expect(light.direction.x).toBe(0);
    });
});

describe('_updateIndicator', () => {
    it('守卫：scene 为 null 时直接返回', () => {
        lightingState.scene = null;
        const entry = makeEntry('spot', { enabled: true });
        expect(() => _updateIndicator(entry)).not.toThrow();
        expect(shared.MeshBuilder.CreateSphere).not.toHaveBeenCalled();
    });

    it('正常：enabled 时创建指示器并同步位置/缩放/透明度', () => {
        const entry = makeEntry('spot', { enabled: true, indicatorScale: 2, indicatorOpacity: 0.5 });
        _updateIndicator(entry);
        expect(entry.indicator).not.toBeNull();
        expect(shared.setTransformMetadata).toHaveBeenCalledWith(entry.indicator, 'light', 'light-1');
        expect(entry.indicator!.scaling.x).toBe(2);
        expect((entry.indicator!.material as { alpha: number }).alpha).toBe(0.5);
        expect((entry.indicator as unknown as MockMesh)._enabled).toBe(true);
    });

    it('防御：material 被外部清理时重建', () => {
        const entry = makeEntry('spot', { enabled: true });
        _updateIndicator(entry);
        entry.indicator!.material = null;
        _updateIndicator(entry);
        expect(entry.indicator!.material).not.toBeNull();
    });

    it('正常：spot 灯创建并更新方向线（instance 原地更新）', () => {
        const entry = makeEntry('spot', { enabled: true });
        _updateIndicator(entry);
        expect(entry.dirLine).not.toBeNull();
        const firstLine = entry.dirLine;
        // 再次调用 → 复用 instance，不新建
        _updateIndicator(entry);
        expect(entry.dirLine).toBe(firstLine);
        expect(shared.MeshBuilder.CreateLines).toHaveBeenCalled();
    });

    it('守卫：非 spot 灯存在方向线时释放', () => {
        const entry = makeEntry('point', { enabled: true });
        entry.dirLine = new shared.Mesh('dir') as never;
        _updateIndicator(entry);
        expect(entry.dirLine).toBeNull();
    });

    it('守卫：disabled 时禁用指示器与方向线', () => {
        const entry = makeEntry('spot', { enabled: false });
        entry.indicator = new shared.Mesh('ind') as never;
        entry.dirLine = new shared.Mesh('dir') as never;
        _updateIndicator(entry);
        expect((entry.indicator as unknown as MockMesh)._enabled).toBe(false);
        expect((entry.dirLine as unknown as MockMesh)._enabled).toBe(false);
    });
});

describe('getStageLights / getActiveStageLightId / setActiveStageLightId', () => {
    it('正常：getStageLights 返回全部舞台灯状态', () => {
        seedEntry('light-1', 'spot');
        seedEntry('light-2', 'point');
        const list = getStageLights();
        expect(list).toHaveLength(2);
        expect(list[0].id).toBe('light-1');
        expect(list[1].id).toBe('light-2');
    });

    it('正常：getActiveStageLightId 返回当前激活 id', () => {
        lightingState.activeStageLightId = 'light-9';
        expect(getActiveStageLightId()).toBe('light-9');
    });

    it('正常：setActiveStageLightId 仅接受已存在 id', () => {
        seedEntry('light-1', 'spot');
        setActiveStageLightId('light-1');
        expect(lightingState.activeStageLightId).toBe('light-1');
        setActiveStageLightId('nope');
        expect(lightingState.activeStageLightId).toBe('light-1');
    });
});

describe('getStageLightState', () => {
    it('正常：返回 entry 的读取状态（spot 含 angle/exponent）', () => {
        seedEntry('light-1', 'spot', { angle: 1.2, exponent: 3 });
        const s = getStageLightState('light-1');
        expect(s.id).toBe('light-1');
        expect(s.angle).toBe(1.2);
        expect(s.exponent).toBe(3);
    });

    it('正常：point 灯读取 range', () => {
        seedEntry('light-1', 'point', { range: 77 });
        const s = getStageLightState('light-1');
        expect(s.range).toBe(77);
    });

    it('守卫：无 id 且无激活灯时返回默认主光', () => {
        const s = getStageLightState();
        expect(s.id).toBe('light-1');
        expect(s.name).toBe('主光');
    });

    it('守卫：id 不存在时返回默认状态', () => {
        const s = getStageLightState('missing');
        expect(s.id).toBe('light-1');
    });
});

describe('setStageLightState', () => {
    it('守卫：无 targetId 时直接返回', () => {
        setStageLightState({ intensity: 1 });
        expect(shared.triggerAutoSave).not.toHaveBeenCalled();
    });

    it('守卫：entry 不存在时返回', () => {
        lightingState.activeStageLightId = 'ghost';
        setStageLightState({ intensity: 1 });
        expect(shared.triggerAutoSave).not.toHaveBeenCalled();
    });

    it('守卫：triggerAutoSave 为 null 时返回', () => {
        lightingState.triggerAutoSave = null;
        seedEntry('light-1', 'spot');
        setStageLightState({ intensity: 1 }, 'light-1');
        expect(lightingState.stageLights.get('light-1')!.light.intensity).toBe(0); // 未应用
    });

    it('正常：类型切换 dispose 旧灯并重建 + 重建阴影/光锥 + 自动保存', () => {
        const entry = seedEntry('light-1', 'spot', { enabled: true });
        const oldLight = entry.light;
        setStageLightState({ type: 'point' }, 'light-1');
        expect((oldLight as unknown as { disposed: boolean }).disposed).toBe(true);
        expect(entry.light).toBeInstanceOf(shared.PointLight);
        expect(shared.disposeStageShadow).toHaveBeenCalledWith('light-1');
        expect(shared.ensureStageShadow).toHaveBeenCalledWith('light-1');
        expect(shared.triggerAutoSave).toHaveBeenCalled();
    });

    it('正常：类型切换时 gizmo 激活且指向该灯 → 重新附着', () => {
        seedEntry('light-1', 'spot');
        shared.isGizmoActive.mockReturnValue(true);
        shared.getGizmoTargetId.mockReturnValue('light-1');
        setStageLightState({ type: 'directional' }, 'light-1');
        expect(shared.attachGizmoForKind).toHaveBeenCalledWith('light', 'light-1');
    });

    it('正常：enabled 触发阴影重建 + 光锥更新 + 自动保存', () => {
        seedEntry('light-1', 'spot', { enabled: true });
        setStageLightState({ enabled: true }, 'light-1');
        expect(shared.ensureStageShadow).toHaveBeenCalledWith('light-1');
        expect(shared.triggerAutoSave).toHaveBeenCalled();
    });

    it('守卫：skipLightAutoSave 时抑制自动保存', () => {
        lightingState.skipLightAutoSave = true;
        seedEntry('light-1', 'spot');
        setStageLightState({ intensity: 0.9 }, 'light-1');
        expect(shared.triggerAutoSave).not.toHaveBeenCalled();
    });

    it('正常：intensity 在 enabled 时写入灯', () => {
        seedEntry('light-1', 'spot', { enabled: true });
        setStageLightState({ intensity: 0.6 }, 'light-1');
        expect(lightingState.stageLights.get('light-1')!.light.intensity).toBe(0.6);
    });

    it('正常：color 写入 diffuse', () => {
        seedEntry('light-1', 'spot');
        setStageLightState({ color: [0.2, 0.4, 0.6] }, 'light-1');
        const d = lightingState.stageLights.get('light-1')!.light.diffuse;
        expect(d.r).toBe(0.2);
        expect(d.g).toBe(0.4);
        expect(d.b).toBe(0.6);
    });

    it('正常：spot 灯 angle/exponent 写入', () => {
        seedEntry('light-1', 'spot');
        setStageLightState({ angle: 1.5, exponent: 4 }, 'light-1');
        const light = lightingState.stageLights.get('light-1')!.light as unknown as MockSpotLight;
        expect(light.angle).toBe(1.5);
        expect(light.exponent).toBe(4);
    });

    it('正常：point 灯 range 写入', () => {
        seedEntry('light-1', 'point');
        setStageLightState({ range: 33 }, 'light-1');
        expect(lightingState.stageLights.get('light-1')!.light.range).toBe(33);
    });

    it('正常：orbit 参数反算 position（spot 重定向）', () => {
        seedEntry('light-1', 'spot');
        setStageLightState({ orbitAzimuth: 90, orbitElevation: 0, orbitDistance: 10 }, 'light-1');
        const p = lightingState.stageLights.get('light-1')!.light.position;
        expect(p.x).toBeCloseTo(10);
        expect(p.y).toBeCloseTo(0);
        expect(p.z).toBeCloseTo(0);
    });

    it('守卫：directional 目标零向量时 direction fallback 朝下', () => {
        const entry = seedEntry('light-1', 'directional', { posX: 0, posY: 0, posZ: 0 });
        setStageLightState({ targetX: 0, targetY: 0, targetZ: 0 }, 'light-1');
        expect(entry.light.direction.y).toBe(-1);
    });

    it('正常：directional 目标非零时 direction 归一化', () => {
        const entry = seedEntry('light-1', 'directional', { posX: 0, posY: 0, posZ: 0 });
        setStageLightState({ targetX: 0, targetY: 10, targetZ: 0 }, 'light-1');
        expect(entry.light.direction.y).toBeCloseTo(1);
    });

    it('正常：posX/Y/Z 直接写位置', () => {
        seedEntry('light-1', 'spot');
        setStageLightState({ posX: 3, posY: 4, posZ: 5 }, 'light-1');
        const p = lightingState.stageLights.get('light-1')!.light.position;
        expect(p.x).toBe(3);
        expect(p.y).toBe(4);
        expect(p.z).toBe(5);
    });
});

describe('光锥 ensure/dispose（经 setStageLightState 触发）', () => {
    it('正常：coneEnabled 时创建光锥并登记', () => {
        seedEntry('light-1', 'spot', { enabled: true, coneEnabled: true });
        setStageLightState({ coneEnabled: true }, 'light-1');
        expect(shared.createLightCone).toHaveBeenCalled();
        expect(lightingState.stageCones.has('light-1')).toBe(true);
    });

    it('正常：已存在光锥时更新几何/transform/uniforms', () => {
        seedEntry('light-1', 'spot', { enabled: true, coneEnabled: true });
        lightingState.stageCones.set('light-1', {
            mesh: new shared.Mesh('cone'),
            material: {},
            geoLength: 30,
            geoAngle: 0.8,
        } as never);
        setStageLightState({ coneLength: 40 }, 'light-1');
        expect(shared.rebuildLightConeGeometry).toHaveBeenCalled();
        expect(shared.updateLightConeTransform).toHaveBeenCalled();
        expect(shared.updateLightConeUniforms).toHaveBeenCalled();
        expect(shared.setLightConeEnabled).toHaveBeenCalledWith(expect.anything(), true);
    });

    it('守卫：coneEnabled=false 时释放光锥', () => {
        seedEntry('light-1', 'spot', { enabled: true, coneEnabled: true });
        lightingState.stageCones.set('light-1', {
            mesh: new shared.Mesh('cone'),
            material: {},
            geoLength: 30,
            geoAngle: 0.8,
        } as never);
        setStageLightState({ coneEnabled: false }, 'light-1');
        expect(shared.disposeLightCone).toHaveBeenCalled();
        expect(lightingState.stageCones.has('light-1')).toBe(false);
    });

    it('守卫：创建光锥抛错时 logWarn 不崩溃', () => {
        seedEntry('light-1', 'spot', { enabled: true, coneEnabled: true });
        shared.createLightCone.mockImplementation(() => {
            throw new Error('boom');
        });
        expect(() => setStageLightState({ coneEnabled: true }, 'light-1')).not.toThrow();
        expect(shared.logWarn).toHaveBeenCalled();
    });
});

describe('_disposeStageLightEntry', () => {
    it('正常：释放指示器/灯/阴影/光锥', () => {
        const entry = seedEntry('light-1', 'spot', { enabled: true });
        entry.indicator = new shared.Mesh('ind') as never;
        entry.dirLine = new shared.Mesh('dir') as never;
        lightingState.stageShadows.set('light-1', { dispose: vi.fn() } as never);
        lightingState.stageCones.set('light-1', {
            mesh: new shared.Mesh('cone'),
            material: {},
            geoLength: 30,
            geoAngle: 0.8,
        } as never);
        _disposeStageLightEntry('light-1', entry);
        expect(entry.indicator).toBeNull();
        expect(entry.dirLine).toBeNull();
        expect((entry.light as unknown as { disposed: boolean }).disposed).toBe(true);
        expect(shared.disposeStageShadow).toHaveBeenCalledWith('light-1');
        expect(shared.disposeLightCone).toHaveBeenCalled();
    });
});

describe('addStageLight', () => {
    it('正常：创建默认 spot 灯并设为激活', () => {
        const id = addStageLight();
        expect(id).toBe('light-1');
        expect(lightingState.stageLights.has('light-1')).toBe(true);
        expect(lightingState.activeStageLightId).toBe('light-1');
        expect(lightingState.stageLightCounter).toBe(1);
        expect(shared.triggerAutoSave).toHaveBeenCalled();
    });

    it('正常：preset 覆盖默认状态', () => {
        const id = addStageLight('point', { range: 99, intensity: 0.3, enabled: true });
        const s = getStageLightState(id);
        expect(s.type).toBe('point');
        expect(s.range).toBe(99);
        expect(s.intensity).toBe(0.3);
    });

    it('守卫：超过 6 盏上限返回空串', () => {
        for (let i = 0; i < 6; i++) {
            addStageLight();
        }
        expect(lightingState.stageLights.size).toBe(6);
        expect(addStageLight()).toBe('');
    });
});

describe('removeStageLight', () => {
    it('守卫：id 不存在返回 false', () => {
        expect(removeStageLight('nope')).toBe(false);
    });

    it('守卫：仅剩 1 盏时拒绝删除', () => {
        addStageLight();
        expect(removeStageLight('light-1')).toBe(false);
        expect(lightingState.stageLights.size).toBe(1);
    });

    it('正常：删除并重设激活 id 到剩余灯', () => {
        addStageLight();
        addStageLight();
        expect(removeStageLight('light-1')).toBe(true);
        expect(lightingState.stageLights.has('light-1')).toBe(false);
        expect(lightingState.activeStageLightId).toBe('light-2');
        expect(shared.triggerAutoSave).toHaveBeenCalled();
    });
});

describe('loadStageLights', () => {
    it('正常：空数组时创建默认主光', () => {
        loadStageLights([]);
        expect(lightingState.stageLights.size).toBe(1);
        expect(lightingState.activeStageLightId).toBe('light-1');
        expect(lightingState.stageLightCounter).toBe(1);
    });

    it('正常：迁移 volumetric* → cone* 并计算 counter', () => {
        // 旧存档不含 cone* 字段（删除默认值以命中 ?? 迁移分支）
        const legacy1 = {
            ...shared.defaultStageLightState('light-1', 'a'),
            volumetricEnabled: true,
            volumetricExposure: 2,
            volumetricDensity: 0.2,
        } as Record<string, unknown>;
        delete legacy1.coneEnabled;
        delete legacy1.coneIntensity;
        delete legacy1.coneLength;
        delete legacy1.coneSoftness;
        const legacy3 = { ...shared.defaultStageLightState('light-3', 'b') } as Record<string, unknown>;
        delete legacy3.coneEnabled;
        delete legacy3.coneIntensity;
        delete legacy3.coneLength;
        delete legacy3.coneSoftness;
        loadStageLights([legacy1, legacy3] as never);
        expect(lightingState.stageLights.size).toBe(2);
        expect(lightingState.stageLightCounter).toBe(3);
        expect(lightingState.activeStageLightId).toBe('light-1');
        const s1 = getStageLightState('light-1');
        expect(s1.coneEnabled).toBe(true);
        expect(s1.coneIntensity).toBe(1);
        expect(s1.coneLength).toBe(30);
        expect(s1.coneSoftness).toBeCloseTo(0.8);
        const s3 = getStageLightState('light-3');
        expect(s3.coneEnabled).toBe(false);
        expect(s3.coneIntensity).toBe(0.5);
    });
});

describe('rebuildStageLightShadows', () => {
    it('正常：为每盏灯重建阴影', () => {
        seedEntry('light-1', 'spot');
        seedEntry('light-2', 'point');
        rebuildStageLightShadows();
        expect(shared.ensureStageShadow).toHaveBeenCalledWith('light-1');
        expect(shared.ensureStageShadow).toHaveBeenCalledWith('light-2');
    });
});

describe('transform adapter 注册', () => {
    it('正常：注册 kinds 为 light', () => {
        expect(adapter.kinds).toEqual(['light']);
        expect(adapter.capabilities).toEqual(['slider-scale', 'slider-opacity']);
    });

    it('正常：getNode 返回对应灯或 null', () => {
        seedEntry('light-1', 'spot');
        expect(adapter.getNode('light-1')).toBe(lightingState.stageLights.get('light-1')!.light);
        expect(adapter.getNode('missing')).toBeNull();
    });

    it('正常：gizmoTypes 按类型区分（point 无旋转）', () => {
        expect(adapter.gizmoTypes('light-1')).toEqual(['position', 'rotation']);
        seedEntry('light-1', 'point');
        expect(adapter.gizmoTypes('light-1')).toEqual(['position']);
    });

    it('正常：onPositionDragEnd 回写位置', () => {
        seedEntry('light-1', 'spot');
        adapter.onPositionDragEnd('light-1', { position: { x: 5, y: 6, z: 7 } });
        const p = lightingState.stageLights.get('light-1')!.light.position;
        expect(p.x).toBe(5);
        expect(p.y).toBe(6);
        expect(p.z).toBe(7);
    });

    it('正常：onRotationDragEnd 对 spot 灯回写 target', () => {
        const entry = seedEntry('light-1', 'spot');
        (entry.light as unknown as { direction: unknown }).direction = new shared.Vec3(0, 1, 0);
        adapter.onRotationDragEnd!('light-1', {});
        const s = getStageLightState('light-1');
        expect(s.targetY).toBeGreaterThan(0);
    });

    it('正常：onRotationDragEnd 对 directional 灯回写 target', () => {
        const entry = seedEntry('light-1', 'directional');
        (entry.light as unknown as { direction: unknown }).direction = new shared.Vec3(1, 0, 0);
        adapter.onRotationDragEnd!('light-1', {});
        const s = getStageLightState('light-1');
        expect(s.targetX).toBeGreaterThan(0);
    });

    it('守卫：onRotationDragEnd 对不存在 entry 直接返回', () => {
        expect(() => adapter.onRotationDragEnd!('missing', {})).not.toThrow();
    });

    it('正常：getScale/setScale/getOpacity/setOpacity 透传', () => {
        seedEntry('light-1', 'spot', { indicatorScale: 2, indicatorOpacity: 0.4 });
        expect(adapter.getScale('light-1')).toBe(2);
        expect(adapter.getOpacity('light-1')).toBe(0.4);
        adapter.setScale('light-1', 3);
        adapter.setOpacity('light-1', 0.7);
        expect(getStageLightState('light-1').indicatorScale).toBe(3);
        expect(getStageLightState('light-1').indicatorOpacity).toBe(0.7);
    });
});