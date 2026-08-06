// camera.test.ts — 主相机模块单测（ADR-100 双轴调度 + 模式切换 + 序列化）
// 覆盖：deriveLegacyMode/LEGACY_MODE_MAP 兼容映射、setCameraControl/setCameraBehavior 双轴写入、
// setOrbitParams/setFreeflyParams/setConcertParams/setSurroundParams 子参数同步、
// setFov 钳位、initCameraSystem 初始化、switchCameraMode 全分支（含 AR 异步竞态）、
// autoFrame 自动取景、getCameraState/setCameraState 序列化（含旧存档迁移/非法 mode 回退）、
// disposeCameraSystem 销毁。
// 依赖 mock：Babylon 类（Camera/ArcRotateCamera/UniversalCamera/Vector3/Scene 最小假对象）、
// config、feedback、debounce、deep-clone、logger、scene/scene、scene-action-bridge、
// camera-vmd/factory/behaviors/bone-lock/auto 子模块。camera-state 用真实实现（纯状态）。

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const shared = vi.hoisted(() => {
    function makeVec(x = 0, y = 0, z = 0) {
        return {
            x,
            y,
            z,
            clone: () => makeVec(x, y, z),
            add: (v: { x: number; y: number; z: number }) => makeVec(x + v.x, y + v.y, z + v.z),
        };
    }
    class Camera {
        position = makeVec(0, 0, 0);
        fov = 0.8;
        detachControl = vi.fn();
        dispose = vi.fn();
        getDirection = vi.fn(() => makeVec(0, 0, 1));
    }
    class ArcRotateCamera extends Camera {
        alpha = 0;
        beta = 0;
        radius = 16;
        target = makeVec(0, 8, 0);
        setTarget = vi.fn();
    }
    class UniversalCamera extends Camera {
        speed = 0.5;
        angularSensibility = 2000;
        setTarget = vi.fn();
    }
    class Vector3 {
        x: number;
        y: number;
        z: number;
        constructor(x = 0, y = 0, z = 0) {
            this.x = x;
            this.y = y;
            this.z = z;
        }
    }
    class Scene {
        activeCamera: unknown = null;
        removeCamera = vi.fn();
    }

    const actions = new Map<string, unknown>();
    const registerSceneAction = vi.fn((k: string, fn: unknown) => {
        actions.set(k, fn);
    });
    const getSceneAction = vi.fn((k: string) => actions.get(k));
    const logWarn = vi.fn();
    const feedbackStatus = vi.fn();
    const triggerAutoSave = vi.fn();
    const debounce = vi.fn((fn: () => void) => fn);
    const deepClone = vi.fn((v: unknown) => JSON.parse(JSON.stringify(v)));
    const focusModel = vi.fn();
    const reattachPipeline = vi.fn();

    const createOrbitCamera = vi.fn(() => new ArcRotateCamera());
    const createFreeflyCamera = vi.fn(() => new UniversalCamera());
    const createSurroundCamera = vi.fn(() => new ArcRotateCamera());
    const createConcertCamera = vi.fn(() => new ArcRotateCamera());
    const createOneshotCamera = vi.fn(() => new ArcRotateCamera());
    const disposeViewMatrixHandle = vi.fn();
    const setSchedulePersistCallback = vi.fn();
    const refreshCameraUserSettings = vi.fn();

    const hasCameraAnimationHandle = vi.fn(() => true);
    const createVmdCamera = vi.fn(() => new Camera());
    const setSwitchCameraModeCallback = vi.fn();
    const loadCameraVmd = vi.fn();
    const clearCameraVmd = vi.fn();
    const animateCameraVmd = vi.fn();

    const initFreeflyUpdate = vi.fn();
    const initFreeflyTouch = vi.fn();
    const stopFreefly = vi.fn();
    const initOrbitUpdate = vi.fn();
    const stopOrbit = vi.fn();
    const startSurround = vi.fn();
    const stopSurround = vi.fn();
    const startConcert = vi.fn();
    const stopConcert = vi.fn();

    const stopBoneLock = vi.fn();
    const restoreBoneLockIfEnabled = vi.fn();
    const setOrbitBoneLock = vi.fn();
    const getOrbitBoneLock = vi.fn();
    const setBoneLockDamping = vi.fn();
    const getBoneLockDamping = vi.fn();
    const getFocusedModelBoneNames = vi.fn();

    const setAutoCameraEnabled = vi.fn();
    const isAutoCameraEnabled = vi.fn(() => false);
    const setAutoCameraBeatsPerSwitch = vi.fn();
    const restoreAutoCameraState = vi.fn();
    const setSyncAxesCallback = vi.fn();
    const getAutoCameraBeatsPerSwitch = vi.fn();

    const uiState = { autoCameraEnabled: false, autoCameraBeatsPerSwitch: 4 };
    const modelRegistry = new Map<string, unknown>();
    let focusedModelId: string | null = null;
    let sceneObj: { activeCamera: unknown; removeCamera: unknown } | null = null;

    return {
        // 相机类以 any 导出：运行时 mock 与 Babylon 真实类型无结构兼容性，
        // 测试传参处（setCurrentCamera/autoFrame）依赖宽类型避免 tsc 报错
        Camera: Camera as any,
        ArcRotateCamera: ArcRotateCamera as any,
        UniversalCamera: UniversalCamera as any,
        Vector3,
        Scene,
        sceneObj,
        actions,
        registerSceneAction,
        getSceneAction,
        logWarn,
        feedbackStatus,
        triggerAutoSave,
        debounce,
        deepClone,
        focusModel,
        reattachPipeline,
        createOrbitCamera,
        createFreeflyCamera,
        createSurroundCamera,
        createConcertCamera,
        createOneshotCamera,
        disposeViewMatrixHandle,
        setSchedulePersistCallback,
        refreshCameraUserSettings,
        hasCameraAnimationHandle,
        createVmdCamera,
        setSwitchCameraModeCallback,
        loadCameraVmd,
        clearCameraVmd,
        animateCameraVmd,
        initFreeflyUpdate,
        initFreeflyTouch,
        stopFreefly,
        initOrbitUpdate,
        stopOrbit,
        startSurround,
        stopSurround,
        startConcert,
        stopConcert,
        stopBoneLock,
        restoreBoneLockIfEnabled,
        setOrbitBoneLock,
        getOrbitBoneLock,
        setBoneLockDamping,
        getBoneLockDamping,
        getFocusedModelBoneNames,
        setAutoCameraEnabled,
        isAutoCameraEnabled,
        setAutoCameraBeatsPerSwitch,
        restoreAutoCameraState,
        setSyncAxesCallback,
        getAutoCameraBeatsPerSwitch,
        uiState,
        modelRegistry,
        focusedModelId,
    };
});

