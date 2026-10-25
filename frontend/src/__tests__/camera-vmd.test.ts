// @vitest-environment node
// camera-vmd.test.ts — camera-vmd SUT 单测（vmd 分支 WASM 池条目确定性释放）
// [audit:fix 2026-10] P3 G2-② 收口回归：clearCameraVmd 的 vmd 分支原本只调
// _switchModeCallback('orbit')，而 babylon-mmd 池表按 handle 记账、不随相机 dispose 清除
// （camera-vmd.ts createVmdCamera 注释先例）→ 每轮 vmd→orbit 切换泄漏 1 个池条目。
// 修复：回调前捕获 oldCam/oldHandle，回调后显式 destroyRuntimeAnimation(oldHandle)
// （与手动分支同款语义 + 同款 ?. 防御 mock）。
// 用例：
//   1. vmd 分支 gap 回归：池条目恰好释放 1 次 + 回调收到 'orbit' + clearCameraVmdState 被调
//   2. 手动分支不回归：orbit 模式下释放链完整（removeCamera + dispose + 池条目 1 次）
//   3. 无 handle 不调：createVmdCamera 无动画源时 handle=null → destroyRuntimeAnimation 0 次
// mock 面（camera-vmd.ts 实际 import 图，最小依赖面；范式照 camera.test.ts）：
//   - @babylonjs/core/Maths/math.vector（Vector3 构造用，最小形状）
//   - babylon-mmd/esm/Runtime/mmdCamera（MmdCamera：实例级 vi.fn + 静态 instances 追踪）
//   - ../scene/camera/camera-state（全 mock：mode/scene 状态 + setCameraVmdState/clearCameraVmdState spy）
// 类型 import（MmdAnimation）运行时被擦除，无需 mock。

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { MmdAnimation } from 'babylon-mmd/esm/Loader/Animation/mmdAnimation';

// 相机 mock 以运行时类注入：与 Babylon 真实 MmdCamera 无结构兼容性，
// 经 vi.mock 工厂整体替换；测试侧仅经静态 instances 取实例断言（同 camera.test.ts 先例）。
type MockScene = { activeCamera: unknown; removeCamera: (..._a: unknown[]) => void };

const shared = vi.hoisted(() => {
    class MmdCam {
        name = '';
        position: unknown = null;
        isDisposed = vi.fn(() => false);
        dispose = vi.fn();
        createRuntimeAnimation = vi.fn(() => 'h1');
        setRuntimeAnimation = vi.fn();
        destroyRuntimeAnimation = vi.fn(() => true);
        animate = vi.fn();
        static instances: MmdCam[] = [];
        constructor(name: string, position: unknown, _scene: unknown, _auto?: unknown) {
            this.name = name;
            this.position = position;
            MmdCam.instances.push(this);
        }
    }
    // camera-state mock 状态：SUT 与测试同引用（vi.hoisted 绑定，供 vi.mock 工厂消费）
    const state = {
        mode: 'orbit' as string,
        scene: null as MockScene | null,
        setCameraVmdState: vi.fn(),
        clearCameraVmdState: vi.fn(),
    };
    return { MmdCam, state };
});

vi.mock('@babylonjs/core/Maths/math.vector', () => ({
    // camera-vmd.ts 仅 new Vector3(0, 10, 0)，最小形状即可
    Vector3: class {
        x = 0;
        y = 0;
        z = 0;
        constructor(x = 0, y = 0, z = 0) {
            this.x = x;
            this.y = y;
            this.z = z;
        }
    },
}));
vi.mock('babylon-mmd/esm/Runtime/mmdCamera', () => ({ MmdCamera: shared.MmdCam }));
vi.mock('../scene/camera/camera-state', () => ({
    getCameraMode: () => shared.state.mode,
    getCameraScene: () => shared.state.scene,
    setCameraMode: (mode: string) => {
        shared.state.mode = mode;
    },
    setCameraScene: (scene: unknown) => {
        shared.state.scene = scene as MockScene | null;
    },
    setCameraVmdState: shared.state.setCameraVmdState,
    clearCameraVmdState: shared.state.clearCameraVmdState,
}));

import {
    loadCameraVmd,
    clearCameraVmd,
    createVmdCamera,
    setSwitchCameraModeCallback,
    hasCameraAnimationHandle,
} from '../scene/camera/camera-vmd';
import { setCameraMode } from '../scene/camera/camera-state';

function makeScene(): MockScene {
    return { activeCamera: null, removeCamera: vi.fn() };
}

