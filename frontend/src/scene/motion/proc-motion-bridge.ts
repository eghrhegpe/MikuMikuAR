// [doc:architecture] Procedural Motion — 程序化动作系统
// 规范文档: docs/architecture.md §程序化动作
// 职责: Idle / Auto Dance VMD 生成调度、节拍联动
// 视线追踪已迁移至 perception.ts（ADR-071）
//
// [refactor] 8 个模块级 let 收口为 ProcMotionController 类实例。
// 状态封装在类私有字段中，外部不可直接访问；导出函数签名不变，
// 委托到模块级懒单例，外部调用方零改动。
// dispose() 一键清零全部状态并销毁单例，生命周期跟 scene 绑定。
//
// [ADR-237 P1] 三文件拆分：
//   - proc-motion-controller.ts — 状态机核心基类（生成调度/停止/重生成/生命周期）
//   - proc-motion-params.ts — 参数 setter 群 mixin（18 个 setter + 写辅助）
//   - proc-motion-bridge.ts（本文件）— 组合类 + 模块级懒单例 + 转发层
// 转发层导出签名不变，调用方零改动。
//
// [adr-XX per-motion] 参数存储优先级：
//   1. activeMotion.procMotion（随动作走，多角色共享参数）
//   2. _fallbackProcState（无动作时的本地默认值，向后兼容）
// 读取时取优先值，写入时写入 activeMotion（若存在）并同步 fallback。

import {
    ProcMotionState,
    ProcMotionMode,
    ProcModeKey,
    ProcMotionParams,
    ProcMotionBoneCategory,
} from '@/motion-algos/procedural-motion';
import { BeatDetector } from '@/motion-algos/beat-detector';
import { ProcMotionControllerBase } from './proc-motion-controller';
import { ProcMotionParamsMixin } from './proc-motion-params';
import { applyProcMotionModulesToModel } from './motion-modules/registry';
import { modelManager, focusedModel } from '../scene';

// ═══════════════════════════════════════════════════════════
// ProcMotionController — 状态机核心（基类）+ 参数 setter 群（mixin）
// ═══════════════════════════════════════════════════════════

// [ADR-237 P1] 组合：基类（状态机核心）+ mixin（参数 setter 群）。
export class ProcMotionController extends ProcMotionParamsMixin(ProcMotionControllerBase) {}

// ═══════════════════════════════════════════════════════════
// 模块级懒单例 + 导出委托（外部调用方零改动）
// ═══════════════════════════════════════════════════════════

let _ctrl: ProcMotionController | null = null;
function _getCtrl(): ProcMotionController {
    if (!_ctrl) {
        _ctrl = new ProcMotionController();
    }
    return _ctrl;
}

export function isProcVmdActive(): boolean {
    return _getCtrl().isProcVmdActive();
}
export function getProcBeatDetector(): BeatDetector | null {
    return _getCtrl().getProcBeatDetector();
}
export function createProcBeatDetector(): BeatDetector {
    return _getCtrl().createProcBeatDetector();
}
export function stopProcMotion(modelId?: string): void {
    _getCtrl().stopProcMotion(modelId);
}
export function onModelRemoved(id: string): void {
    _getCtrl().onModelRemoved(id);
}
export async function updateProcMotion(): Promise<void> {
    return _getCtrl().updateProcMotion();
}
export function setProcMotionMode(mode: ProcMotionMode): void {
    _getCtrl().setProcMotionMode(mode);
}
export function setProcMotionIntensity(mode: ProcModeKey, v: number): void {
    _getCtrl().setProcMotionIntensity(mode, v);
}
export function setProcMotionSpeed(mode: ProcModeKey, v: number): void {
    _getCtrl().setProcMotionSpeed(mode, v);
}
export function getProcMotionState(): ProcMotionState {
    return _getCtrl().getProcMotionState();
}
export function setProcMotionState(s: ProcMotionState): void {
    _getCtrl().setProcMotionState(s);
}
export function setProcMotionBoneToggle(
    mode: ProcModeKey,
    cat: ProcMotionBoneCategory,
    v: boolean
): void {
    _getCtrl().setProcMotionBoneToggle(mode, cat, v);
}
export function setProcMotionBoneToggles(
    mode: ProcModeKey,
    bt: Partial<Record<ProcMotionBoneCategory, boolean>>
): void {
    _getCtrl().setProcMotionBoneToggles(mode, bt);
}
export function setProcMotionVpdApplyEnabled(mode: ProcModeKey, v: boolean): void {
    _getCtrl().setProcMotionVpdApplyEnabled(mode, v);
}
export function setProcMotionInterpOverride(
    mode: ProcModeKey,
    v: ProcMotionParams['interpOverride']
): void {
    _getCtrl().setProcMotionInterpOverride(mode, v);
}
export function setBpmQuantizeEnabled(v: boolean): void {
    _getCtrl().setBpmQuantizeEnabled(v);
}
export function getBpmQuantizeEnabled(): boolean {
    return _getCtrl().getBpmQuantizeEnabled();
}
export function setProcMotionEyeTrackingEnabled(v: boolean): void {
    _getCtrl().setProcMotionEyeTrackingEnabled(v);
}
export function setProcMotionHeadTrackingEnabled(v: boolean): void {
    _getCtrl().setProcMotionHeadTrackingEnabled(v);
}
export function activateGazeTracking(): void {
    _getCtrl().activateGazeTracking();
}
export function setGazeLayerActive(active: boolean, intensity: number): void {
    _getCtrl().setGazeLayerActive(active, intensity);
}
export function regenerateProcMotion(modelId?: string): void {
    _getCtrl().regenerateProcMotion(modelId);
    // [fix:proc-override] 程序化重生成后，应用该模型的 per-proc 模块配置（持久化 → 运行时）。
    // 确保场景恢复 / 激活 / 参数变更后，模块状态从 ModelInstance.procMotionModules 落到引擎。
    // [fix:P3] role 取 per-model 优先、全局回落：模型无 per-model procMotion 但全局默认激活
    // idle/autodance 时 inst.procMotion 为 undefined，直接跳过会导致模块覆盖静默失效。
    const targetId = modelId ?? focusedModel()?.id ?? undefined;
    if (targetId) {
        const inst = modelManager.get(targetId);
        const role = inst?.procMotion?.mode ?? getProcMotionState().mode;
        if (role && role !== 'off') {
            applyProcMotionModulesToModel(targetId, role);
        }
    }
}

/** 释放程序化动作模块全部资源并销毁单例。应用关闭 / 模块卸载时调用。 */
export function disposeProcMotion(): void {
    if (_ctrl) {
        _ctrl.dispose();
        _ctrl = null;
    }
}

// [doc:adr-238] 注册程序化动作操作供 core/action-defs 经 scene-action-bridge 调用
import { registerSceneAction } from '@/core/scene-action-bridge';
registerSceneAction('setProcMotionMode', (mode: string) => {
    setProcMotionMode(mode as Parameters<typeof setProcMotionMode>[0]);
});
registerSceneAction('regenerateProcMotion', () => regenerateProcMotion());
