// [doc:adr-121] 全局动作意图（Scene-level Motion Intent）
// 职责: 场景级 activeMotion 意图 + 每实例继承/覆盖 + 广播/兼容性解析
// 设计: 轻量 singleton（非 EnvState），规避 Go struct 同步 + wails 绑定重生成本
// 依赖方向: 不 import 任何 UI 模块；由 broadcastMotion 遍历 modelRegistry 写入 inst.vmd*

import type { SceneMotionIntent, ModelMotionAssignment } from '@/core/types';
import { matchBone } from '@/motion-algos/proc-motion-shared';

// ── 场景级 store（轻量 singleton，非 EnvState）──

let _activeMotion: SceneMotionIntent | null = null; // null = none（静态）
let _motionGen = 0; // generation counter，每次 setActiveMotion 递增，用于守护异步广播竞态

/** 获取当前场景级动作意图。null = 静态（无动作）。 */
export function getActiveMotion(): SceneMotionIntent | null {
    return _activeMotion;
}

/** 获取当前 generation 值。用于异步操作中判断是否为最新广播。 */
export function getMotionGen(): number {
    return _motionGen;
}

// ── 广播回调（调用方注册，避免循环依赖）──

let _broadcastCallback: ((intent: SceneMotionIntent | null, gen: number, prev: SceneMotionIntent | null) => void) | null = null;
let _callbackInitialized = false;

/**
 * 初始化广播回调。由 bootstrap 点（如 scene.ts initScene）调用一次。
 * 回调负责遍历 modelRegistry 并按每实例 assignment 策略应用意图。
 * 回调模式避免 motion-intent 直接依赖 scene 模块。
 * 幂等守卫：多次调用不重复注册。
 */
export function initMotionIntent(cb: (intent: SceneMotionIntent | null, gen: number, prev: SceneMotionIntent | null) => void): void {
    if (_callbackInitialized) return;
    _broadcastCallback = cb;
    _callbackInitialized = true;
}

/**
 * @deprecated 请使用 initMotionIntent() 替代。此函数仅保留供测试覆写。
 */
export function setBroadcastCallback(cb: ((intent: SceneMotionIntent | null, gen: number, prev: SceneMotionIntent | null) => void) | null): void {
    _broadcastCallback = cb;
}

/**
 * 设置场景级动作意图并触发广播。
 * @param intent 意图对象，null 表示清除（静态场景）
 */
export function setActiveMotion(intent: SceneMotionIntent | null): void {
    const prev = _activeMotion; // 捕获前一个意图，供广播回调判断清除范围
    _activeMotion = intent;
    _motionGen++;
    _broadcastCallback?.(intent, _motionGen, prev);
}

// ── 兼容性解析 ──

/** 标准 MMD 骨骼候选集（用于快速兼容性判定） */
const STANDARD_MMD_BONES = [
    '全ての親', 'センター', 'グルーブ', '腰',
    '上半身', '下半身', '頭',
    '右肩', '右腕', '右ひじ', '右手首',
    '左肩', '左腕', '左ひじ', '左手首',
    '右足', '右ひざ', '右足首',
    '左足', '左ひざ', '左足首',
    '首', '両目', 'まぶた',
    '左目', '右目', '下あご',
];

/**
 * 兼容性解析：判断指定模型的骨骼列表是否兼容某 VMD 动作。
 * 复用 proc-motion-shared.matchBone 进行骨骼名匹配。
 * @param actualBones 模型的实际骨骼名列表
 * @param intent      待解析的动作意图
 * @param customBones 可选的 VMD 自定义骨骼候选集（不传则用标准 MMD 骨骼）
 * @returns 兼容性结果
 */
export function resolveCompatibility(
    actualBones: string[],
    intent: SceneMotionIntent | null,
    customBones?: string[]
): { compatible: boolean; reason?: string } {
    if (!intent) {
        return { compatible: true }; // null = 静态，始终兼容
    }
    if (actualBones.length === 0) {
        return { compatible: false, reason: '模型无骨骼数据' };
    }
    // 用候选集匹配：传 customBones 则优先使用，否则用标准 MMD 骨骼
    const candidates = customBones ?? STANDARD_MMD_BONES;
    // 要求至少匹配到 3 个标准骨骼才算兼容（防止误判非人形模型）
    let matchCount = 0;
    for (const candidate of candidates) {
        if (matchBone(actualBones, [candidate])) {
            matchCount++;
            if (matchCount >= 3) break;
        }
    }
    if (matchCount < 3) {
        return {
            compatible: false,
            reason: `仅匹配到 ${matchCount}/3 个标准骨骼，不兼容当前动作`,
        };
    }
    return { compatible: true };
}