// Babylon 最小假对象（class 声明以支持 instanceof）
vi.mock('@babylonjs/core/Cameras/camera', () => ({ Camera: shared.Camera }));
vi.mock('@babylonjs/core/Cameras/arcRotateCamera', () => ({
    ArcRotateCamera: shared.ArcRotateCamera,
}));
vi.mock('@babylonjs/core/Cameras/universalCamera', () => ({
    UniversalCamera: shared.UniversalCamera,
}));
vi.mock('@babylonjs/core/Maths/math.vector', () => ({ Vector3: shared.Vector3 }));
vi.mock('@babylonjs/core/scene', () => ({ Scene: shared.Scene }));

vi.mock('@/core/config', () => ({
    get focusedModelId() {
        return shared.focusedModelId;
    },
    modelRegistry: shared.modelRegistry,
    triggerAutoSave: shared.triggerAutoSave,
    uiState: shared.uiState,
}));
vi.mock('@/core/feedback', () => ({ feedbackStatus: shared.feedbackStatus }));
vi.mock('@/core/debounce', () => ({ debounce: shared.debounce }));
vi.mock('@/core/deep-clone', () => ({ deepClone: shared.deepClone }));
vi.mock('@/core/logger', () => ({ logWarn: shared.logWarn }));
vi.mock('../scene/scene', () => ({
    focusModel: shared.focusModel,
    reattachPipeline: shared.reattachPipeline,
}));
vi.mock('@/core/scene-action-bridge', () => ({
    registerSceneAction: shared.registerSceneAction,
    getSceneAction: shared.getSceneAction,
}));

