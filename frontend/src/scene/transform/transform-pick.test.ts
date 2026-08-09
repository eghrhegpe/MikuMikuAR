// transform-pick.test.ts — 拾取管线：元数据链遍历（纯）+ pick 后处理 + attach 编排
// 目标：transform-pick.ts 覆盖率 3.7%（全仓最大洼地）→ 高覆盖。
// getTransformMetadata 是纯逻辑（metadata/parent 鸭子形状，零 Babylon 依赖）。
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
    attachGizmoForKind: vi.fn(),
    getGizmoTargetId: vi.fn(),
    setSelectedTransformTarget: vi.fn(),
}));

vi.mock('./transform-adapter', () => ({
    attachGizmoForKind: mocks.attachGizmoForKind,
    getGizmoTargetId: mocks.getGizmoTargetId,
}));
vi.mock('./transform-selection', () => ({
    setSelectedTransformTarget: mocks.setSelectedTransformTarget,
}));

import {
    getTransformMetadata,
    setTransformMetadata,
    pickTransformTarget,
    tryAttachGizmoFromPick,
} from './transform-pick';
import type { Node } from '@babylonjs/core/node';

const meta = (transformKind: string, transformId: string) => ({ transformKind, transformId });

/** 构造 Node 鸭子对象：metadata + parent 链（isPickable 仅 Mesh 有，测试桩放宽）。 */
type TestNode = Node & { isPickable?: boolean };
const node = (metadata: unknown, parent: unknown = null): TestNode => ({ metadata, parent } as TestNode);

// ═══════════════════════════════════════════════════════
// getTransformMetadata — 元数据链向上遍历（纯逻辑）
// ═══════════════════════════════════════════════════════
describe('getTransformMetadata（元数据链遍历）', () => {
    it('自身命中返回 kind/id', () => {
        const n = node(meta('actor', 'm1'));
        expect(getTransformMetadata(n)).toEqual({ transformKind: 'actor', transformId: 'm1' });
    });

    it('自身无 meta 时沿 parent 链向上命中', () => {
        const parent = node(meta('light', 'l1'));
        const child = node(null, parent);
        const grandchild = node({ other: 1 }, child);
        expect(getTransformMetadata(grandchild)).toEqual({
            transformKind: 'light',
            transformId: 'l1',
        });
    });

    it('全链无 meta 返回 null', () => {
        const a = node(null);
        const b = node({ transformKind: undefined }, a);
        expect(getTransformMetadata(b)).toBeNull();
    });

    it('meta 残缺（缺 transformId）不命中', () => {
        const n = node({ transformKind: 'actor' });
        expect(getTransformMetadata(n)).toBeNull();
    });

    it('null 输入返回 null', () => {
        expect(getTransformMetadata(null)).toBeNull();
    });
});

// ═══════════════════════════════════════════════════════
// setTransformMetadata — 元数据写入（merge 语义）
// ═══════════════════════════════════════════════════════
describe('setTransformMetadata', () => {
    it('无既有 metadata 时写入 transform 字段', () => {
        const n = node(undefined);
        setTransformMetadata(n, 'mirror', 'mirror-1');
        expect(n.metadata).toEqual({ transformKind: 'mirror', transformId: 'mirror-1' });
    });

    it('有既有 metadata 时合并保留', () => {
        const n = node({ existing: 1 });
        setTransformMetadata(n, 'light', 'l1');
        expect(n.metadata).toEqual({ existing: 1, transformKind: 'light', transformId: 'l1' });
    });
});

