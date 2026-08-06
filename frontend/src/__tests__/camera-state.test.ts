// camera-state.test.ts — 相机纯状态管理模块单测
// 覆盖：默认预设、类型守卫、全部 getter/setter 状态转换、isTouchDevice 分支、
// 以及模块加载时经 scene-action-bridge 注册的 setCameraMode / getCameraMode action
// （含非法 mode 回退 orbit、无 switchCameraMode 时降级状态写入）。
// 依赖 mock：scene-action-bridge（捕获注册 action）、logger（logWarn）。
// 本模块为纯状态管理，无 Babylon 实例化，无需 mock Camera/Scene 真实对象。

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const shared = vi.hoisted(() => {
    const actions = new Map<string, unknown>();
    const registerSceneAction = vi.fn((key: string, fn: unknown) => {
        actions.set(key, fn);
    });
    const getSceneAction = vi.fn((key: string) => actions.get(key));
    const logWarn = vi.fn();
    return { actions, registerSceneAction, getSceneAction, logWarn };
});

vi.mock('../core/scene-action-bridge', () => ({
    registerSceneAction: shared.registerSceneAction,
    getSceneAction: shared.getSceneAction,
}));
vi.mock('../core/logger', () => ({
    logWarn: shared.logWarn,
}));

import {
    CAMERA_MODES,
    isCameraMode,
    defaultCameraPreset,
    getCameraPreset,
    setCameraPreset,
    getOrbitParams,
    getFreeflyParams,
    getConcertParams,
    getSurroundParams,
    getCameraMode,
    getCameraControl,
    getCameraBehavior,
    getScriptedSubMode,
    setCameraMode,
    setCameraControl,
    setCameraBehavior,
    setScriptedSubMode,
    getFov,
    setFov,
    getCurrentCamera,
    setCurrentCamera,
    getFocusCenterY,
    setFocusCenterY,
    getConcertPaused,
    setConcertPaused,
    getSurroundPaused,
    setSurroundPaused,
    getCameraVmdName,
    getCameraVmdPath,
    hasCameraVmd,
    setCameraVmdState,
    clearCameraVmdState,
    isAutoCameraEnabled,
    setAutoCameraEnabledFlag,
    getAutoCameraBeatCount,
    setAutoCameraBeatCount,
    getAutoCameraPresetIdx,
    setAutoCameraPresetIdx,
    isTouchDevice,
    getCameraScene,
    setCameraScene,
    getCameraCanvas,
    setCameraCanvas,
    getPreviousMode,
    setPreviousMode,
    getViewMatrixHandle,
    setViewMatrixHandle,
} from '../scene/camera/camera-state';

describe('CAMERA_MODES 与 isCameraMode', () => {
    it('正常：CAMERA_MODES 覆盖全部 8 种合法模式', () => {
        expect(CAMERA_MODES).toEqual([
            'orbit',
            'freefly',
            'surround',
            'concert',
            'oneshot',
            'vmd',
            'ar',
            'beatcut',
        ]);
    });

    it('正常：合法 mode 通过类型守卫', () => {
        expect(isCameraMode('orbit')).toBe(true);
        expect(isCameraMode('beatcut')).toBe(true);
    });

    it('守卫：非法 mode 被类型守卫拒绝', () => {
        expect(isCameraMode('fly')).toBe(false);
        expect(isCameraMode('')).toBe(false);
    });
});

describe('defaultCameraPreset', () => {
    it('正常：返回默认预设（orbit 模式 + 各子参数默认值）', () => {
        const p = defaultCameraPreset();
        expect(p.mode).toBe('orbit');
        expect(p.orbit).toEqual({ targetHeight: 0, distance: 16, beta: Math.PI / 3 });
        expect(p.freefly).toEqual({ speed: 0.5, angularSensibility: 2000 });
        expect(p.surround).toEqual({ radius: 12, height: 8, speed: 0.3 });
        expect(p.concert).toEqual({
            radius: 12,
            height: 8,
            sweepAngle: 120,
            sweepSpeed: 0.6,
            baseBeta: Math.PI / 3,
            bobAmplitude: 12,
            bobSpeed: 0.7,
        });
    });
});

