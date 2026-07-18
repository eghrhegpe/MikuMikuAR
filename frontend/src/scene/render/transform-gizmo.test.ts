// [doc:adr-126] Phase 3 — 网格吸附配置单测（隔离，无需 Babylon Scene）
import { describe, it, expect, beforeEach } from 'vitest';
import { getGizmoSnapConfig, setGizmoSnapDistance, computeSnapDistance } from './transform-gizmo';

describe('transform-gizmo grid snap (ADR-126 Phase 3)', () => {
    beforeEach(() => {
        // 复位为默认（关闭、步长 1.0），避免与其他用例状态串扰
        setGizmoSnapDistance(false, 1.0);
    });

    it('默认关闭、步长 1.0', () => {
        const c = getGizmoSnapConfig();
        expect(c.enabled).toBe(false);
        expect(c.step).toBe(1.0);
    });

    it('setGizmoSnapDistance(true) 启用并保留步长', () => {
        setGizmoSnapDistance(true);
        const c = getGizmoSnapConfig();
        expect(c.enabled).toBe(true);
        expect(c.step).toBe(1.0); // 未传 step 时保持默认
    });

    it('setGizmoSnapDistance(true, 2.5) 同时更新步长', () => {
        setGizmoSnapDistance(true, 2.5);
        const c = getGizmoSnapConfig();
        expect(c.enabled).toBe(true);
        expect(c.step).toBe(2.5);
    });

    it('setGizmoSnapDistance(false) 关闭但保留步长（供下次启用沿用）', () => {
        setGizmoSnapDistance(true, 3.0);
        setGizmoSnapDistance(false);
        const c = getGizmoSnapConfig();
        expect(c.enabled).toBe(false);
        expect(c.step).toBe(3.0);
    });
});

describe('computeSnapDistance 三轴派生 (ADR-126 Phase 3 审计 P4)', () => {
    it('position → step（场景单位，网格对齐为主）', () => {
        expect(computeSnapDistance('position', true, 2)).toBe(2);
        expect(computeSnapDistance('position', true, 0.5)).toBe(0.5);
    });

    it('rotation → step·π/12（step=1 → 15°）', () => {
        expect(computeSnapDistance('rotation', true, 1)).toBeCloseTo(Math.PI / 12, 10);
        expect(computeSnapDistance('rotation', true, 2)).toBeCloseTo((Math.PI / 12) * 2, 10);
    });

    it('scale → step·0.1（step=1 → 0.1 缩放增量）', () => {
        expect(computeSnapDistance('scale', true, 1)).toBeCloseTo(0.1, 10);
        expect(computeSnapDistance('scale', true, 3)).toBeCloseTo(0.3, 10);
    });

    it('enabled=false → 0（禁用吸附，三轴一致）', () => {
        expect(computeSnapDistance('position', false, 5)).toBe(0);
        expect(computeSnapDistance('rotation', false, 5)).toBe(0);
        expect(computeSnapDistance('scale', false, 5)).toBe(0);
    });
});