// ═══════════════════════════════════════════════════════
// pickTransformTarget — pick 结果解析（fake scene，不依赖 Babylon）
// ═══════════════════════════════════════════════════════
describe('pickTransformTarget', () => {
    const makeScene = (pickInfo: unknown) => ({
        pick: vi.fn((_x: number, _y: number, _p: (m: Node) => boolean) => pickInfo),
    });

    /** 用特定 mesh 触发拾取，返回谓词对该 mesh 的判定结果（谓词在前置过滤即决定命中）。 */
    const judgePickable = (mesh: Node): boolean | null => {
        let result: boolean | null = null;
        const scene = {
            pick: vi.fn((_x: number, _y: number, p: (m: Node) => boolean) => {
                result = p(mesh);
                return { hit: false, pickedMesh: null };
            }),
        };
        pickTransformTarget(scene as never, 0, 0);
        return result;
    };

    it('pick 未命中返回 null', () => {
        const scene = makeScene({ hit: false, pickedMesh: null });
        expect(pickTransformTarget(scene as never, 0, 0)).toBeNull();
    });

    it('命中但 pickedMesh 无元数据返回 null', () => {
        const scene = makeScene({ hit: true, pickedMesh: node(null) });
        expect(pickTransformTarget(scene as never, 0, 0)).toBeNull();
    });

    it('命中且带元数据返回 kind/id', () => {
        const scene = makeScene({ hit: true, pickedMesh: node(meta('light', 'l1')) });
        expect(pickTransformTarget(scene as never, 0, 0)).toEqual({ kind: 'light', id: 'l1' });
    });

    it('拾取谓词：不可拾取但带元数据的 mesh 也命中', () => {
        const picked = node(meta('actor', 'm1'));
        picked.isPickable = false;
        expect(judgePickable(picked)).toBe(true);
    });

    it('拾取谓词：可拾取 mesh 直接命中，无元数据也放行', () => {
        const picked = node(null);
        picked.isPickable = true;
        expect(judgePickable(picked)).toBe(true);
    });

    it('拾取谓词：不可拾取且无元数据被排除', () => {
        const picked = node(null);
        picked.isPickable = false;
        expect(judgePickable(picked)).toBe(false);
    });
});

// ═══════════════════════════════════════════════════════
// tryAttachGizmoFromPick — 拾取后挂载编排（adapter/selection 隔离）
// ═══════════════════════════════════════════════════════
describe('tryAttachGizmoFromPick', () => {
    beforeEach(() => {
        mocks.attachGizmoForKind.mockReset();
        mocks.getGizmoTargetId.mockReset();
        mocks.setSelectedTransformTarget.mockReset();
    });

    it('未命中返回 false，不挂载不选中', () => {
        const scene = { pick: vi.fn(() => ({ hit: false, pickedMesh: null })) };
        expect(tryAttachGizmoFromPick(scene as never, 0, 0)).toBe(false);
        expect(mocks.attachGizmoForKind).not.toHaveBeenCalled();
        expect(mocks.setSelectedTransformTarget).not.toHaveBeenCalled();
    });

    it('已挂同一目标时短路返回 true，不重复挂载', () => {
        const scene = { pick: vi.fn(() => ({ hit: true, pickedMesh: node(meta('actor', 'm1')) })) };
        mocks.getGizmoTargetId.mockReturnValue('m1');
        expect(tryAttachGizmoFromPick(scene as never, 0, 0)).toBe(true);
        expect(mocks.attachGizmoForKind).not.toHaveBeenCalled();
    });

    it('挂载成功时同步选中态并返回 true', () => {
        const scene = { pick: vi.fn(() => ({ hit: true, pickedMesh: node(meta('light', 'l1')) })) };
        mocks.getGizmoTargetId.mockReturnValue(null);
        mocks.attachGizmoForKind.mockReturnValue(true);
        expect(tryAttachGizmoFromPick(scene as never, 0, 0)).toBe(true);
        expect(mocks.attachGizmoForKind).toHaveBeenCalledWith('light', 'l1');
        expect(mocks.setSelectedTransformTarget).toHaveBeenCalledWith({ kind: 'light', id: 'l1' });
    });

    it('挂载失败时不同步选中态并返回 false', () => {
        const scene = { pick: vi.fn(() => ({ hit: true, pickedMesh: node(meta('actor', 'm1')) })) };
        mocks.getGizmoTargetId.mockReturnValue(null);
        mocks.attachGizmoForKind.mockReturnValue(false);
        expect(tryAttachGizmoFromPick(scene as never, 0, 0)).toBe(false);
        expect(mocks.setSelectedTransformTarget).not.toHaveBeenCalled();
    });
});
