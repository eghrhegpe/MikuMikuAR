// model-ops 拆分共享 mock
//
// 关键约束（沿用 motion-modules-registry / model-preset 已验证模式）：
//  - mockModelManager 用普通 const（createMockModelManager()）而非 vi.hoisted，工厂延迟调用引用它，
//    规避 vi.hoisted 结果不能 export 跨文件。每个测试文件各自持有独立实例（vitest 文件隔离）。
//  - DOM 元素预建必须在 import '../core/config'（其 dom.ts 顶层读 DOM）之前完成，故各测试文件保留
//    自包含的内联 vi.hoisted(() => {...createElement...}) 块（不能引用 import，故不抽进本模块）。
//  - babylon math 用 vi.importActual 加载本地 mock 类，特殊性保留在各测试文件内联 vi.mock。
//  - 其余 6 个 vi.mock 工厂在此收敛为同步函数，mocks 导入须排在 SUT/helpers 之前。
import { vi } from 'vitest';

export function createMockModelManager() {
    return {
        focus: vi.fn(),
        arrange: vi.fn(),
        setVisibility: vi.fn(),
        setOpacity: vi.fn(),
        setWireframe: vi.fn(),
        setBoneLinesVis: vi.fn(),
        setBoneJointsVis: vi.fn(),
        setPhysics: vi.fn(),
        getPhysicsCategories: vi.fn().mockReturnValue([]),
        getPhysicsCatState: vi.fn().mockReturnValue(null),
        isPhysicsCategoryEnabled: vi.fn().mockReturnValue(false),
        setPhysicsCategory: vi.fn(),
        setScaling: vi.fn(),
        setRotationY: vi.fn(),
        setPosition: vi.fn(),
        getPosition: vi.fn().mockReturnValue([0, 0, 0]),
        resetTransform: vi.fn(),
        clearVmdData: vi.fn(),
        getMorphs: vi.fn().mockReturnValue([]),
        setMorphWeight: vi.fn(),
        getMorphWeight: vi.fn().mockReturnValue(0),
        resetMorphs: vi.fn(),
        remove: vi.fn(),
    };
}

// 模块加载期即创建的共享单例：mockModelManager 必须在 vi.mock 工厂被求值时已就绪
// （vi.mock 工厂只能引用 imported 绑定，不能引用 vi.hoisted 内调用导入函数的结果）。
// vitest 按文件隔离模块注册表，故每个测试文件持有独立 modelOpsShared 实例（无跨文件泄漏）。
export const modelOpsShared = {
    mockModelManager: createMockModelManager(),
};

export function mockSceneModule(mm: ReturnType<typeof createMockModelManager>) {
    return {
        get modelManager() {
            return mm;
        },
    };
}

export function mockMaterial() {
    return {
        _catState: {},
        _matState: {},
        _matEnabled: false,
        disposeModelMaterialState: vi.fn(),
    };
}

export function mockEnv() {
    return { refreshWaterRenderList: vi.fn() };
}

export function mockCamera() {
    return { getCameraMode: vi.fn(() => 'orbit'), switchCameraMode: vi.fn() };
}

export function mockPlayback() {
    return { updatePlaybackUI: vi.fn() };
}

export function mockAudio() {
    return { disposeAudio: vi.fn() };
}
