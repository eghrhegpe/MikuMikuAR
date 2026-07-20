// scene-migrate.ts — 旧存档 → 新状态迁移函数（纯函数，无 scene 依赖）
// 从 scene-serialize.ts 拆分

import type { ProcMotionState } from '../motion-algos/procedural-motion';
import type { PerceptionState } from '../scene/motion/perception';

/**
 * 旧存档 lipSync → 新版 PerceptionState lipSync 字段。
 * 纯函数，无外部依赖。
 */
export function migrateLipSyncFromOldState(old: {
    lipSync?: {
        enabled?: boolean;
        sensitivity?: number;
        intensity?: number;
        multiMorphEnabled?: boolean;
    };
}): {
    lipSyncEnabled: boolean;
    lipSyncSensitivity: number;
    lipSyncIntensity: number;
    lipSyncMultiMorphEnabled: boolean;
} {
    const l = old.lipSync;
    if (!l) {
        return {
            lipSyncEnabled: false,
            lipSyncSensitivity: 0.2,
            lipSyncIntensity: 0.8,
            lipSyncMultiMorphEnabled: false,
        };
    }
    return {
        lipSyncEnabled: l.enabled ?? false,
        lipSyncSensitivity: l.sensitivity ?? 0.2,
        lipSyncIntensity: l.intensity ?? 0.8,
        lipSyncMultiMorphEnabled: l.multiMorphEnabled ?? false,
    };
}

/**
 * 旧存档 ProcMotionState → 新版 PerceptionState 迁移。
 * 纯函数，无外部依赖。
 */
export function migratePerceptionFromProcMotion(
    old: Partial<ProcMotionState> & {
        lipSync?: {
            enabled?: boolean;
            sensitivity?: number;
            intensity?: number;
            multiMorphEnabled?: boolean;
        };
    }
): Partial<PerceptionState> {
    const t = old.boneToggles;
    const lipSync = migrateLipSyncFromOldState(old);
    // 旧存档 boneToggles 任一躯干微动开关为 true → balanceSwayEnabled=true；
    // 否则默认 true（与 DEFAULT_PERCEPTION_STATE 一致，always-on 语义）
    // [doc:adr-079] Phase 2：center/upper2/waist/allParent 已迁入感知层
    const hasBalanceToggles = !!(t?.center || t?.upper2 || t?.waist || t?.allParent);
    const balanceSwayEnabled = t == null ? true : hasBalanceToggles;
    return {
        eyeTrackingEnabled: old.eyeTrackingEnabled ?? true,
        headTrackingEnabled: old.headTrackingEnabled ?? true,
        blinkEnabled: t?.blink ?? true,
        breathEnabled: true,
        microExpressionEnabled: t?.emotion ?? true,
        emotion: 'neutral',
        balanceSwayEnabled,
        lipSyncEnabled: lipSync.lipSyncEnabled,
        lipSyncSensitivity: lipSync.lipSyncSensitivity,
        lipSyncIntensity: lipSync.lipSyncIntensity,
        lipSyncMultiMorphEnabled: lipSync.lipSyncMultiMorphEnabled,
    };
}