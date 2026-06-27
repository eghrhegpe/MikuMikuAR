// lipsync.ts — 实时振幅驱动 LipSync
// [doc:architecture] LipSync 子系统 — 振幅→口型 morph
//
// 每帧从 BeatDetector.getLevel 取人声频段能量 → amplitudeToWeight 映射 → 
// setModelMorphWeight 直写焦点模型的「あ」morph。
// 与 procedural motion 不冲突：前者只控「まばたき」(VMD 帧)，本模块只控「あ」(实时直写)。

export interface LipSyncState {
    enabled: boolean;
    sensitivity: number;  // 0..1，振幅阈值（低于此值视为静音，越大越不敏感）
    intensity: number;    // 0..1，最大张嘴幅度
}

export const DEFAULT_LIPSYNC_STATE: LipSyncState = {
    enabled: false,
    sensitivity: 0.2,
    intensity: 0.8,
};

/** 标准 MMD 口型 morph 候选名（按优先级降序）。
 *  绝大多数 MMD 模型使用「あ」；少数使用片假名「ア」或拉丁字母。 */
const LIP_MORPH_CANDIDATES = ["あ", "ア", "A", "a", "口", "mouth", "open"];

/** 在模型 morph 列表中查找口型 morph，返回首个匹配名。
 *  @param morphNames 模型可用 morph 名集合
 *  @returns 匹配的 morph 名；无匹配返回 null */
export function findLipMorph(morphNames: string[]): string | null {
    const set = new Set(morphNames);
    for (const name of LIP_MORPH_CANDIDATES) {
        if (set.has(name)) return name;
    }
    return null;
}

/** 振幅 → morph 权重映射。
 *  低于 sensitivity 阈值 → 0；否则线性映射到 0..intensity。
 *  @param amplitude 0..1 音频能量（可 >1，会被钳制）
 *  @param sensitivity 0..1 阈值（< 阈值视为静音）
 *  @param intensity 0..1 最大张嘴幅度
 *  @returns 0..intensity 的 morph 权重 */
export function amplitudeToWeight(amplitude: number, sensitivity: number, intensity: number): number {
    if (amplitude < sensitivity) return 0;
    const range = 1 - sensitivity;
    if (range <= 0) return intensity;  // sensitivity=1 边界：amp>=1 时给满
    const t = Math.max(0, Math.min(1, (amplitude - sensitivity) / range));
    return t * intensity;
}
