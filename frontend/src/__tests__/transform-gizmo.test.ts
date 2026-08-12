// @vitest-environment node
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

    it('防御：未知类型 → 0（禁用语义，不传播 undefined 到 snapDistance）', () => {
        expect(gizmo.computeSnapDistance('foo' as never, true, 1)).toBe(0);
        expect(gizmo.computeSnapDistance('foo' as never, false, 1)).toBe(0);
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

    it('边界：types 为空 → 返回 true 但不创建 gizmo', () => {
        gizmo.initTransformGizmo(scene);
        const ok = gizmo.attachGizmo({ id: 'empty', node, types: [] });
        expect(ok).toBe(true);
        expect(shared.PositionGizmo).not.toHaveBeenCalled();
        expect(shared.RotationGizmo).not.toHaveBeenCalled();
        expect(shared.ScaleGizmo).not.toHaveBeenCalled();
        expect(gizmo.getActiveGizmoTypes()).toEqual([]);
    });

    it('边界：types 含重复项 → 同类仅建一个（修复泄漏）', () => {
        gizmo.initTransformGizmo(scene);
        const ok = gizmo.attachGizmo({
            id: 'dup',
            node,
            types: ['position', 'position', 'scale', 'position'],
        });
        expect(ok).toBe(true);
        expect(shared.PositionGizmo).toHaveBeenCalledTimes(1); // 重复项只建一个，无泄漏
        expect(shared.ScaleGizmo).toHaveBeenCalledTimes(1);
        expect(gizmo.getActiveGizmoTypes()).toEqual(['position', 'scale']);
    });

    it('守卫：拖拽中二次 attach → flush 旧 gizmo 回写一次', () => {
        const onPosEndA = vi.fn();
        const onPosEndB = vi.fn();
        gizmo.initTransformGizmo(scene);
        gizmo.attachGizmo({ id: 'a', node, types: ['position'], onPositionDragEnd: onPosEndA });
        dragStartCb(shared.PositionGizmo)();
        expect(gizmo.isGizmoDragging()).toBe(true);
        // attachGizmo 内部先 detach → 拖拽中 flush 旧回写，再建新 gizmo
        gizmo.attachGizmo({ id: 'b', node, types: ['position'], onPositionDragEnd: onPosEndB });
        expect(onPosEndA).toHaveBeenCalledWith(node);
        expect(onPosEndB).not.toHaveBeenCalled(); // 新 gizmo 尚未拖拽
        expect(gizmo.getGizmoTargetId()).toBe('b');
        expect(gizmo.isGizmoDragging()).toBe(false);
    });

    it('正常：detach 后重新 attach → 重建 layer', () => {
        gizmo.initTransformGizmo(scene);
        gizmo.attachGizmo({ id: 'a', node, types: ['position'] });
        gizmo.detachGizmo();
        gizmo.attachGizmo({ id: 'b', node, types: ['position'] });
        // detachGizmo dispose layer → 重新 attach 创建新 layer
        expect(shared.UtilityLayerRenderer).toHaveBeenCalledTimes(2);
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

    it('守卫：拖拽中 detach 后再 detach → 回写仅 flush 一次（幂等）', () => {
        const onPositionDragEnd = vi.fn();
        gizmo.initTransformGizmo(scene);
        gizmo.attachGizmo({ id: 'i', node, types: ['position'], onPositionDragEnd });
        dragStartCb(shared.PositionGizmo)();
        gizmo.detachGizmo();
        expect(onPositionDragEnd).toHaveBeenCalledTimes(1);
        gizmo.detachGizmo();
        expect(onPositionDragEnd).toHaveBeenCalledTimes(1); // 不重复 flush
    });

    it('守卫：drag-end 用户回调抛异常 → 拖拽态已复位不卡死（fix P3）', () => {
        const boom = vi.fn(() => {
            throw new Error('boom');
        });
        gizmo.initTransformGizmo(scene);
        gizmo.attachGizmo({ id: 'e', node, types: ['position'], onPositionDragEnd: boom });
        dragStartCb(shared.PositionGizmo)();
        expect(gizmo.isGizmoDragging()).toBe(true);
        expect(() => dragEndCb(shared.PositionGizmo)(node)).toThrow('boom');
        // 回调内部先复位 _isDragging 再调用户回调 → 异常不卡拖拽态
        expect(gizmo.isGizmoDragging()).toBe(false);
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

    it('正常：先 set 配置再 attach → 新 gizmo 应用当前配置', () => {
        gizmo.initTransformGizmo(scene);
        gizmo.setGizmoSnapDistance(true, 2);
        gizmo.attachGizmo({ id: 'pre', node, types: ['position', 'rotation', 'scale'] });
        expect(lastInstance(shared.PositionGizmo).snapDistance).toBe(2);
        expect(lastInstance(shared.RotationGizmo).snapDistance).toBeCloseTo(2 * (Math.PI / 12));
        expect(lastInstance(shared.ScaleGizmo).snapDistance).toBeCloseTo(0.2);
    });

    it('边界：默认配置 enabled=false, step=1', () => {
        expect(gizmo.getGizmoSnapConfig()).toEqual({ enabled: false, step: 1 });
    });

    it('守卫：无激活 gizmo 时 set 不崩', () => {
        expect(() => gizmo.setGizmoSnapDistance(true, 5)).not.toThrow();
        expect(gizmo.getGizmoSnapConfig()).toEqual({ enabled: true, step: 5 });
    });
});

describe('onGizmoDragObservable（连续拖拽通知）', () => {
    it('正常：拖拽中 → notifyObservers 被调用', () => {
        gizmo.initTransformGizmo(scene);
        gizmo.attachGizmo({ id: 'd', node, types: ['position'] });
        const spy = vi.spyOn(gizmo.onGizmoDragObservable, 'notifyObservers');
        dragCb(shared.PositionGizmo)();
        expect(spy).toHaveBeenCalled();
    });
});

describe('attachGizmo 拖拽中 flush 的异常与多回调（边界）', () => {
    it('守卫：拖拽中二次 attach 时 flush 回调抛异常 → attach 不崩且 logWarn', () => {
        const boom = vi.fn(() => {
            throw new Error('boom');
        });
        gizmo.initTransformGizmo(scene);
        gizmo.attachGizmo({ id: 'a', node, types: ['position'], onPositionDragEnd: boom });
        dragStartCb(shared.PositionGizmo)();
        expect(gizmo.isGizmoDragging()).toBe(true);
        // attachGizmo 内部 detachGizmo → flush [boom] 抛异常 → 捕获 logWarn 后继续建新 gizmo
        expect(() =>
            gizmo.attachGizmo({ id: 'b', node, types: ['position'] })
        ).not.toThrow();
        expect(shared.logWarn).toHaveBeenCalled();
        expect(gizmo.getGizmoTargetId()).toBe('b');
        expect(gizmo.isGizmoDragging()).toBe(false);
    });

    it('正常：多类型 drag-end 回调在拖拽中 detach 时全部 flush 一次', () => {
        const onPos = vi.fn();
        const onRot = vi.fn();
        const onScl = vi.fn();
        gizmo.initTransformGizmo(scene);
        gizmo.attachGizmo({
            id: 'm',
            node,
            types: ['position', 'rotation', 'scale'],
            onPositionDragEnd: onPos,
            onRotationDragEnd: onRot,
            onScaleDragEnd: onScl,
        });
        dragStartCb(shared.PositionGizmo)();
        expect(gizmo.isGizmoDragging()).toBe(true);
        gizmo.detachGizmo();
        expect(onPos).toHaveBeenCalledTimes(1);
        expect(onRot).toHaveBeenCalledTimes(1);
        expect(onScl).toHaveBeenCalledTimes(1);
        expect(onPos).toHaveBeenCalledWith(node);
    });

    it('守卫：正常拖拽结束后 detach → 不再重复 flush 回调', () => {
        const onPos = vi.fn();
        gizmo.initTransformGizmo(scene);
        gizmo.attachGizmo({ id: 'd', node, types: ['position'], onPositionDragEnd: onPos });
        dragStartCb(shared.PositionGizmo)();
        dragEndCb(shared.PositionGizmo)(node); // 正常结束 → onPos 一次
        expect(onPos).toHaveBeenCalledTimes(1);
        gizmo.detachGizmo(); // 非拖拽中（_isDragging=false）→ 不 flush
        expect(onPos).toHaveBeenCalledTimes(1);
    });
});

describe('computeSnapDistance 零/负 step 边界', () => {
    it('边界：step=0 → snapDistance=0（Babylon 禁用语义）', () => {
        expect(gizmo.computeSnapDistance('position', true, 0)).toBe(0);
        expect(gizmo.computeSnapDistance('rotation', true, 0)).toBe(0);
        expect(gizmo.computeSnapDistance('scale', true, 0)).toBe(0);
    });

    it('边界：负 step → 返回负 snapDistance（不崩，调用方应避免）', () => {
        expect(gizmo.computeSnapDistance('position', true, -2)).toBe(-2);
        expect(gizmo.computeSnapDistance('rotation', true, -2)).toBeCloseTo(
            -2 * (Math.PI / 12)
        );
    });
});

describe('attachGizmo types 含未知类型（边界）', () => {
    it('边界：types 混入未知类型 → 忽略且不泄漏不崩', () => {
        gizmo.initTransformGizmo(scene);
        const ok = gizmo.attachGizmo({
            id: 'u',
            node,
            types: ['position', 'foo' as never, 'bar' as never],
        });
        expect(ok).toBe(true);
        expect(shared.PositionGizmo).toHaveBeenCalledTimes(1);
        expect(shared.RotationGizmo).not.toHaveBeenCalled();
        expect(shared.ScaleGizmo).not.toHaveBeenCalled();
        expect(gizmo.getActiveGizmoTypes()).toEqual(['position']);
        expect(gizmo.getGizmoTargetId()).toBe('u');
    });

    it('边界：types 仅含未知类型 → 不创建 gizmo 但 id 仍记录', () => {
        gizmo.initTransformGizmo(scene);
        const ok = gizmo.attachGizmo({ id: 'only', node, types: ['nope' as never] });
        expect(ok).toBe(true);
        expect(shared.PositionGizmo).not.toHaveBeenCalled();
        expect(shared.RotationGizmo).not.toHaveBeenCalled();
        expect(shared.ScaleGizmo).not.toHaveBeenCalled();
        expect(gizmo.getActiveGizmoTypes()).toEqual([]);
        expect(gizmo.isGizmoActive()).toBe(true);
        expect(gizmo.getGizmoTargetId()).toBe('only');
    });
});
