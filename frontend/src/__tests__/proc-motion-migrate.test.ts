// [audit] per-mode 参数迁移测试：旧扁平 ProcMotionState → 新嵌套结构。
import { describe, it, expect } from 'vitest';
import { migrateProcState, DEFAULT_PROC_STATE } from '../motion-algos/procedural-motion';

describe('migrateProcState（旧扁平 → per-mode 嵌套）', () => {
    it('旧扁平数据：拆分到 idle/autodance 两模式（同值，等价旧行为）', () => {
        const old = {
            mode: 'idle' as const,
            intensity: 0.3,
            speed: 0.8,
            boneToggles: { ...DEFAULT_PROC_STATE.params.idle.boneToggles, arm: false },
            vpdApplyEnabled: true,
            interpOverride: 'sharp' as const,
            bpmQuantizeEnabled: false,
            eyeTrackingEnabled: false,
            headTrackingEnabled: true,
        };
        const s = migrateProcState(old);
        expect(s.mode).toBe('idle');
        expect(s.bpmQuantizeEnabled).toBe(false);
        expect(s.eyeTrackingEnabled).toBe(false);
        expect(s.headTrackingEnabled).toBe(true);
        expect(s.params.idle.intensity).toBe(0.3);
        expect(s.params.idle.speed).toBe(0.8);
        expect(s.params.idle.boneToggles.arm).toBe(false);
        expect(s.params.idle.interpOverride).toBe('sharp');
        expect(s.params.idle.vpdApplyEnabled).toBe(true);
        // autodance 同值（旧数据无 per-mode 区分）
        expect(s.params.autodance.intensity).toBe(0.3);
        expect(s.params.autodance.boneToggles.arm).toBe(false);
        // 两模式引用独立
        expect(s.params.idle).not.toBe(s.params.autodance);
    });

    it('新嵌套结构：原样保留 per-mode 差异', () => {
        const fresh = {
            mode: 'autodance' as const,
            bpmQuantizeEnabled: true,
            eyeTrackingEnabled: true,
            headTrackingEnabled: true,
            params: {
                idle: { ...DEFAULT_PROC_STATE.params.idle, intensity: 0.2 },
                autodance: { ...DEFAULT_PROC_STATE.params.autodance, intensity: 0.9 },
            },
        };
        const s = migrateProcState(fresh);
        expect(s.params.idle.intensity).toBe(0.2);
        expect(s.params.autodance.intensity).toBe(0.9);
    });

    it('undefined / 空对象：返回默认', () => {
        const s = migrateProcState(undefined);
        expect(s.params.idle.intensity).toBe(DEFAULT_PROC_STATE.params.idle.intensity);
        expect(s.params.autodance.speed).toBe(DEFAULT_PROC_STATE.params.autodance.speed);
    });

    it('部分字段（缺 boneToggles）：其余取默认', () => {
        const partial = { mode: 'idle' as const, intensity: 0.7 };
        const s = migrateProcState(partial);
        expect(s.params.idle.intensity).toBe(0.7);
        expect(s.params.idle.boneToggles.arm).toBe(true); // 默认
        expect(s.params.autodance.intensity).toBe(0.7);
    });

    it('P3#1 回归：新结构 boneToggles 部分覆盖时逐类别补默认（不静默关闭其余类别）', () => {
        const s = migrateProcState({
            mode: 'idle' as const,
            params: {
                idle: { intensity: 0.3, boneToggles: { arm: false } as Record<string, boolean> },
                autodance: { intensity: 0.9, boneToggles: { wrist: false } as Record<string, boolean> },
            },
        });
        // idle：仅 arm 显式关闭，其余类别应保持默认 true（修复前其余类别变 undefined）
        expect(s.params.idle.boneToggles.arm).toBe(false);
        expect(s.params.idle.boneToggles.center).toBe(true);
        expect(s.params.idle.boneToggles.footIk).toBe(true);
        // autodance：仅 wrist 关闭，其余默认
        expect(s.params.autodance.boneToggles.wrist).toBe(false);
        expect(s.params.autodance.boneToggles.center).toBe(true);
    });

    it('P3#1 回归：新结构两模式 boneToggles 引用独立（不共享 _fallbackParams）', () => {
        const s = migrateProcState({
            mode: 'idle' as const,
            params: { idle: {}, autodance: {} },
        });
        expect(s.params.idle.boneToggles).not.toBe(s.params.autodance.boneToggles);
        s.params.idle.boneToggles.arm = false;
        expect(s.params.autodance.boneToggles.arm).toBe(true);
    });
});
