// @vitest-environment node
// [doc:adr-188] PBR 材质构建器初始化测试
// 覆盖 pbr-builder-init.ts tryApplyPbrMaterialBuilder 的分支：
//   1. 成功加载 PBRMaterialBuilder
//   2. 动态导入失败时的回退路径（[audit:round46 P2] 此前头注释声称覆盖但实际零用例，已补）

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

    it('PBRMaterialBuilder 构造抛错 → 回退 Standard（SharedMaterialBuilder 保持 null，不抛）', async () => {
        // [audit:round46 P2] 回退路径（源码 L21-23 catch）此前零覆盖。
        // vi.doMock 覆盖 pbrMaterialBuilder 为构造抛错版本 + resetModules 重绑 SUT，
        // 验证 catch 吞错且不产生半更新状态。
        vi.doMock('babylon-mmd/esm/Loader/pbrMaterialBuilder', () => ({
            PBRMaterialBuilder: class Boom {
                constructor() {
                    throw new Error('pbr load fail');
                }
            },
        }));
        vi.resetModules();
        const { tryApplyPbrMaterialBuilder: sut2 } = await import(
            '../../scene/manager/pbr-builder-init'
        );
        await expect(sut2()).resolves.toBeUndefined();
        expect(mockSharedBuilder.SharedMaterialBuilder).toBeNull();
    });
});