// transform-gizmo.test.ts — 变换 Gizmo（移动/旋转/缩放）单测（ADR-048 / ADR-126）
// 覆盖 computeSnapDistance 三轴派生、initTransformGizmo 场景重建守卫、
// attachGizmo 独占策略/拖拽回调/吸附应用、detachGizmo 拖拽中 flush 回写、
// 查询函数与 setGizmoSnapDistance 实时生效。
// mock 全部 Babylon.js 对象（PositionGizmo/RotationGizmo/ScaleGizmo/UtilityLayerRenderer/
// Observable）+ dispose-helpers/logger，隔离真实实例化。
// 说明：模块级单例状态通过 vi.resetModules() + 动态 import 每测重置，保证隔离。

import { describe, it, expect, vi, beforeEach } from 'vitest';

const shared = vi.hoisted(() => {
    const makeObservable = () => ({
        add: vi.fn(),
        remove: vi.fn(),
        notifyObservers: vi.fn(),
        observers: [] as unknown[],
    });
    const makeGizmo = () => ({
        attachedNode: null,
        snapDistance: 0,
        onDragStartObservable: makeObservable(),
        onDragEndObservable: makeObservable(),
        onDragObservable: makeObservable(),
        dispose: vi.fn(),
    });
    const PositionGizmo = vi.fn(function () {
        return makeGizmo();
    });
    const RotationGizmo = vi.fn(function () {
        return makeGizmo();
    });
    const ScaleGizmo = vi.fn(function () {
        return makeGizmo();
    });
    const UtilityLayerRenderer = vi.fn(function () {
        return { shouldRender: false, dispose: vi.fn() };
    });
    const Observable = vi.fn(function () {
        return makeObservable();
    });
    const safeDispose = vi.fn((o: any) => {
        o?.dispose();
        return null;
    });
    const logWarn = vi.fn();
    return {
        PositionGizmo,
        RotationGizmo,
        ScaleGizmo,
        UtilityLayerRenderer,
        Observable,
        safeDispose,
        logWarn,
    };
});

vi.mock('@babylonjs/core/Gizmos/positionGizmo', () => ({ PositionGizmo: shared.PositionGizmo }));
vi.mock('@babylonjs/core/Gizmos/rotationGizmo', () => ({ RotationGizmo: shared.RotationGizmo }));
vi.mock('@babylonjs/core/Gizmos/scaleGizmo', () => ({ ScaleGizmo: shared.ScaleGizmo }));
vi.mock('@babylonjs/core/Rendering/utilityLayerRenderer', () => ({
    UtilityLayerRenderer: shared.UtilityLayerRenderer,
}));
vi.mock('@babylonjs/core/Misc/observable', () => ({ Observable: shared.Observable }));
vi.mock('@/core/dispose-helpers', () => ({ safeDispose: shared.safeDispose }));
vi.mock('@/core/logger', () => ({ logWarn: shared.logWarn }));

type GizmoModule = typeof import('../scene/render/transform-gizmo');
let gizmo: GizmoModule;

const scene = { id: 'scene' } as never;
const node = { id: 'node' } as never;

function lastInstance(ctor: ReturnType<typeof vi.fn>): any {
    return ctor.mock.instances[ctor.mock.instances.length - 1];
}

function dragEndCb(ctor: ReturnType<typeof vi.fn>): (n: never) => void {
    const g = lastInstance(ctor);
    return g.onDragEndObservable.add.mock.calls[0][0];
}

function dragStartCb(ctor: ReturnType<typeof vi.fn>): () => void {
    const g = lastInstance(ctor);
    return g.onDragStartObservable.add.mock.calls[0][0];
}

function dragCb(ctor: ReturnType<typeof vi.fn>): () => void {
    const g = lastInstance(ctor);
    return g.onDragObservable.add.mock.calls[0][0];
}

beforeEach(async () => {
    vi.resetModules();
    vi.clearAllMocks();
    gizmo = await import('../scene/render/transform-gizmo');
});

describe('computeSnapDistance（三轴吸附派生）', () => {
    it('正常：enabled=false → 0（Babylon 禁用语义）', () => {
        expect(gizmo.computeSnapDistance('position', false, 1)).toBe(0);
        expect(gizmo.computeSnapDistance('rotation', false, 1)).toBe(0);
        expect(gizmo.computeSnapDistance('scale', false, 1)).toBe(0);
    });

    it('正常：position → 场景单位步长', () => {
        expect(gizmo.computeSnapDistance('position', true, 1)).toBe(1);
        expect(gizmo.computeSnapDistance('position', true, 2.5)).toBe(2.5);
    });

    it('正常：rotation → step×π/12（step=1 → 15°）', () => {
        expect(gizmo.computeSnapDistance('rotation', true, 1)).toBeCloseTo(Math.PI / 12);
        expect(gizmo.computeSnapDistance('rotation', true, 2)).toBeCloseTo(2 * (Math.PI / 12));
    });

    it('正常：scale → step×0.1', () => {
        expect(gizmo.computeSnapDistance('scale', true, 1)).toBeCloseTo(0.1);
        expect(gizmo.computeSnapDistance('scale', true, 3)).toBeCloseTo(0.3);
    });
});

