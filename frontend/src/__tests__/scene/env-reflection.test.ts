// env-reflection.test.ts — ADR-151 修复回归
//
// 验证两处行为修复（纯函数层，无需 Babylon 场景实例）：
//   P2: 非 planar 模式 + reflectionQuality='off' 时地面/水面倒影保底 'low'（不再静默关闭）
//   P3: AR 模式联动反射挂起（setReflectionARSuspended 纯派生覆盖 resolveReflectionMode）
//   P3(code_review): disposeReflection 重置 _arSuspended，防止场景重建后反射静默关闭

import { describe, it, expect, beforeEach, vi } from 'vitest';
// [fix code_review P3] mock getScene 返回 null：disposeReflection 走 else 分支
// （safeDispose observer/probe，均 null 安全），不依赖真实 Babylon 场景
vi.mock('../../scene/env/_shared/env-context', () => ({
    getScene: vi.fn(() => null),
}));
import {
    getPlanarQualityOverride,
    resolveReflectionMode,
    setReflectionARSuspended,
    disposeReflection,
} from '../../scene/env/env-reflection';
import type { EnvState } from '@/core/config';

function baseState(overrides: Partial<EnvState> = {}): EnvState {
    return {
        reflectionMode: 'planar',
        reflectionQuality: 'low',
        qualityProfile: 'high',
        ...overrides,
    } as EnvState;
}

describe('ADR-151 P2: getPlanarQualityOverride 非 planar 模式保底', () => {
    it('reflectionMode=none → off（关闭全部平面反射）', () => {
        expect(getPlanarQualityOverride(baseState({ reflectionMode: 'none' }))).toBe('off');
    });

    it('reflectionMode=planar → 固定 low（控制平面倒影成本，不受 reflectionQuality 影响）', () => {
        expect(
            getPlanarQualityOverride(
                baseState({ reflectionMode: 'planar', reflectionQuality: 'high' })
            )
        ).toBe('low');
        expect(
            getPlanarQualityOverride(
                baseState({ reflectionMode: 'planar', reflectionQuality: 'low' })
            )
        ).toBe('low');
    });

    it('P2 修复: ssr/probe/hybrid + reflectionQuality=off → low（不再静默关闭角色倒影）', () => {
        for (const m of ['ssr', 'probe', 'hybrid'] as const) {
            expect(
                getPlanarQualityOverride(baseState({ reflectionMode: m, reflectionQuality: 'off' }))
            ).toBe('low');
        }
    });

    it('ssr/probe/hybrid + reflectionQuality=high → null（遵循用户显式设置）', () => {
        for (const m of ['ssr', 'probe', 'hybrid'] as const) {
            expect(
                getPlanarQualityOverride(
                    baseState({ reflectionMode: m, reflectionQuality: 'high' })
                )
            ).toBeNull();
        }
    });
});

describe('ADR-151 P3: AR 模式联动反射挂起（纯派生覆盖）', () => {
    beforeEach(() => {
        // 隔离：每个用例前解除挂起
        setReflectionARSuspended(false);
    });

    it('挂起后 resolveReflectionMode 派生为 none，地面/水面倒影关闭', () => {
        setReflectionARSuspended(true);
        expect(resolveReflectionMode(baseState({ reflectionMode: 'hybrid' }))).toBe('none');
        expect(getPlanarQualityOverride(baseState({ reflectionMode: 'hybrid' }))).toBe('off');
    });

    it('恢复后回到用户 reflectionMode（不改写用户值）', () => {
        setReflectionARSuspended(true);
        setReflectionARSuspended(false);
        expect(resolveReflectionMode(baseState({ reflectionMode: 'hybrid' }))).toBe('hybrid');
        expect(
            getPlanarQualityOverride(
                baseState({ reflectionMode: 'hybrid', reflectionQuality: 'off' })
            )
        ).toBe('low');
    });

    it('重复设置同一状态为空操作（不抛错）', () => {
        setReflectionARSuspended(true);
        expect(() => setReflectionARSuspended(true)).not.toThrow();
        expect(resolveReflectionMode(baseState({ reflectionMode: 'planar' }))).toBe('none');
    });

    it('disposeReflection 重置 _arSuspended，场景重建后反射恢复用户模式（code_review P3）', () => {
        // AR 挂起 → disposeReflection（mock getScene=null，走 safeDispose 分支）
        setReflectionARSuspended(true);
        expect(resolveReflectionMode(baseState({ reflectionMode: 'hybrid' }))).toBe('none');
        disposeReflection();
        // 重置后 resolveReflectionMode 回到用户显式模式，反射不再静默关闭
        expect(resolveReflectionMode(baseState({ reflectionMode: 'hybrid' }))).toBe('hybrid');
    });
});