vi.mock('../scene/camera/camera-vmd', () => ({
    createVmdCamera: shared.createVmdCamera,
    hasCameraAnimationHandle: shared.hasCameraAnimationHandle,
    setSwitchCameraModeCallback: shared.setSwitchCameraModeCallback,
    loadCameraVmd: shared.loadCameraVmd,
    clearCameraVmd: shared.clearCameraVmd,
    animateCameraVmd: shared.animateCameraVmd,
}));
vi.mock('../scene/camera/camera-factory', () => ({
    createOrbitCamera: shared.createOrbitCamera,
    createFreeflyCamera: shared.createFreeflyCamera,
    createSurroundCamera: shared.createSurroundCamera,
    createConcertCamera: shared.createConcertCamera,
    createOneshotCamera: shared.createOneshotCamera,
    disposeViewMatrixHandle: shared.disposeViewMatrixHandle,
    setSchedulePersistCallback: shared.setSchedulePersistCallback,
    refreshCameraUserSettings: shared.refreshCameraUserSettings,
}));
vi.mock('../scene/camera/camera-behaviors', () => ({
    initFreeflyUpdate: shared.initFreeflyUpdate,
    initFreeflyTouch: shared.initFreeflyTouch,
    stopFreefly: shared.stopFreefly,
    initOrbitUpdate: shared.initOrbitUpdate,
    stopOrbit: shared.stopOrbit,
    startSurround: shared.startSurround,
    stopSurround: shared.stopSurround,
    startConcert: shared.startConcert,
    stopConcert: shared.stopConcert,
}));
vi.mock('../scene/camera/camera-bone-lock', () => ({
    stopBoneLock: shared.stopBoneLock,
    restoreBoneLockIfEnabled: shared.restoreBoneLockIfEnabled,
    setOrbitBoneLock: shared.setOrbitBoneLock,
    getOrbitBoneLock: shared.getOrbitBoneLock,
    setBoneLockDamping: shared.setBoneLockDamping,
    getBoneLockDamping: shared.getBoneLockDamping,
    getFocusedModelBoneNames: shared.getFocusedModelBoneNames,
}));
vi.mock('../scene/camera/camera-auto', () => ({
    setAutoCameraEnabled: shared.setAutoCameraEnabled,
    isAutoCameraEnabled: shared.isAutoCameraEnabled,
    setAutoCameraBeatsPerSwitch: shared.setAutoCameraBeatsPerSwitch,
    restoreAutoCameraState: shared.restoreAutoCameraState,
    setSyncAxesCallback: shared.setSyncAxesCallback,
    getAutoCameraBeatsPerSwitch: shared.getAutoCameraBeatsPerSwitch,
}));

import {
    LEGACY_MODE_MAP,
    deriveLegacyMode,
    setOrbitParams,
    logCameraAlpha,
    setFreeflyParams,
    setConcertParams,
    setSurroundParams,
    _syncAxesFromMode,
    setCameraControl,
    setCameraBehavior,
    setFov,
    initCameraSystem,
    switchCameraMode,
    autoFrame,
    getCameraState,
    setCameraState,
    disposeCameraSystem,
} from '../scene/camera/camera';
import {
    setCameraMode,
    setCameraControl as setStateControl,
    setCameraBehavior as setStateBehavior,
    setScriptedSubMode,
    setCurrentCamera,
    setFov as setStateFov,
    setFocusCenterY,
    setCameraPreset,
    defaultCameraPreset,
    setCameraScene,
    setCameraCanvas,
    setPreviousMode,
    getCameraScene,
    getCameraCanvas,
    getCameraMode,
    getCameraControl,
    getCameraBehavior,
    getScriptedSubMode,
    getFov,
    getCurrentCamera,
    getCameraPreset,
    getFocusCenterY,
} from '../scene/camera/camera-state';

