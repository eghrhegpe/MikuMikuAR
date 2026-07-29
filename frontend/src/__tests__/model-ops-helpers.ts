// model-ops 拆分共享 helpers（纯逻辑，依赖真实 config setters）
// 注意：本模块 import '../core/config'；测试文件在 import 本模块前以 vi.hoisted 预建 DOM，
// vitest 保证 vi.hoisted 在 import 之前执行，故 config 求值（dom.ts 顶层读 DOM）时 DOM 已存在，时序安全。
import { vi } from 'vitest';
import {
    modelRegistry,
    setModelRegistry,
    setIsPlaying,
    setMmdRuntime,
    setFocusedModelId,
} from '../core/config';

export function makeInst(overrides: Record<string, any> = {}): any {
    return {
        id: 'test',
        name: 'TestModel',
        filePath: 'D:/test/test.pmx',
        port: 12345,
        modelDir: 'D:/test',
        kind: 'actor',
        visible: true,
        opacity: 1,
        wireframe: false,
        showBoneLines: false,
        showBoneJoints: false,
        physicsEnabled: true,
        scaling: 1,
        rotationY: 0,
        vmdData: null,
        vmdName: '',
        vmdPath: null,
        animationDuration: 0,
        meshes: [],
        mmdModel: null,
        outfitFile: undefined,
        activeVariant: undefined,
        _origTextures: undefined,
        _origParams: undefined,
        ...overrides,
    };
}

export function resetState(): void {
    vi.clearAllMocks();
    setModelRegistry(new Map());
    setIsPlaying(false);
    setMmdRuntime(null);
}

// 重新导出 config setters，供各测试文件按需调用
export { modelRegistry, setModelRegistry, setIsPlaying, setMmdRuntime, setFocusedModelId };
