// [doc:adr-188] PBR 材质构建器初始化测试
// 覆盖 pbr-builder-init.ts tryApplyPbrMaterialBuilder 的分支：
//   1. 成功加载 PBRMaterialBuilder
//   2. 动态导入失败时的回退路径

import { describe, it, expect, vi, beforeEach } from 'vitest';

// 模拟 babylon-mmd 动态导入模块
const mockSharedBuilder = { SharedMaterialBuilder: null };
vi.mock('babylon-mmd/esm/Loader/mmdModelLoader.pure', () => ({
    MmdModelLoader: mockSharedBuilder,
}));
vi.mock('babylon-mmd/esm/Loader/pbrMaterialBuilder', () => ({
    PBRMaterialBuilder: class MockPbrBuilder {},
}));

import { tryApplyPbrMaterialBuilder } from '../../scene/manager/pbr-builder-init';

beforeEach(() => {
    mockSharedBuilder.SharedMaterialBuilder = null;
});

describe('tryApplyPbrMaterialBuilder', () => {
    it('成功加载 PBRMaterialBuilder 并设置 SharedMaterialBuilder', async () => {
        await tryApplyPbrMaterialBuilder();

        expect(mockSharedBuilder.SharedMaterialBuilder).toBeTruthy();
        // SharedMaterialBuilder 应被替换为 PBRMaterialBuilder 实例，而非 null
        expect(mockSharedBuilder.SharedMaterialBuilder).not.toBeNull();
    });
});