describe('initTransformGizmo（场景重建守卫）', () => {
    it('守卫：同一场景 → 不重置（不 dispose 既有 gizmo）', () => {
        gizmo.initTransformGizmo(scene);
        shared.safeDispose.mockClear();
        gizmo.initTransformGizmo(scene);
        expect(shared.safeDispose).not.toHaveBeenCalled();
    });

    it('正常：场景变化 → 释放旧 gizmo/layer 并重置状态', () => {
        gizmo.initTransformGizmo(scene);
        gizmo.attachGizmo({ id: 'm1', node, types: ['position'] });
        expect(gizmo.isGizmoActive()).toBe(true);

        const scene2 = { id: 'scene2' } as never;
        gizmo.initTransformGizmo(scene2);
        expect(shared.safeDispose).toHaveBeenCalled();
        expect(gizmo.isGizmoActive()).toBe(false);
        expect(gizmo.isGizmoDragging()).toBe(false);
        expect(gizmo.getGizmoTargetId()).toBeNull();
    });
});

describe('attachGizmo（创建/绑定/独占）', () => {
    it('守卫：未 init 场景 → 返回 false', () => {
        expect(gizmo.attachGizmo({ id: 'n', node, types: ['position'] })).toBe(false);
        expect(shared.PositionGizmo).not.toHaveBeenCalled();
    });

    it('正常：position 绑定 + 吸附 + 拖拽回调', () => {
        const onPositionDragEnd = vi.fn();
        gizmo.initTransformGizmo(scene);
        const ok = gizmo.attachGizmo({
            id: 'm1',
            node,
            types: ['position'],
            onPositionDragEnd,
        });
        expect(ok).toBe(true);
        expect(shared.PositionGizmo).toHaveBeenCalledTimes(1);
        const g = lastInstance(shared.PositionGizmo);
        expect(g.attachedNode).toBe(node);
        expect(g.snapDistance).toBe(0); // 默认吸附关闭
        expect(gizmo.getGizmoTargetId()).toBe('m1');
        expect(gizmo.getGizmoNode()).toBe(node);
        expect(gizmo.isGizmoActive()).toBe(true);
        expect(gizmo.getActiveGizmoTypes()).toEqual(['position']);

        // drag start → dragging true
        dragStartCb(shared.PositionGizmo)();
        expect(gizmo.isGizmoDragging()).toBe(true);
        // drag end → dragging false + 回写回调
        dragEndCb(shared.PositionGizmo)(node);
        expect(gizmo.isGizmoDragging()).toBe(false);
        expect(onPositionDragEnd).toHaveBeenCalledWith(node);
        // drag 连续 → 通知 observable
        dragCb(shared.PositionGizmo)();
        expect(shared.Observable).toHaveBeenCalled();
    });

    it('正常：rotation 全自由度 + 回调', () => {
        const onRotationDragEnd = vi.fn();
        gizmo.initTransformGizmo(scene);
        gizmo.attachGizmo({ id: 'r1', node, types: ['rotation'], onRotationDragEnd });
        expect(shared.RotationGizmo).toHaveBeenCalledTimes(1);
        expect(shared.RotationGizmo).toHaveBeenCalledWith(expect.anything(), 32, true);
        const g = lastInstance(shared.RotationGizmo);
        expect(g.attachedNode).toBe(node);
        dragEndCb(shared.RotationGizmo)(node);
        expect(onRotationDragEnd).toHaveBeenCalledWith(node);
        expect(gizmo.getActiveGizmoTypes()).toEqual(['rotation']);
    });

    it('正常：scale gizmo + 回调', () => {
        const onScaleDragEnd = vi.fn();
        gizmo.initTransformGizmo(scene);
        gizmo.attachGizmo({ id: 's1', node, types: ['scale'], onScaleDragEnd });
        expect(shared.ScaleGizmo).toHaveBeenCalledTimes(1);
        const g = lastInstance(shared.ScaleGizmo);
        expect(g.attachedNode).toBe(node);
        dragEndCb(shared.ScaleGizmo)(node);
        expect(onScaleDragEnd).toHaveBeenCalledWith(node);
        expect(gizmo.getActiveGizmoTypes()).toEqual(['scale']);
    });

    it('正常：多类型组合 → 全部激活', () => {
        gizmo.initTransformGizmo(scene);
        gizmo.attachGizmo({ id: 'all', node, types: ['position', 'rotation', 'scale'] });
        expect(gizmo.getActiveGizmoTypes()).toEqual(['position', 'rotation', 'scale']);
    });

    it('守卫：独占策略 — 二次 attach 自动 detach 上一个', () => {
        gizmo.initTransformGizmo(scene);
        gizmo.attachGizmo({ id: 'a', node, types: ['position'] });
        const first = lastInstance(shared.PositionGizmo);
        gizmo.attachGizmo({ id: 'b', node, types: ['rotation'] });
        expect(first.dispose).toHaveBeenCalled();
        expect(gizmo.getGizmoTargetId()).toBe('b');
        expect(gizmo.getActiveGizmoTypes()).toEqual(['rotation']);
    });
});

