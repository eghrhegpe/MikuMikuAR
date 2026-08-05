// [doc:adr-215] 模型附属关系守护测试
// 覆盖 attachModelToBone / detachModelFromBone / detachChildModels / DAG 校验 / 骨骼 guard，
// 对应 ADR-215 §2.4（DAG/单父/骨骼名 guard）与 §7 不变量（附属不丢失、视觉位置一致、级联销毁）。
//
// 隔离策略：ModelManager 依赖较重（outfit-overlay / env-wetness / material / toast / i18n），
// 全部 mock 为 no-op；Babylon 数学用本地 mock 类并补齐 attach/detach 所需静态方法。
import { describe, it, expect, beforeEach, vi } from 'vitest';

// ── 重依赖 mock（no-op，避免拉起应用层）──
vi.mock('@/scene/manager/outfit-overlay', () => ({
    disposeOverlay: vi.fn(),
    restoreMaterials: vi.fn(),
}));
vi.mock('@/scene/env/env-wetness', () => ({ applyWetnessToInst: vi.fn() }));
vi.mock('../scene/manager/material', () => ({ disposeModelMaterialState: vi.fn() }));
vi.mock('@/core/toast', () => ({ showInfoToast: vi.fn() }));
vi.mock('@/core/feedback', () => ({ feedbackStatus: vi.fn() }));
vi.mock('@/core/i18n/t', () => ({ t: (k: string) => k }));

// ── Babylon 数学 mock（补齐 attach/detach 用到的静态方法）──
vi.mock('@babylonjs/core/Maths/math.vector', async () => {
    const m = await vi.importActual<any>('./mocks/babylon-classes.ts');
    const Q = m.MockQuaternion;
    Q.FromEulerAngles = () => new Q(0, 0, 0, 1);
    Q.FromRotationMatrix = () => new Q(0, 0, 0, 1);
    return { Vector3: m.MockVector3, Quaternion: Q, Matrix: m.MockMatrix };
});

import { ModelManager } from '../scene/manager/model-manager';
import type { ModelInstance } from '../core/config';

// 构造带 attach/detach stub 的 rootMesh。
function makeRootMesh() {
    return {
        position: { set: vi.fn() },
        rotationQuaternion: null as unknown,
        attachToBone: vi.fn(),
        detachFromBone: vi.fn(),
        getWorldMatrix: () => ({
            clone: () => ({
                getTranslation: () => ({ x: 0, y: 0, z: 0 }),
                getRotationMatrix: () => ({}),
            }),
        }),
    };
}

// 构造 ModelInstance stub：actor + 可选 mmdModel（含 runtimeBones）。
function makeInst(id: string, bones: string[] = []): ModelInstance {
    const root = makeRootMesh();
    return {
        id,
        name: id,
        kind: 'actor',
        meshes: [],
        rootMesh: root,
        mmdModel: bones.length
            ? {
                  runtimeBones: bones.map((name) => ({
                      name,
                      // attachModelToBone 读取 linkedBone；给个非空占位即可。
                      linkedBone: { name },
                  })),
              }
            : null,
    } as unknown as ModelInstance;
}

