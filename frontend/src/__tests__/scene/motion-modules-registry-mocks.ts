// motion-modules-registry 拆分共享 mock
//
// 关键约束（沿用 model-preset 已验证模式）：
//  - 工厂函数均为**延迟调用**（vi.mock 工厂惰性执行，import 完成后才调用），
//    故可安全引用 import 的 shared 单例与 vi.fn，规避「vi.hoisted 结果不能 export 跨文件」限制。
//  - mockModelRegistry / mockActiveMotion / pushHistorySpy 必须是**跨工厂共享的单例**：
//    state 模块导出的 modelRegistry 与 SUT 操作的、测试写入的是同一个 Map 实例。
import { vi } from 'vitest';

// 跨用例 / 跨文件共享的单例状态（注册表 + spy）
export const shared = {
    mockModelRegistry: new Map<string, any>(),
    setBoneOverrideSpy: vi.fn(),
    clearBoneOverrideSpy: vi.fn(),
    protectIkPositionSpy: vi.fn(),
    mockActiveMotion: { value: null as any },
    pushHistorySpy: vi.fn(),
    reset(): void {
        this.mockModelRegistry.clear();
        this.setBoneOverrideSpy.mockClear();
        this.clearBoneOverrideSpy.mockClear();
        this.protectIkPositionSpy.mockClear();
        this.mockActiveMotion.value = null;
        this.pushHistorySpy.mockClear();
    },
};

export function mockState(): Record<string, any> {
    return {
        modelRegistry: shared.mockModelRegistry,
        setUIPersistCallback: vi.fn(),
        setThumbnailUpdateCallback: vi.fn(),
    };
}

export function mockBoneOverride(): Record<string, any> {
    return {
        setBoneOverride: shared.setBoneOverrideSpy,
        clearBoneOverride: shared.clearBoneOverrideSpy,
        setBoneOverridePosition: vi.fn(),
        protectIkPosition: shared.protectIkPositionSpy,
        registerBoneOverrideFrameHook: vi.fn(() => () => {}),
        FRAME_HOOK_ORDER: { BODY_POSITION: 5, RIDING: 10, SWAY: 20, HAND_SYMMETRY: 30 },
    };
}

export function mockPerception(): Record<string, any> {
    return { setHeadTrackingEnabled: vi.fn() };
}

export function mockMotionIntent(): Record<string, any> {
    return { getActiveMotion: () => shared.mockActiveMotion.value };
}

export function mockMotionHistory(): Record<string, any> {
    return { pushHistory: shared.pushHistorySpy };
}
