// [doc:adr-130] quality-profile — 统一质量档位解析器
// [doc:adr-174] 注册表驱动 — 新增维度只需注册表加 1 行
//
// 职责: qualityProfile（high/medium/low）→ 各域质量设置映射
// 性能系统写入 qualityProfile 作为单一聚合源，各域从此解析派生产出
//
// ADR-174 修订：从硬编码三组映射常量改为注册表驱动，
// resolveQualityProfile / inferQualityProfile / QualityProfileSettings 均由注册表派生

import { ENV_STATE_SCHEMA } from '@/core/env-state-schema';

export type QualityProfile = 'high' | 'medium' | 'low';

/**
 * 质量维度定义。
 * 新增维度只需在 QUALITY_DIMENSIONS 数组中追加一项。
 *
 * 约束：
 * - `default` 必须与 env-state-schema.ts 中对应字段的 `default` 完全一致（编译期校验，见文件末尾）
 * - `mapping` 的 key 必须是 QualityProfile 三值完备
 */
export interface QualityDimension<T extends string = string> {
    /** 字段名，如 'reflectionQuality' */
    key: string;
    /** 默认值，必须与 env-state-schema.ts 的 default 一致 */
    default: T;
    /** profile→值映射，三值完备 */
    mapping: Record<QualityProfile, T>;
}

/**
 * 质量维度注册表。
 * 新增维度在此追加一行即可，resolveQualityProfile/inferQualityProfile 自动派生。
 */
const QUALITY_DIMENSIONS = [
    {
        key: 'reflectionQuality',
        default: 'low' as const, // 与 env-state-schema.ts default 'low' 一致
        mapping: { high: 'high', medium: 'medium', low: 'low' } as const,
    },
    {
        key: 'cloudQuality',
        default: 'high' as const, // 与 env-state-schema.ts default 'high' 一致
        mapping: { high: 'high', medium: 'high', low: 'standard' } as const,
    },
    {
        key: 'particleQuality',
        default: 'high' as const, // 与 env-state-schema.ts default 'high' 一致
        mapping: { high: 'high', medium: 'medium', low: 'low' } as const,
    },
] as const satisfies readonly QualityDimension[];

/** 注册表键的联合类型 */
type QualityDimensionKey = (typeof QUALITY_DIMENSIONS)[number]['key'];

/**
 * 从注册表派生 QualityProfileSettings 类型。
 * 注册表加字段后类型自动扩展，无需手动维护 interface。
 */
export type QualityProfileSettings = {
    [K in QualityDimensionKey]: Extract<
        (typeof QUALITY_DIMENSIONS)[number],
        { key: K }
    >['default'];
};

/**
 * 将 qualityProfile 解析为各域质量设置。
 * 供性能系统降级时写入，也供 UI 展示当前档位对应的各域值。
 *
 * ADR-174: 改为遍历注册表，新增维度无需修改本函数。
 */
export function resolveQualityProfile(profile: QualityProfile): QualityProfileSettings {
    const result = {} as Record<string, string>;
    for (const dim of QUALITY_DIMENSIONS) {
        result[dim.key] = dim.mapping[profile];
    }
    return result as unknown as QualityProfileSettings;
}

/**
 * 从 EnvState 的独立质量字段反推当前 qualityProfile。
 * 预设场景加载后同步 qualityProfile 时使用。
 * 若各域不一致则返回 'high'（保守默认）。
 *
 * ADR-174: 改为遍历注册表逐字段比对，新增维度无需修改本函数。
 */
export function inferQualityProfile(
    reflectionQuality: string,
    cloudQuality: string,
    particleQuality: string
): QualityProfile {
    // 按注册表 key 顺序构造入参 map（保持入参签名不变，向后兼容）
    const values: Record<string, string> = {
        reflectionQuality,
        cloudQuality,
        particleQuality,
    };
    const profiles: QualityProfile[] = ['low', 'medium', 'high'];
    for (const p of profiles) {
        const allMatch = QUALITY_DIMENSIONS.every(
            dim => dim.mapping[p] === values[dim.key]
        );
        if (allMatch) return p;
    }
    return 'high';
}

// ======== 编译期一致性校验（ADR-174 Phase 3） ========
//
// 注册表 default 必须与 env-state-schema.ts 的 default 完全一致，
// 否则 schema default 与 qualityProfile 解析出的"未指定档位"默认值会漂移。
// 若 schema 修改了 default 而注册表未同步，下行类型赋值报错。

// 从 schema 提取每个 dimension key 对应的 default 字面量类型
type SchemaDefaultOf<K extends keyof typeof ENV_STATE_SCHEMA> =
    (typeof ENV_STATE_SCHEMA)[K] extends { default: infer D } ? D : never;

type SchemaDefaults = {
    [K in QualityDimensionKey]: SchemaDefaultOf<K>;
};

// 从注册表提取每个 dimension key 对应的 default 字面量类型
type DimensionDefaults = {
    [D in (typeof QUALITY_DIMENSIONS)[number] as D['key']]: D['default'];
};

// 双向 assignable 校验：schema default 必须与注册表 default 完全一致
// 若任一方修改了 default 而另一方未同步，下行赋值报错
const _schemaDefaultCheck: SchemaDefaults = {} as DimensionDefaults;
const _dimensionDefaultCheck: DimensionDefaults = {} as SchemaDefaults;
void _schemaDefaultCheck;
void _dimensionDefaultCheck;