const flush = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
    vi.clearAllMocks();
    // 复位 camera-state
    setCameraMode('orbit');
    setStateControl('orbit');
    setStateBehavior('none');
    setScriptedSubMode('loop');
    setCurrentCamera(null);
    setStateFov(0.8);
    setFocusCenterY(8);
    setCameraPreset(defaultCameraPreset());
    setPreviousMode('orbit');
    // 复位运行时上下文（提供 scene/canvas，使 switchCameraMode 走完整路径）
    shared.sceneObj = { activeCamera: null, removeCamera: vi.fn() };
    setCameraScene(shared.sceneObj as never);
    setCameraCanvas({} as HTMLCanvasElement);
    // 复位共享 mock 状态
    shared.focusedModelId = null;
    shared.modelRegistry.clear();
    shared.uiState.autoCameraEnabled = false;
    shared.uiState.autoCameraBeatsPerSwitch = 4;
    shared.isAutoCameraEnabled.mockReturnValue(false);
    shared.hasCameraAnimationHandle.mockReturnValue(true);
    shared.actions.delete('setARMode');
});

afterEach(() => {
    vi.unstubAllGlobals();
});

describe('LEGACY_MODE_MAP / deriveLegacyMode（双轴→旧模式反查）', () => {
    it('正常：LEGACY_MODE_MAP 覆盖全部 8 种模式', () => {
        expect(Object.keys(LEGACY_MODE_MAP)).toHaveLength(8);
        expect(LEGACY_MODE_MAP.freefly).toEqual({ control: 'freefly', behavior: 'none' });
        expect(LEGACY_MODE_MAP.ar).toEqual({ control: 'ar', behavior: 'none' });
    });

    it('正常：freefly/ar 控制轴直接返回', () => {
        expect(deriveLegacyMode('freefly', 'none')).toBe('freefly');
        expect(deriveLegacyMode('ar', 'none')).toBe('ar');
    });

    it('正常：orbit 控制轴按行为派生', () => {
        expect(deriveLegacyMode('orbit', 'turntable')).toBe('surround');
        expect(deriveLegacyMode('orbit', 'concert')).toBe('concert');
        expect(deriveLegacyMode('orbit', 'beatcut')).toBe('beatcut');
        expect(deriveLegacyMode('orbit', 'none')).toBe('orbit');
    });

    it('正常：scripted 行为按子态派生 vmd/oneshot', () => {
        expect(deriveLegacyMode('orbit', 'scripted', 'oneshot')).toBe('oneshot');
        expect(deriveLegacyMode('orbit', 'scripted', 'loop')).toBe('vmd');
    });
});

describe('_syncAxesFromMode（双轴派生）', () => {
    it('正常：surround 派生 orbit+turntable', () => {
        _syncAxesFromMode('surround');
        expect(getCameraControl()).toBe('orbit');
        expect(getCameraBehavior()).toBe('turntable');
    });

    it('正常：oneshot 派生 scripted 子态', () => {
        _syncAxesFromMode('oneshot');
        expect(getScriptedSubMode()).toBe('oneshot');
    });
});

