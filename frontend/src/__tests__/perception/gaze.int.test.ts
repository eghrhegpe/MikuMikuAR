// perception/gaze.int.test.ts — 视线追踪锥形限位 + _gazeAlpha 指数衰减 + gaze reset（ADR-204 P3，拆自旧 perception.test.ts）
import { describe, it, expect, vi, beforeEach } from 'vitest';
// 只引 math.vector 子路径：包根 @babylonjs/core 会拖全量 index（实测 import 1.59s），
// SUT 链路（perception-shared）也只用该子路径，依赖图共享、成本 ~60ms 级。
import { Quaternion } from '@babylonjs/core/Maths/math.vector';

const mockState = vi.hoisted(() => ({
    focusedModelId: null as string | null,
    triggerAutoSave: vi.fn(),
    modelManager: {
        get: vi.fn(),
        modelRegistry: new Map<string, any>(),
    },
    scene: {
        onBeforeRenderObservable: {
            add: vi.fn(() => ({})),
            remove: vi.fn(),
        },
        activeCamera: null,
        isDisposed: false,
    },
    isAudioPlaying: vi.fn(() => false),
    getAudioPath: vi.fn(() => ''),
    getProcBeatDetector: vi.fn(() => null),
    findLipMorph: vi.fn(() => null),
    findAllLipMorphs: vi.fn(() => ({ open: null, close: null, pucker: null, smile: null })),
    amplitudeToWeight: vi.fn(() => 0),
}));
const mockPipeline = vi.hoisted(() => ({
    register: vi.fn(),
    unregister: vi.fn(),
    lastRunCallback: null as null | ((ctx?: any) => void),
}));

vi.mock('../../scene/scene', () => sceneModuleFactory(mockState));
vi.mock('../../ar/ar-camera', () => arCameraModuleMock);
vi.mock('../../core/wails-bindings', () => wailsBindingsModuleMock);
vi.mock('../../core/i18n/t', () => i18nTModuleMock);
vi.mock('@babylonjs/core/Materials/standardMaterial', () => standardMaterialModuleMock);
vi.mock('../../core/config', () => configModuleFactory(mockState));
vi.mock('../../scene/camera/camera', () => cameraModuleMock);
vi.mock('../../scene/motion/vmd-loader', () => vmdLoaderModuleMock);
vi.mock('@/core/audio', () => outfitAudioModuleFactory(mockState));
vi.mock('@/scene/manager/outfit', () => outfitModuleMock);
vi.mock('../../scene/env/props', () => envPropsModuleMock);
vi.mock('../../scene/env/_bridge/env-bridge', () => envBridgeModuleMock);
vi.mock('../../scene/env/env-impl', () => envImplModuleFactory(mockState));
vi.mock('../../scene/motion/motion-pipeline', () => motionPipelineModuleFactory(mockPipeline));
vi.mock('../../scene/motion/proc-motion-bridge', () => procMotionBridgeModuleFactory(mockState));
vi.mock('../../scene/motion/lipsync-bridge', () => lipsyncBridgeModuleMock);
vi.mock('../../motion-algos/procedural-motion', () => proceduralMotionModuleMock);
vi.mock('../../motion-algos/lipsync', () => lipsyncAlgosModuleFactory(mockState));

// _gazeAlpha 为纯函数，静态导入
import { _gazeAlpha } from '../../scene/motion/perception-shared';
import {
    setupPerceptionTest,
    sceneModuleFactory,
    arCameraModuleMock,
    wailsBindingsModuleMock,
    i18nTModuleMock,
    standardMaterialModuleMock,
    configModuleFactory,
    cameraModuleMock,
    vmdLoaderModuleMock,
    outfitAudioModuleFactory,
    outfitModuleMock,
    envPropsModuleMock,
    envBridgeModuleMock,
    envImplModuleFactory,
    motionPipelineModuleFactory,
    procMotionBridgeModuleFactory,
    lipsyncBridgeModuleMock,
    proceduralMotionModuleMock,
    lipsyncAlgosModuleFactory,
    type PerceptionSut,
} from './perception-mocks';

let sut: PerceptionSut;

beforeEach(async () => {
    sut = await setupPerceptionTest(mockState, mockPipeline);
});

