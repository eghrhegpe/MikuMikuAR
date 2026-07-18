// [doc:adr-121] 全局动作意图（Scene-level Motion Intent）
// 职责: 场景级 activeMotion 意图 + 每实例继承/覆盖 + 广播/兼容性解析
// 设计: 轻量 singleton（非 EnvState），规避 Go struct 同步 + wails 绑定重生成本
// 依赖方向: 不 import 任何 UI 模块；由 broadcastMotion 遍历 modelRegistry 写入 inst.vmd*

import type { SceneMotionIntent, ModelMotionAssignment } from '@/core/types';

// ── 场景级 store（轻量 singleton，非 EnvState）──

let _activeMotion: SceneMotionIntent | null = null; // null = none（静态）

/** 获取当前场景级动作意图。null = 静态（无动作）。 */
export function getActiveMotion(): SceneMotionIntent | null {
    return _activeMotion;
}

// ── 广播回调（调用方注册，避免循环依赖）──

let _broadcastCallback: ((intent: SceneMotionIntent | null) => void) | null = null;

/**
 * 注册广播回调。由调用方（如 motion-popup）在初始化时注册一次。
 * 回调负责遍历 modelRegistry 并按每实例 assignment 策略应用意图。
 * 回调模式避免 motion-intent 直接依赖 scene 模块。
 */
export function setBroadcastCallback(cb: ((intent: SceneMotionIntent | null) => void) | null): void {
    _broadcastCallback = cb;
}

/**
 * 设置场景级动作意图并触发广播。
 * @param intent 意图对象，null 表示清除（静态场景）
 */
export function setActiveMotion(intent: SceneMotionIntent | null): void {
    _activeMotion = intent;
    _broadcastCallback?.(intent);
}

/**
 * 兼容性解析：判断指定模型骨骼是否兼容某 VMD 动作。
 * 复用 proc-motion-shared.matchBone 进行骨骼名匹配。
 * @param modelId 目标模型 ID
 * @param intent  待解析的动作意图
 * @returns 兼容性结果
 */
export function resolveCompatibility(
    modelId: string,
    intent: SceneMotionIntent | null
): { compatible: boolean; reason?: string } {
    if (!intent) {
        return { compatible: true }; // null = 静态，始终兼容
    }
    // P1 实现：读取 modelId 的骨骼列表，通过 matchBone 匹配 VMD 骨骼名
    // 当前返回骨架——默认兼容，P1 接入真实 matchBone 逻辑
    return { compatible: true };
}