beforeEach(() => {
    shared.MmdCam.instances = [];
    shared.state.mode = 'orbit';
    shared.state.scene = makeScene();
    // SUT 侧 _switchModeCallback 复位：签名非可空（strict），用 no-op 代替 null
    setSwitchCameraModeCallback(() => {});
    // 清空 spy 调用史（用例间独立；vi.fn 实现保留，mockClear 语义）
    vi.clearAllMocks();
    // 清空 SUT 模块态残留（前用例若未走到 clearCameraVmd 也不会污染本用例）
    clearCameraVmd();
});

describe('clearCameraVmd — WASM 池条目确定性释放', () => {
    it('用例 1（gap 回归）：vmd 分支回调后释放池条目恰好 1 次', () => {
        // 造出 SUT 内部态：_mmdCamera + _cameraAnimationHandle='h1'
        loadCameraVmd({} as MmdAnimation, 'D:/vmd/test.vmd', 'test.vmd');
        expect(hasCameraAnimationHandle()).toBe(true);
        expect(shared.state.setCameraVmdState).toHaveBeenCalledTimes(1);
        const cam = shared.MmdCam.instances[0];
        expect(cam.createRuntimeAnimation).toHaveBeenCalledTimes(1);
        expect(cam.setRuntimeAnimation).toHaveBeenCalledTimes(1);

        setCameraMode('vmd');
        const spyOrbit = vi.fn();
        setSwitchCameraModeCallback(spyOrbit);

        clearCameraVmd();

        // [audit:fix 2026-10] 核心断言：池条目恰好释放 1 次（修复前为 0 次 → 本用例即 gap 回归）
        expect(cam.destroyRuntimeAnimation).toHaveBeenCalledTimes(1);
        expect(cam.destroyRuntimeAnimation).toHaveBeenCalledWith('h1');
        // 回调收到 'orbit'（switchCameraMode 负责相机本体 detach/remove/dispose，测试 spy 不代为释放）
        expect(spyOrbit).toHaveBeenCalledTimes(1);
        expect(spyOrbit).toHaveBeenCalledWith('orbit');
        // VMD 状态清零
        expect(shared.state.clearCameraVmdState).toHaveBeenCalledTimes(1);
        expect(hasCameraAnimationHandle()).toBe(false);
        // vmd 分支不做手动 remove/dispose（已由 switchCameraMode 完成，防二次释放）
        expect(shared.state.scene!.removeCamera).not.toHaveBeenCalled();
        expect(cam.dispose).not.toHaveBeenCalled();
    });

    it('用例 2（手动分支不回归）：orbit 模式释放链完整', () => {
        loadCameraVmd({} as MmdAnimation, 'D:/vmd/test.vmd', 'test.vmd');
        const cam = shared.MmdCam.instances[0];
        // mode='orbit' 且 SUT 侧回调为 beforeEach 的 no-op → 手动分支
        clearCameraVmd();

        // 手动分支既有 P2 行为不回归：池条目仍恰好 1 次
        expect(cam.destroyRuntimeAnimation).toHaveBeenCalledTimes(1);
        expect(cam.destroyRuntimeAnimation).toHaveBeenCalledWith('h1');
        // GPU 资源手动释放链
        expect(shared.state.scene!.removeCamera).toHaveBeenCalledTimes(1);
        expect(shared.state.scene!.removeCamera).toHaveBeenCalledWith(cam);
        expect(cam.dispose).toHaveBeenCalledTimes(1);
        expect(shared.state.clearCameraVmdState).toHaveBeenCalledTimes(1);
    });

    it('用例 3（无 handle 不调）：createVmdCamera 无动画源 → destroyRuntimeAnimation 0 次', () => {
        // _mmdAnimation 为 null → 建相机但 _cameraAnimationHandle=null
        createVmdCamera();
        expect(hasCameraAnimationHandle()).toBe(false);
        const cam = shared.MmdCam.instances[0];
        // 无动画源时不绑定 runtime animation
        expect(cam.setRuntimeAnimation).not.toHaveBeenCalled();

        setCameraMode('vmd');
        const spyOrbit = vi.fn();
        setSwitchCameraModeCallback(spyOrbit);
        clearCameraVmd();

        // oldHandle===null 守卫：不触发池条目释放，但回调与状态清零照常
        expect(cam.destroyRuntimeAnimation).not.toHaveBeenCalled();
        expect(spyOrbit).toHaveBeenCalledTimes(1);
        expect(spyOrbit).toHaveBeenCalledWith('orbit');
        expect(shared.state.clearCameraVmdState).toHaveBeenCalledTimes(1);
    });
});