describe('[adr-215] 模型附属关系', () => {
    let mm: ModelManager;

    beforeEach(() => {
        vi.clearAllMocks();
        // scene / triggerAutoSave / autoFrame 均不被附属逻辑使用，传 stub。
        mm = new ModelManager({} as any, vi.fn(), vi.fn());
    });

    function seed(id: string, bones: string[] = []): ModelInstance {
        const inst = makeInst(id, bones);
        mm.modelRegistry.set(id, inst);
        return inst;
    }

    it('骨骼 guard：骨骼不存在时拒绝附属，字段不写入', () => {
        seed('child');
        seed('parent', ['head', 'neck']);
        const ok = mm.attachModelToBone('child', 'parent', 'nonexistent');
        expect(ok).toBe(false);
        expect(mm.get('child')?.parentId).toBeUndefined();
    });

    it('成功附属：写入 parentId/attachedBone/offset/rotation 并调用 attachToBone', () => {
        const child = seed('child');
        seed('parent', ['head']);
        const ok = mm.attachModelToBone('child', 'parent', 'head', [1, 2, 3], [10, 0, 0]);
        expect(ok).toBe(true);
        expect(child.parentId).toBe('parent');
        expect(child.attachedBone).toBe('head');
        expect(child.attachedOffset).toEqual([1, 2, 3]);
        expect(child.attachedRotation).toEqual([10, 0, 0]);
        expect((child.rootMesh as any).attachToBone).toHaveBeenCalledTimes(1);
    });

    it('DAG：自附属（child === parent）被拒绝', () => {
        seed('a', ['bone']);
        const ok = mm.attachModelToBone('a', 'a', 'bone');
        expect(ok).toBe(false);
    });

    it('DAG：直接成环（a→b 后 b→a）被拒绝', () => {
        seed('a', ['bone']);
        seed('b', ['bone']);
        expect(mm.attachModelToBone('a', 'b', 'bone')).toBe(true); // a 附属 b
        // 再让 b 附属 a 会成环 → 拒绝
        expect(mm.attachModelToBone('b', 'a', 'bone')).toBe(false);
        expect(mm.get('b')?.parentId).toBeUndefined();
    });

    it('DAG：多层成环（a→b→c 后 c→a）被拒绝', () => {
        seed('a', ['bone']);
        seed('b', ['bone']);
        seed('c', ['bone']);
        expect(mm.attachModelToBone('a', 'b', 'bone')).toBe(true); // a→b
        expect(mm.attachModelToBone('b', 'c', 'bone')).toBe(true); // b→c
        // c 附属 a：a 已经可达 c（a→b→c），成环 → 拒绝
        expect(mm.attachModelToBone('c', 'a', 'bone')).toBe(false);
        expect(mm.get('c')?.parentId).toBeUndefined();
    });

    it('单父限制：换父需重新 attach，parentId 被覆盖为新父', () => {
        const child = seed('child', []);
        seed('p1', ['head']);
        seed('p2', ['neck']);
        expect(mm.attachModelToBone('child', 'p1', 'head')).toBe(true);
        expect(child.parentId).toBe('p1');
        // 直接再 attach 到 p2（换父）→ parentId 覆盖
        expect(mm.attachModelToBone('child', 'p2', 'neck')).toBe(true);
        expect(child.parentId).toBe('p2');
        expect(child.attachedBone).toBe('neck');
    });

    it('detach：清空附属字段并回到场景坐标', () => {
        const child = seed('child');
        seed('parent', ['head']);
        mm.attachModelToBone('child', 'parent', 'head');
        expect(child.parentId).toBe('parent');
        mm.detachModelFromBone('child');
        expect(child.parentId).toBeUndefined();
        expect(child.attachedBone).toBeUndefined();
        expect((child.rootMesh as any).detachFromBone).toHaveBeenCalled();
    });

    it('级联卸载：detachChildModels 移除所有以该父为 parentId 的子模型', () => {
        seed('parent', ['head']);
        seed('c1');
        seed('c2');
        mm.attachModelToBone('c1', 'parent', 'head');
        mm.attachModelToBone('c2', 'parent', 'head');
        expect(mm.size).toBe(3);
        mm.detachChildModels('parent');
        expect(mm.get('c1')).toBeUndefined();
        expect(mm.get('c2')).toBeUndefined();
        expect(mm.get('parent')).toBeDefined();
    });

    it('reattachAllAttachments：对已有附属字段的实例重建挂载', () => {
        const child = seed('child');
        seed('parent', ['head']);
        // 模拟反序列化：直接写入字段（未真正 attach）
        child.parentId = 'parent';
        child.attachedBone = 'head';
        child.attachedOffset = [0, 1, 0];
        mm.reattachAllAttachments();
        expect((child.rootMesh as any).attachToBone).toHaveBeenCalled();
        expect(child.parentId).toBe('parent');
    });
});