describe('detachGizmo（清理 + 拖拽 flush）', () => {
    it('正常：释放 gizmo/layer 并重置状态', () => {
        gizmo.initTransformGizmo(scene);
        gizmo.attachGizmo({ id: 'x', node, types: ['position', 'rotation', 'scale'] });
        gizmo.detachGizmo();
        expect(shared.safeDispose).toHaveBeenCalled();
        expect(gizmo.isGizmoActive()).toBe(false);
        expect(gizmo.getGizmoTargetId()).toBeNull();
        expect(gizmo.getGizmoNode()).toBeNull();
        expect(gizmo.getActiveGizmoTypes()).toEqual([]);
    });

    it('守卫：拖拽中 detach → flush 一次 drag-end 回写', () => {
        const onPositionDragEnd = vi.fn();
        gizmo.initTransformGizmo(scene);
        gizmo.attachGizmo({ id: 'y', node, types: ['position'], onPositionDragEnd });
        dragStartCb(shared.PositionGizmo)();
        expect(gizmo.isGizmoDragging()).toBe(true);
        gizmo.detachGizmo();
        expect(onPositionDragEnd).toHaveBeenCalledWith(node);
        expect(gizmo.isGizmoDragging()).toBe(false);
    });

    it('守卫：flush 回调抛异常 → logWarn 且不崩', () => {
        const boom = vi.fn(() => {
            throw new Error('boom');
        });
        gizmo.initTransformGizmo(scene);
        gizmo.attachGizmo({ id: 'z', node, types: ['position'], onPositionDragEnd: boom });
        dragStartCb(shared.PositionGizmo)();
        expect(() => gizmo.detachGizmo()).not.toThrow();
        expect(shared.logWarn).toHaveBeenCalled();
    });

    it('守卫：未 attach 时 detach 幂等不崩', () => {
        expect(() => gizmo.detachGizmo()).not.toThrow();
    });
});

describe('setGizmoSnapDistance / getGizmoSnapConfig（实时生效）', () => {
    it('正常：enabled+step 实时作用于当前 gizmo', () => {
        gizmo.initTransformGizmo(scene);
        gizmo.attachGizmo({ id: 's', node, types: ['position', 'rotation', 'scale'] });
        gizmo.setGizmoSnapDistance(true, 2);
        expect(lastInstance(shared.PositionGizmo).snapDistance).toBe(2);
        expect(lastInstance(shared.RotationGizmo).snapDistance).toBeCloseTo(2 * (Math.PI / 12));
        expect(lastInstance(shared.ScaleGizmo).snapDistance).toBeCloseTo(0.2);
        expect(gizmo.getGizmoSnapConfig()).toEqual({ enabled: true, step: 2 });
    });

    it('正常：step 缺省 → 沿用上次 step', () => {
        gizmo.initTransformGizmo(scene);
        gizmo.attachGizmo({ id: 's', node, types: ['position'] });
        gizmo.setGizmoSnapDistance(true, 5);
        gizmo.setGizmoSnapDistance(true);
        expect(lastInstance(shared.PositionGizmo).snapDistance).toBe(5);
        expect(gizmo.getGizmoSnapConfig()).toEqual({ enabled: true, step: 5 });
    });

    it('正常：disabled → snapDistance=0（禁用吸附）', () => {
        gizmo.initTransformGizmo(scene);
        gizmo.attachGizmo({ id: 's', node, types: ['position'] });
        gizmo.setGizmoSnapDistance(true, 3);
        gizmo.setGizmoSnapDistance(false);
        expect(lastInstance(shared.PositionGizmo).snapDistance).toBe(0);
        expect(gizmo.getGizmoSnapConfig()).toEqual({ enabled: false, step: 3 });
    });

    it('边界：默认配置 enabled=false, step=1', () => {
        expect(gizmo.getGizmoSnapConfig()).toEqual({ enabled: false, step: 1 });
    });
});