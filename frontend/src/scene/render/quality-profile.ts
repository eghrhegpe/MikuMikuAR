// [doc:adr-130] quality-profile — 统一质量档位解析器
// 职责: qualityProfile（high/medium/low）→ 各域质量设置映射
// 性能系统写入 qualityProfile 作为单一聚合源，各域从此解析派生产出

export type QualityProfile = 'high' | 'medium' | 'low';

/** 反射质量映射：profile → reflectionQuality */
const REFLECTION_QUALITY: Record<QualityProfile, 'high' | 'medium' | 'low' | 'off'> = {
    high: 'high',
    medium: 'medium',
    low: 'low',
};

/** 云质量映射：profile → cloudQuality */
const CLOUD_QUALITY: Record<QualityProfile, 'standard' | 'high'> = {
    high: 'high',
    medium: 'high',
    low: 'standard',
};

export interface QualityProfileSettings {
    reflectionQuality: 'high' | 'medium' | 'low' | 'off';
    groundReflectionQuality: 'high' | 'medium' | 'low' | 'off';
    cloudQuality: 'standard' | 'high';
}

/**
 * 将 qualityProfile 解析为各域质量设置。
 * 供性能系统降级时写入，也供 UI 展示当前档位对应的各域值。
 */
export function resolveQualityProfile(profile: QualityProfile): QualityProfileSettings {
    return {
        reflectionQuality: REFLECTION_QUALITY[profile],
        groundReflectionQuality: REFLECTION_QUALITY[profile],
        cloudQuality: CLOUD_QUALITY[profile],
    };
}

/**
 * 从 EnvState 的独立质量字段反推当前 qualityProfile。
 * 预设场景加载后同步 qualityProfile 时使用。
 * 若各域不一致则返回 'high'（保守默认）。
 */
export function inferQualityProfile(
    reflectionQuality: string,
    groundReflectionQuality: string,
    cloudQuality: string
): QualityProfile {
    // 逐档检查：从低到高，全匹配才返回
    const profiles: QualityProfile[] = ['low', 'medium', 'high'];
    for (const p of profiles) {
        if (
            REFLECTION_QUALITY[p] === reflectionQuality &&
            REFLECTION_QUALITY[p] === groundReflectionQuality &&
            CLOUD_QUALITY[p] === cloudQuality
        ) {
            return p;
        }
    }
    return 'high';
}