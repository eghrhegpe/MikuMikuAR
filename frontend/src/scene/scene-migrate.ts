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
    return {
        eyeTrackingEnabled: old.eyeTrackingEnabled ?? true,
        headTrackingEnabled: old.headTrackingEnabled ?? true,
        blinkEnabled: t?.blink ?? true,
        breathEnabled: true,
        microExpressionEnabled: t?.emotion ?? true,
        emotion: 'neutral',
        lipSyncEnabled: lipSync.lipSyncEnabled,
        lipSyncSensitivity: lipSync.lipSyncSensitivity,
        lipSyncIntensity: lipSync.lipSyncIntensity,
        lipSyncMultiMorphEnabled: lipSync.lipSyncMultiMorphEnabled,
    };
}