describe('setOrbitParams / setFreeflyParams / setConcertParams / setSurroundParams', () => {
    it('正常：orbit 模式下同步到 live ArcRotateCamera', () => {
        const arc = new shared.ArcRotateCamera();
        setCurrentCamera(arc);
        setCameraMode('orbit');
        setOrbitParams({ distance: 20, beta: 1, targetHeight: 3 });
        expect(arc.radius).toBe(20);
        expect(arc.beta).toBe(1);
        expect(arc.target.y).toBe(getFocusCenterY() + 3);
    });

    it('边界：非 orbit 模式仅写 preset 不同步 live camera', () => {
        const arc = new shared.ArcRotateCamera();
        setCurrentCamera(arc);
        setCameraMode('freefly');
        setOrbitParams({ distance: 5 });
        expect(getCameraPreset().orbit.distance).toBe(5);
        expect(arc.radius).toBe(16); // 未同步
    });

    it('正常：freefly 模式下同步到 live UniversalCamera', () => {
        const uni = new shared.UniversalCamera();
        setCurrentCamera(uni);
        setCameraMode('freefly');
        setFreeflyParams({ speed: 2, angularSensibility: 1000 });
        expect(uni.speed).toBe(2);
        expect(uni.angularSensibility).toBe(1000);
    });

    it('正常：concert/surround 参数写入 preset', () => {
        setConcertParams({ radius: 30 });
        expect(getCameraPreset().concert.radius).toBe(30);
        setSurroundParams({ height: 5 });
        expect(getCameraPreset().surround.height).toBe(5);
    });
});

describe('logCameraAlpha（诊断日志）', () => {
    it('正常：orbit 模式下打印 alpha', () => {
        const spy = vi.spyOn(console, 'info').mockImplementation(() => {});
        const arc = new shared.ArcRotateCamera();
        arc.alpha = 1.5;
        setCurrentCamera(arc);
        setCameraMode('orbit');
        logCameraAlpha();
        expect(spy).toHaveBeenCalled();
        spy.mockRestore();
    });
});

describe('setCameraControl / setCameraBehavior（双轴写入）', () => {
    it('守卫：同控制方案时直接返回', () => {
        setCameraControl('orbit');
        expect(getCameraControl()).toBe('orbit');
        expect(shared.createFreeflyCamera).not.toHaveBeenCalled();
    });

    it('正常：切到 freefly 关闭自动运镜', () => {
        setCameraControl('freefly');
        expect(getCameraControl()).toBe('freefly');
        expect(shared.setAutoCameraEnabled).toHaveBeenCalledWith(false);
    });

    it('守卫：非 orbit 控制下设置非 none 行为被忽略', () => {
        setCameraControl('freefly');
        setCameraBehavior('turntable');
        expect(getCameraBehavior()).toBe('none');
    });

    it('正常：beatcut 行为开启自动运镜', () => {
        shared.isAutoCameraEnabled.mockReturnValue(true);
        setCameraBehavior('beatcut');
        expect(shared.setAutoCameraEnabled).toHaveBeenCalledWith(true);
        expect(getCameraBehavior()).toBe('beatcut');
    });

    it('正常：非 beatcut 行为关闭自动运镜', () => {
        setCameraBehavior('turntable');
        expect(shared.setAutoCameraEnabled).toHaveBeenCalledWith(false);
        expect(getCameraBehavior()).toBe('turntable');
    });
});

describe('setFov（钳位）', () => {
    it('正常：范围内直接设置', () => {
        setFov(1.2);
        expect(getFov()).toBe(1.2);
    });

    it('边界：超上限钳位到 3', () => {
        setFov(5);
        expect(getFov()).toBe(3);
    });

    it('边界：低于下限钳位到 0.1', () => {
        setFov(0.01);
        expect(getFov()).toBe(0.1);
    });
});