// ── 视线追踪锥形限位回归（防止"背后翻转 180°"悄悄回潮）──
describe('视线追踪锥形限位（_clampHeadGazeTarget / _clampEyeGazeTarget）', () => {
    const parentWorldQ = Quaternion.Identity(); // 身体/头部正前、正立

    it('头部：背后相机时被钳到 ±≈75°（而非翻转 180°）', () => {
        const behindQ = Quaternion.FromEulerAngles(0, Math.PI, 0);
        const e = sut
            ._clampHeadGazeTarget(Quaternion.Identity(), behindQ, parentWorldQ)
            .toEulerAngles();
        expect(Math.abs(e.y)).toBeGreaterThan((70 * Math.PI) / 180);
        expect(Math.abs(e.y)).toBeLessThan((80 * Math.PI) / 180);
        expect(Math.abs(e.x)).toBeLessThan(1e-3);
    });

    it('头部：正前方相机时保持正前（不钳制）', () => {
        const frontQ = Quaternion.FromEulerAngles(0, 0, 0);
        const e = sut
            ._clampHeadGazeTarget(Quaternion.Identity(), frontQ, parentWorldQ)
            .toEulerAngles();
        expect(Math.abs(e.y)).toBeLessThan(1e-3);
        expect(Math.abs(e.x)).toBeLessThan(1e-3);
    });

    it('头部：俯仰被钳到 ±≈35°，不向上翻 180°', () => {
        const upQ = Quaternion.FromEulerAngles(Math.PI / 2, 0, 0);
        const e = sut
            ._clampHeadGazeTarget(Quaternion.Identity(), upQ, parentWorldQ)
            .toEulerAngles();
        expect(Math.abs(e.x)).toBeGreaterThan((30 * Math.PI) / 180);
        expect(Math.abs(e.x)).toBeLessThan((40 * Math.PI) / 180);
        expect(Math.abs(e.y)).toBeLessThan(1e-3);
    });

    it('眼球：背后相机时被钳到 ±≈9°（而非翻转 180°）', () => {
        const behindQ = Quaternion.FromEulerAngles(0, Math.PI, 0);
        const e = sut
            ._clampEyeGazeTarget(Quaternion.Identity(), behindQ, parentWorldQ)
            .toEulerAngles();
        expect(Math.abs(e.y)).toBeGreaterThan((4 * Math.PI) / 180);
        expect(Math.abs(e.y)).toBeLessThan((14 * Math.PI) / 180);
        expect(Math.abs(e.x)).toBeLessThan(1e-3);
    });

    it('眼球：俯仰被钳到 ±≈8°，不向上翻 180°', () => {
        const upQ = Quaternion.FromEulerAngles(Math.PI / 2, 0, 0);
        const e = sut._clampEyeGazeTarget(Quaternion.Identity(), upQ, parentWorldQ).toEulerAngles();
        expect(Math.abs(e.x)).toBeGreaterThan((3 * Math.PI) / 180);
        expect(Math.abs(e.x)).toBeLessThan((13 * Math.PI) / 180);
        expect(Math.abs(e.y)).toBeLessThan(1e-3);
    });

    it('眼球限位比头部更紧（9° < 75°）：同样背后目标，眼幅更小', () => {
        const behindQ = Quaternion.FromEulerAngles(0, Math.PI, 0);
        const eyeYaw = Math.abs(
            sut._clampEyeGazeTarget(Quaternion.Identity(), behindQ, parentWorldQ).toEulerAngles().y
        );
        const headYaw = Math.abs(
            sut._clampHeadGazeTarget(Quaternion.Identity(), behindQ, parentWorldQ).toEulerAngles().y
        );
        expect(eyeYaw).toBeLessThan(headYaw);
    });
});

// ── ADR-150: Gaze Delta 指数衰减 ──
describe('_gazeAlpha', () => {
    it('60fps 与 120fps 下收敛速度一致', () => {
        const alpha60 = _gazeAlpha(0.5, 1 / 60);
        const alpha120 = _gazeAlpha(0.5, 1 / 120);
        // 120fps 单帧 alpha 约为 60fps 的一半（指数衰减特性）
        expect(alpha120).toBeCloseTo(alpha60 / 2, 2);
    });

    it('边界值 dt=0 时 alpha=0', () => {
        expect(_gazeAlpha(0.5, 0)).toBe(0);
    });

    it('边界值 dt 极大时 alpha 被钳到 1', () => {
        expect(_gazeAlpha(0.5, 10)).toBe(1);
    });
});

describe('gaze reset', () => {
    it('deactivatePerception 时调用 _resetGazeState', () => {
        mockState.focusedModelId = 'm1';
        mockState.modelManager.get.mockReturnValue({
            mmdModel: { mesh: { isDisposed: () => false } },
        });
        const before = sut._getGazeResetTick();
        sut.activatePerception('m1');
        const afterActivate = sut._getGazeResetTick();
        sut.deactivatePerception();
        const afterDeactivate = sut._getGazeResetTick();
        // activatePerception 内部先调 deactivatePerception（+1），再直接调 _resetGazeState（+1）
        expect(afterActivate).toBe(before + 2);
        expect(afterDeactivate).toBe(afterActivate + 1);
    });

    it('setHeadTrackingEnabled 切换时调用 _resetGazeState', () => {
        const before = sut._getGazeResetTick();
        sut.setHeadTrackingEnabled(false);
        expect(sut._getGazeResetTick()).toBe(before + 1);
    });

    it('setEyeTrackingEnabled 切换时调用 _resetGazeState', () => {
        const before = sut._getGazeResetTick();
        sut.setEyeTrackingEnabled(false);
        expect(sut._getGazeResetTick()).toBe(before + 1);
    });
});