describe('Preset 状态转换', () => {
    it('正常：setCameraPreset 后 getCameraPreset 返回同一引用', () => {
        const p = defaultCameraPreset();
        p.orbit.distance = 30;
        setCameraPreset(p);
        expect(getCameraPreset()).toBe(p);
        expect(getCameraPreset().orbit.distance).toBe(30);
    });

    it('正常：子参数 getter 返回当前 preset 对应字段', () => {
        const p = defaultCameraPreset();
        p.orbit.targetHeight = 5;
        p.freefly.speed = 2;
        p.concert.radius = 20;
        p.surround.height = 10;
        setCameraPreset(p);
        expect(getOrbitParams()).toBe(p.orbit);
        expect(getFreeflyParams()).toBe(p.freefly);
        expect(getConcertParams()).toBe(p.concert);
        expect(getSurroundParams()).toBe(p.surround);
    });
});

describe('Mode / Control / Behavior / ScriptedSubMode 状态转换', () => {
    it('正常：setCameraMode 后 getCameraMode 返回新值', () => {
        setCameraMode('concert');
        expect(getCameraMode()).toBe('concert');
    });

    it('正常：setCameraControl 后 getCameraControl 返回新值', () => {
        setCameraControl('freefly');
        expect(getCameraControl()).toBe('freefly');
    });

    it('正常：setCameraBehavior 后 getCameraBehavior 返回新值', () => {
        setCameraBehavior('turntable');
        expect(getCameraBehavior()).toBe('turntable');
    });

    it('正常：setScriptedSubMode 后 getScriptedSubMode 返回新值', () => {
        setScriptedSubMode('oneshot');
        expect(getScriptedSubMode()).toBe('oneshot');
    });
});

describe('FOV / 相机引用 / 焦点高度', () => {
    it('正常：setFov 后 getFov 返回新值', () => {
        setFov(1.2);
        expect(getFov()).toBe(1.2);
    });

    it('正常：setCurrentCamera 后 getCurrentCamera 返回同一引用', () => {
        const cam = { name: 'fake-cam' } as any;
        setCurrentCamera(cam);
        expect(getCurrentCamera()).toBe(cam);
    });

    it('边界：setCurrentCamera(null) 后 getCurrentCamera 返回 null', () => {
        setCurrentCamera(null);
        expect(getCurrentCamera()).toBeNull();
    });

    it('正常：setFocusCenterY 后 getFocusCenterY 返回新值', () => {
        setFocusCenterY(12);
        expect(getFocusCenterY()).toBe(12);
    });
});

describe('Paused 状态', () => {
    it('正常：setConcertPaused 后 getConcertPaused 返回新值', () => {
        setConcertPaused(true);
        expect(getConcertPaused()).toBe(true);
        setConcertPaused(false);
        expect(getConcertPaused()).toBe(false);
    });

    it('正常：setSurroundPaused 后 getSurroundPaused 返回新值', () => {
        setSurroundPaused(true);
        expect(getSurroundPaused()).toBe(true);
    });
});

describe('VMD 相机状态', () => {
    it('正常：setCameraVmdState 后 name/path 同步写入', () => {
        setCameraVmdState('cam.vmd', '/data/cam.vmd');
        expect(getCameraVmdName()).toBe('cam.vmd');
        expect(getCameraVmdPath()).toBe('/data/cam.vmd');
        expect(hasCameraVmd()).toBe(true);
    });

    it('边界：clearCameraVmdState 清空 name/path 且 hasCameraVmd 为 false', () => {
        setCameraVmdState('cam.vmd', '/data/cam.vmd');
        clearCameraVmdState();
        expect(getCameraVmdName()).toBe('');
        expect(getCameraVmdPath()).toBe('');
        expect(hasCameraVmd()).toBe(false);
    });

    it('边界：空 name 时 hasCameraVmd 为 false', () => {
        setCameraVmdState('', '');
        expect(hasCameraVmd()).toBe(false);
    });
});

describe('Auto Camera 状态', () => {
    it('正常：setAutoCameraEnabledFlag 后 isAutoCameraEnabled 返回新值', () => {
        setAutoCameraEnabledFlag(true);
        expect(isAutoCameraEnabled()).toBe(true);
        setAutoCameraEnabledFlag(false);
        expect(isAutoCameraEnabled()).toBe(false);
    });

    it('正常：setAutoCameraBeatCount 后 getAutoCameraBeatCount 返回新值', () => {
        setAutoCameraBeatCount(4);
        expect(getAutoCameraBeatCount()).toBe(4);
    });

    it('正常：setAutoCameraPresetIdx 后 getAutoCameraPresetIdx 返回新值', () => {
        setAutoCameraPresetIdx(2);
        expect(getAutoCameraPresetIdx()).toBe(2);
    });
});