describe('initCameraSystem（初始化）', () => {
    it('正常：创建 orbit 相机并注入回调', () => {
        const scene = new shared.Scene();
        const canvas = {} as HTMLCanvasElement;
        const cam = initCameraSystem(scene as never, canvas);
        expect(cam).toBeInstanceOf(shared.ArcRotateCamera);
        expect(getCameraMode()).toBe('orbit');
        expect(getCurrentCamera()).toBe(cam);
        expect(shared.setSwitchCameraModeCallback).toHaveBeenCalled();
        expect(shared.setSchedulePersistCallback).toHaveBeenCalled();
        expect(shared.setSyncAxesCallback).toHaveBeenCalled();
        expect(shared.initOrbitUpdate).toHaveBeenCalledWith(scene);
        expect(scene.activeCamera).toBe(cam);
    });
});

describe('switchCameraMode（模式切换）', () => {
    it('守卫：同模式直接返回', () => {
        setCameraMode('orbit');
        switchCameraMode('orbit');
        expect(shared.createFreeflyCamera).not.toHaveBeenCalled();
    });

    it('守卫：无 scene/canvas 时直接返回', () => {
        setCameraScene(null);
        setCameraCanvas(null);
        switchCameraMode('freefly');
        expect(getCameraMode()).toBe('orbit');
    });

    it('正常：切到 freefly 停止 orbit 副作用并初始化', () => {
        setCurrentCamera(new shared.ArcRotateCamera());
        switchCameraMode('freefly');
        expect(getCameraMode()).toBe('freefly');
        expect(shared.stopOrbit).toHaveBeenCalled();
        expect(shared.stopBoneLock).toHaveBeenCalled();
        expect(shared.initFreeflyUpdate).toHaveBeenCalled();
        expect(shared.initFreeflyTouch).toHaveBeenCalled();
    });

    it('守卫：切 vmd 无相机动画时回退 orbit', () => {
        shared.hasCameraAnimationHandle.mockReturnValue(false);
        switchCameraMode('vmd');
        expect(getCameraMode()).toBe('orbit');
        expect(shared.logWarn).toHaveBeenCalled();
    });

    it('正常：切 oneshot 不写 preset.mode', () => {
        switchCameraMode('oneshot');
        expect(getCameraMode()).toBe('oneshot');
        expect(getCameraPreset().mode).not.toBe('oneshot');
    });

    it('正常：切 orbit 且聚焦模型时自动取景', () => {
        shared.focusedModelId = 'm1';
        shared.modelRegistry.set('m1', {});
        setCameraMode('freefly');
        switchCameraMode('orbit');
        expect(getCameraMode()).toBe('orbit');
        expect(shared.restoreBoneLockIfEnabled).toHaveBeenCalled();
        expect(shared.focusModel).toHaveBeenCalledWith('m1');
    });

    it('正常：切到 ar 激活摄像头（resolve true）', async () => {
        const setARMode = vi.fn(() => Promise.resolve(true));
        shared.actions.set('setARMode', setARMode);
        switchCameraMode('ar');
        expect(getCameraMode()).toBe('ar');
        await flush();
        expect(setARMode).toHaveBeenCalledWith(true);
    });

    it('守卫：切到 ar 失败（resolve false）还原模式', async () => {
        shared.actions.set('setARMode', vi.fn(() => Promise.resolve(false)));
        switchCameraMode('ar');
        await flush();
        expect(getCameraMode()).toBe('orbit');
        expect(shared.feedbackStatus).toHaveBeenCalled();
    });

    it('守卫：ar 激活 reject 还原模式', async () => {
        shared.actions.set('setARMode', vi.fn(() => Promise.reject(new Error('cam fail'))));
        switchCameraMode('ar');
        await flush();
        expect(getCameraMode()).toBe('orbit');
        expect(shared.logWarn).toHaveBeenCalled();
    });

    it('守卫：ar 激活期间用户切走 → 释放摄像头流', async () => {
        const setARMode = vi.fn(() => Promise.resolve(true));
        shared.actions.set('setARMode', setARMode);
        switchCameraMode('ar');
        switchCameraMode('orbit');
        await flush();
        expect(setARMode).toHaveBeenCalledWith(false);
    });

    it('正常：离开 ar 模式时注销摄像头', () => {
        const setARMode = vi.fn(() => Promise.resolve(true));
        shared.actions.set('setARMode', setARMode);
        setCameraMode('ar');
        switchCameraMode('orbit');
        expect(setARMode).toHaveBeenCalledWith(false);
    });
});

describe('autoFrame（自动取景）', () => {
    it('正常：ArcRotateCamera 设置 target/radius/alpha/beta', () => {
        const arc = new shared.ArcRotateCamera();
        setCurrentCamera(arc);
        autoFrame({ x: 0, y: 5, z: 0 } as never, 10);
        expect(getFocusCenterY()).toBe(5);
        expect(arc.setTarget).toHaveBeenCalled();
        expect(arc.radius).toBe(10 * 0.75 + 2);
        expect(arc.alpha).toBe(-Math.PI / 2);
    });

    it('正常：UniversalCamera 设置位置与 target', () => {
        const uni = new shared.UniversalCamera();
        setCurrentCamera(uni);
        autoFrame({ x: 1, y: 2, z: 3 } as never, 4);
        expect(uni.position).toBeDefined();
        expect(uni.setTarget).toHaveBeenCalled();
    });

    it('边界：无当前相机时不崩', () => {
        setCurrentCamera(null);
        expect(() => autoFrame({ x: 0, y: 0, z: 0 } as never, 1)).not.toThrow();
    });
});

describe('getCameraState（序列化读取）', () => {
    it('正常：ArcRotateCamera 导出 alpha/beta/radius/target', () => {
        const arc = new shared.ArcRotateCamera();
        arc.alpha = 1;
        arc.beta = 2;
        arc.radius = 10;
        setCurrentCamera(arc);
        setStateControl('orbit');
        setStateBehavior('turntable');
        const s = getCameraState();
        expect(s.alpha).toBe(1);
        expect(s.beta).toBe(2);
        expect(s.radius).toBe(10);
        expect(s.mode).toBe('surround');
        expect(s.control).toBe('orbit');
        expect(s.behavior).toBe('turntable');
        expect(s.fov).toBe(0.8);
    });

    it('边界：无当前相机时 null 安全', () => {
        setCurrentCamera(null);
        const s = getCameraState();
        expect(s.positionX).toBe(0);
        expect(s.targetX).toBe(0);
        expect(s.targetY).toBe(8);
        expect(s.radius).toBe(16);
    });
});