describe('Runtime Context（scene/canvas/previousMode/viewMatrixHandle）', () => {
    it('正常：setCameraScene 后 getCameraScene 返回同一引用', () => {
        const scene = { name: 'fake-scene' } as any;
        setCameraScene(scene);
        expect(getCameraScene()).toBe(scene);
    });

    it('边界：setCameraScene(null) 后 getCameraScene 返回 null', () => {
        setCameraScene(null);
        expect(getCameraScene()).toBeNull();
    });

    it('正常：setCameraCanvas 后 getCameraCanvas 返回同一引用', () => {
        const canvas = {} as HTMLCanvasElement;
        setCameraCanvas(canvas);
        expect(getCameraCanvas()).toBe(canvas);
    });

    it('正常：setPreviousMode 后 getPreviousMode 返回新值', () => {
        setPreviousMode('ar');
        expect(getPreviousMode()).toBe('ar');
    });

    it('正常：setViewMatrixHandle 后 getViewMatrixHandle 返回同一引用', () => {
        const handle = { dispose: vi.fn() } as any;
        setViewMatrixHandle(handle);
        expect(getViewMatrixHandle()).toBe(handle);
    });

    it('边界：setViewMatrixHandle(null) 后 getViewMatrixHandle 返回 null', () => {
        setViewMatrixHandle(null);
        expect(getViewMatrixHandle()).toBeNull();
    });
});

describe('isTouchDevice', () => {
    afterEach(() => {
        vi.unstubAllGlobals();
        // @ts-ignore 恢复默认（happy-dom 无 ontouchstart）
        delete window.ontouchstart;
    });

    it('正常：存在 ontouchstart 时判定为触屏', () => {
        Object.defineProperty(window, 'ontouchstart', { value: () => {}, configurable: true });
        vi.stubGlobal('navigator', { maxTouchPoints: 0 });
        vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: false })));
        expect(isTouchDevice()).toBe(true);
    });

    it('正常：maxTouchPoints>0 时判定为触屏', () => {
        // @ts-ignore 删除 ontouchstart 以隔离 maxTouchPoints 分支
        delete window.ontouchstart;
        vi.stubGlobal('navigator', { maxTouchPoints: 3 });
        vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: false })));
        expect(isTouchDevice()).toBe(true);
    });

    it('正常：pointer:coarse 命中时判定为触屏', () => {
        // @ts-ignore 删除 ontouchstart 以隔离 pointer:coarse 分支
        delete window.ontouchstart;
        vi.stubGlobal('navigator', { maxTouchPoints: 0 });
        vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: true })));
        expect(isTouchDevice()).toBe(true);
    });

    it('边界：全部不命中时判定为非触屏', () => {
        // @ts-ignore 删除 ontouchstart 以隔离全不命中分支
        delete window.ontouchstart;
        vi.stubGlobal('navigator', { maxTouchPoints: 0 });
        vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: false })));
        expect(isTouchDevice()).toBe(false);
    });
});

describe('注册的 setCameraMode action（ADR-238）', () => {
    beforeEach(() => {
        // 保留模块加载时注册的 setCameraMode/getCameraMode，仅清理委托项
        shared.actions.delete('switchCameraMode');
        shared.logWarn.mockClear();
    });

    it('正常：合法 mode 委托 switchCameraMode', () => {
        const switcher = vi.fn();
        shared.actions.set('switchCameraMode', switcher);
        const action = shared.actions.get('setCameraMode') as (mode: string) => void;
        action('freefly');
        expect(switcher).toHaveBeenCalledWith('freefly');
        expect(shared.logWarn).not.toHaveBeenCalled();
    });

    it('守卫：非法 mode 回退 orbit 并告警', () => {
        const switcher = vi.fn();
        shared.actions.set('switchCameraMode', switcher);
        const action = shared.actions.get('setCameraMode') as (mode: string) => void;
        action('invalid-mode');
        expect(switcher).toHaveBeenCalledWith('orbit');
        expect(shared.logWarn).toHaveBeenCalled();
    });

    it('守卫：无 switchCameraMode 委托时降级为状态写入', () => {
        const action = shared.actions.get('setCameraMode') as (mode: string) => void;
        action('vmd');
        expect(getCameraMode()).toBe('vmd');
    });
});

describe('注册的 getCameraMode action（ADR-238）', () => {
    it('正常：返回当前相机模式', () => {
        setCameraMode('concert');
        const action = shared.actions.get('getCameraMode') as () => string;
        expect(action()).toBe('concert');
    });
});