describe('setCameraState（序列化恢复）', () => {
    it('正常：双轴齐全时按新字段恢复', () => {
        setCameraState({
            mode: 'orbit',
            control: 'orbit',
            behavior: 'turntable',
            preset: defaultCameraPreset(),
            fov: 1.2,
            alpha: 1,
            beta: 2,
            radius: 10,
            targetX: 0,
            targetY: 8,
            targetZ: 0,
            focusCenterY: 8,
        });
        expect(getCameraControl()).toBe('orbit');
        expect(getCameraBehavior()).toBe('turntable');
        expect(getFov()).toBe(1.2);
    });

    it('守卫：非法 mode 回退 orbit 并告警', () => {
        setCameraState({
            mode: 'invalid' as never,
            preset: defaultCameraPreset(),
            alpha: 0,
            beta: 0,
            radius: 16,
            targetX: 0,
            targetY: 8,
            targetZ: 0,
        });
        expect(getCameraMode()).toBe('orbit');
        expect(shared.logWarn).toHaveBeenCalled();
    });

    it('正常：旧 concert 存档迁移为 surround', () => {
        const preset = defaultCameraPreset();
        preset.concert = { radius: 12, height: 8, speed: 0.3 } as never; // 无 sweepAngle
        setCameraState({
            mode: 'concert',
            preset,
            alpha: 0,
            beta: 0,
            radius: 16,
            targetX: 0,
            targetY: 8,
            targetZ: 0,
        });
        expect(getCameraMode()).toBe('surround');
        expect(getCameraBehavior()).toBe('turntable');
        expect(getCameraPreset().surround).toBeDefined();
    });

    it('正常：仅 control 时逐字段兜底', () => {
        setCameraState({
            mode: 'orbit',
            control: 'freefly',
            preset: defaultCameraPreset(),
            alpha: 0,
            beta: 0,
            radius: 16,
            targetX: 0,
            targetY: 8,
            targetZ: 0,
        });
        expect(getCameraControl()).toBe('freefly');
        expect(getCameraBehavior()).toBe('none');
    });

    it('正常：beatcut 行为开启自动运镜', () => {
        shared.isAutoCameraEnabled.mockReturnValue(true);
        setCameraState({
            mode: 'orbit',
            control: 'orbit',
            behavior: 'beatcut',
            preset: defaultCameraPreset(),
            alpha: 0,
            beta: 0,
            radius: 16,
            targetX: 0,
            targetY: 8,
            targetZ: 0,
        });
        expect(shared.uiState.autoCameraEnabled).toBe(true);
        expect(shared.setAutoCameraBeatsPerSwitch).toHaveBeenCalled();
        expect(shared.restoreAutoCameraState).toHaveBeenCalled();
    });

    it('正常：纯旧格式 + autoCameraEnabled 叠加 beatcut', () => {
        shared.uiState.autoCameraEnabled = true;
        setCameraState({
            mode: 'orbit',
            preset: defaultCameraPreset(),
            alpha: 0,
            beta: 0,
            radius: 16,
            targetX: 0,
            targetY: 8,
            targetZ: 0,
        });
        expect(shared.uiState.autoCameraEnabled).toBe(true);
    });

    it('正常：ArcRotateCamera 恢复视角并反算 targetHeight', () => {
        const arc = new shared.ArcRotateCamera();
        setCurrentCamera(arc);
        setCameraState({
            mode: 'orbit',
            control: 'orbit',
            behavior: 'none',
            preset: defaultCameraPreset(),
            alpha: 1,
            beta: 2,
            radius: 10,
            targetX: 0,
            targetY: 12,
            targetZ: 0,
            focusCenterY: 8,
        });
        expect(arc.alpha).toBe(1);
        expect(arc.radius).toBe(10);
        expect(getCameraPreset().orbit.targetHeight).toBe(12 - 8);
    });

    it('正常：UniversalCamera 恢复位置', () => {
        setCameraState({
            mode: 'freefly',
            control: 'freefly',
            behavior: 'none',
            preset: defaultCameraPreset(),
            alpha: 0,
            beta: 0,
            radius: 16,
            positionX: 1,
            positionY: 2,
            positionZ: 3,
            targetX: 0,
            targetY: 8,
            targetZ: 0,
        });
        const cam = getCurrentCamera();
        expect(cam).toBeInstanceOf(shared.UniversalCamera);
        expect((cam as unknown as { setTarget: unknown }).setTarget).toHaveBeenCalled();
    });
});

describe('disposeCameraSystem（销毁）', () => {
    it('正常：停止所有行为并清理上下文', () => {
        setCurrentCamera(new shared.ArcRotateCamera());
        disposeCameraSystem();
        expect(shared.stopFreefly).toHaveBeenCalled();
        expect(shared.stopOrbit).toHaveBeenCalled();
        expect(shared.stopSurround).toHaveBeenCalled();
        expect(shared.stopConcert).toHaveBeenCalled();
        expect(shared.stopBoneLock).toHaveBeenCalled();
        expect(getCurrentCamera()).toBeNull();
        expect(getCameraScene()).toBeNull();
        expect(getCameraCanvas()).toBeNull();
    });

    it('边界：无当前相机时幂等不崩', () => {
        setCurrentCamera(null);
        expect(() => disposeCameraSystem()).not.toThrow();
    });
});