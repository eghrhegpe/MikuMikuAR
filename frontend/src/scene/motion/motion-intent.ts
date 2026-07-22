// [doc:adr-121] 全局动作意图（Scene-level Motion Intent）
// [doc:adr-167] 场景级动作库（Scene Motion Library）— 多主动作平等共存
// 职责: 场景级 _sceneMotions 动作库 + _activeMotionId 默认动作 + 每实例继承/覆盖 + 广播/兼容性解析
// 设计: 轻量 singleton（非 EnvState），规避 Go struct 同步 + wails 绑定重生成本
// 依赖方向: 不 import 任何 UI 模块；由 broadcastMotion 遍历 modelRegistry 写入 inst.vmd*

import type { SceneMotionIntent, MotionModuleState } from '@/core/types';
import { matchBone } from '@/motion-algos/proc-motion-shared';

// ── 场景级 store（轻量 singleton，非 EnvState）──

let _sceneMotions: SceneMotionIntent[] = []; // 场景级主动作库（多主动作平等共存，ADR-167）
let _activeMotionId: string | null = null; // 默认动作 id；null = 无默认（新角色静止）
let _motionGen = 0; // generation counter，每次变更递增，用于守护异步广播竞态

/** 生成场景动作 id（稳定唯一，用于引用与序列化） */
function genMotionId(): string {
    return `motion_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * 获取当前默认动作（派生自 _activeMotionId）。
 * 保持原签名以最小化下游改动（playback/vmd-loader/vmd-layers 链路无感知）。
 * null = 无默认动作（静态场景）。
 */
export function getActiveMotion(): SceneMotionIntent | null {
    if (!_activeMotionId) return null;
    return _sceneMotions.find((m) => m.id === _activeMotionId) ?? null;
}

/** 获取场景级动作库（所有主动作列表）。 */
export function getSceneMotions(): SceneMotionIntent[] {
    return _sceneMotions;
}

/** 获取当前默认动作 id。null = 无默认。 */
export function getActiveMotionId(): string | null {
    return _activeMotionId;
}

/** 获取当前 generation 值。用于异步操作中判断是否为最新广播。 */
export function getMotionGen(): number {
    return _motionGen;
}

// ── 广播回调（调用方注册，避免循环依赖）──

let _broadcastCallback:
    | ((intent: SceneMotionIntent | null, gen: number, prev: SceneMotionIntent | null) => void)
    | null = null;
let _callbackInitialized = false;

/**
 * 初始化广播回调。由 bootstrap 点（如 scene.ts initScene）调用一次。
 * 回调负责遍历 modelRegistry 并按每实例 assignment 策略应用意图。
 * 回调模式避免 motion-intent 直接依赖 scene 模块。
 * 幂等守卫：多次调用不重复注册。
 */
export function initMotionIntent(
    cb: (intent: SceneMotionIntent | null, gen: number, prev: SceneMotionIntent | null) => void
): void {
    if (_callbackInitialized) {
        return;
    }
    _broadcastCallback = cb;
    _callbackInitialized = true;
}

/**
 * @deprecated 请使用 initMotionIntent() 替代。此函数仅保留供测试覆写：
 * 测试用例间需 setBroadcastCallback(null) 隔离回调，而 initMotionIntent 的幂等守卫不允许置空。
 * 生产代码应使用 initMotionIntent()。
 */
export function setBroadcastCallback(
    cb:
        | ((intent: SceneMotionIntent | null, gen: number, prev: SceneMotionIntent | null) => void)
        | null
): void {
    _broadcastCallback = cb;
}

// ── 场景动作库 API（ADR-167）──

/**
 * 新增主动作到场景库。
 * - 若 intent 无 id，自动生成
 * - 若 _sceneMotions 为空（首次添加），自动设为默认
 * - 触发广播：所有 sceneMotionId===undefined 的 inherit 角色套用新默认（若默认变更）
 * @returns 新增动作的 id
 */
export function addSceneMotion(intent: SceneMotionIntent): string {
    const id = intent.id ?? genMotionId();
    const withId: SceneMotionIntent = { ...intent, id };
    _sceneMotions.push(withId);

    // 首次添加自动设为默认
    const prev = getActiveMotion();
    if (_activeMotionId === null && _sceneMotions.length === 1) {
        _activeMotionId = id;
    }

    _motionGen++;
    _broadcastCallback?.(getActiveMotion(), _motionGen, prev);
    return id;
}

/**
 * 移除场景库中的某个主动作。
 * - 若移除的是默认动作，自动选列表第一项为新默认（无则 null）
 * - 引用该 id 的角色由调用方（broadcastMotion）处理回退（置 sceneMotionId=undefined）
 */
export function removeSceneMotion(id: string): void {
    const prev = getActiveMotion();
    _sceneMotions = _sceneMotions.filter((m) => m.id !== id);

    if (_activeMotionId === id) {
        _activeMotionId = _sceneMotions.length > 0 ? (_sceneMotions[0].id ?? null) : null;
    }

    _motionGen++;
    _broadcastCallback?.(getActiveMotion(), _motionGen, prev);
}

/**
 * 更新场景库中某个主动作的数据（如改其 vmdLayers）。
 * - 保留原 id 不变
 * - 触发广播：引用该 id 的角色重建 composite animation
 */
export function updateSceneMotion(id: string, patch: Partial<SceneMotionIntent>): void {
    const idx = _sceneMotions.findIndex((m) => m.id === id);
    if (idx < 0) return;
    _sceneMotions[idx] = { ..._sceneMotions[idx], ...patch, id }; // 保留 id
    _motionGen++;
    _broadcastCallback?.(getActiveMotion(), _motionGen, null);
}

/**
 * 设置默认动作 id。
 * - null = 清空默认（新角色静止，但场景库保留）
 * - 触发广播：所有 sceneMotionId===undefined 的 inherit 角色重新套用
 */
export function setDefaultMotion(id: string | null): void {
    const prev = getActiveMotion();
    _activeMotionId = id;
    _motionGen++;
    _broadcastCallback?.(getActiveMotion(), _motionGen, prev);
}

/**
 * 清空整个场景动作库 + 默认动作。
 * 用于「清除场景动作」UI。
 */
export function clearAllSceneMotions(): void {
    const prev = getActiveMotion();
    _sceneMotions = [];
    _activeMotionId = null;
    _motionGen++;
    _broadcastCallback?.(null, _motionGen, prev);
}

/**
 * [doc:adr-121 P4-1] 在 intent.motionModules 中查找或创建模块状态。
 * 收敛 mutate 入口：外部模块（如 registry）不再直接 push intent.motionModules，
 * 而是通过此函数获取引用，保持写入路径可追踪。
 */
export function findOrCreateModuleState(
    intent: SceneMotionIntent,
    moduleId: string
): MotionModuleState {
    if (!intent.motionModules) {
        intent.motionModules = [];
    }
    let state = intent.motionModules.find((m) => m.id === moduleId);
    if (!state) {
        state = { id: moduleId, enabled: false, params: {} };
        intent.motionModules.push(state);
    }
    return state;
}

/**
 * [adr-169] 原位替换默认动作。
 *
 * 「从文件装载动作」的统一语义：装载的动作成为新默认，旧默认被原位顶替。
 * 是 removeSceneMotion + addSceneMotion + setDefaultMotion 的原子组合，
 * 保证「移除旧默认 → 加入/复用新动作 → 设默认 → 广播」在一次 generation
 * 递增内完成，避免中间态被并发广播读到。
 *
 * - 装载路径已是库中候选 → 复用该候选（提升为默认），不重复添加
 * - 否则新增动作，插入到旧默认原位置（保持库顺序稳定）
 * - 旧默认（若存在且非复用项）从库中移除
 * - 触发广播：跟随默认 / 引用旧默认的角色切到新动作
 *
 * @returns 新默认动作的 id
 */
export function replaceDefaultMotion(intent: SceneMotionIntent): string {
    const prev = getActiveMotion();
    const prevId = _activeMotionId;

    // 去重：装载路径已是库中候选 → 复用（提升为默认）
    const existing = intent.vmdPath
        ? _sceneMotions.find((m) => m.vmdPath === intent.vmdPath)
        : undefined;

    let newId: string;
    if (existing) {
        newId = existing.id;
        // 旧默认若非复用项本身，从库中移除
        if (prevId !== null && prevId !== newId) {
            _sceneMotions = _sceneMotions.filter((m) => m.id !== prevId);
        }
    } else {
        newId = intent.id ?? genMotionId();
        const withId: SceneMotionIntent = { ...intent, id: newId };
        if (prevId !== null) {
            // 原位插入到旧默认位置，保持库顺序稳定
            const idx = _sceneMotions.findIndex((m) => m.id === prevId);
            _sceneMotions = _sceneMotions.filter((m) => m.id !== prevId);
            _sceneMotions.splice(idx >= 0 ? idx : _sceneMotions.length, 0, withId);
        } else {
            _sceneMotions.push(withId);
        }
    }

    _activeMotionId = newId;
    _motionGen++;
    _broadcastCallback?.(getActiveMotion(), _motionGen, prev);
    return newId;
}

// ── 兼容性解析 ──

const MIN_STANDARD_BONE_MATCH = 3;
const MIN_VMD_BONE_MATCH_RATIO = 0.5;

const STANDARD_MMD_BONES = [
    '全ての親',
    'センター',
    'グルーブ',
    '腰',
    '上半身',
    '下半身',
    '頭',
    '右肩',
    '右腕',
    '右ひじ',
    '右手首',
    '左肩',
    '左腕',
    '左ひじ',
    '左手首',
    '右足',
    '右ひざ',
    '右足首',
    '左足',
    '左ひざ',
    '左足首',
    '首',
    '両目',
    'まぶた',
    '左目',
    '右目',
    '下あご',
];

function countBoneMatches(actualBones: string[], candidates: string[]): number {
    let count = 0;
    for (const candidate of candidates) {
        if (matchBone(actualBones, [candidate])) {
            count++;
        }
    }
    return count;
}

/**
 * 兼容性解析：判断指定模型的骨骼列表是否兼容某 VMD 动作。
 * 复用 proc-motion-shared.matchBone 进行骨骼名匹配（全角/半角/英文变体）。
 *
 * 匹配策略（两级）：
 * 1. 传入 vmdBoneNames（VMD 实际引用的骨骼名）→ VMD 级匹配，
 *    命中率 ≥ MIN_VMD_BONE_MATCH_RATIO 视为兼容；
 * 2. 未传 vmdBoneNames → 人形预筛（STANDARD_MMD_BONES ≥ MIN_STANDARD_BONE_MATCH 命中）
 *
 * @param actualBones   模型的实际骨骼名列表
 * @param intent        待解析的动作意图（null=静态，始终兼容）
 * @param vmdBoneNames  可选，VMD 实际引用的骨骼名数组
 * @returns 兼容性结果
 */
export function resolveCompatibility(
    actualBones: string[],
    intent: SceneMotionIntent | null,
    vmdBoneNames?: string[]
): { compatible: boolean; reason?: string } {
    if (!intent) {
        return { compatible: true };
    }
    if (actualBones.length === 0) {
        return { compatible: false, reason: '模型无骨骼数据' };
    }
    if (vmdBoneNames && vmdBoneNames.length > 0) {
        const matched = countBoneMatches(actualBones, vmdBoneNames);
        const ratio = matched / vmdBoneNames.length;
        if (ratio >= MIN_VMD_BONE_MATCH_RATIO) {
            return { compatible: true };
        }
        return {
            compatible: false,
            reason: `VMD 骨骼命中率 ${(ratio * 100).toFixed(0)}%（${matched}/${vmdBoneNames.length}），不兼容当前动作`,
        };
    }
    const matched = countBoneMatches(actualBones, STANDARD_MMD_BONES);
    if (matched >= MIN_STANDARD_BONE_MATCH) {
        return { compatible: true };
    }
    return {
        compatible: false,
        reason: `仅匹配到 ${matched}/${MIN_STANDARD_BONE_MATCH} 个标准骨骼，不兼容当前动作`,
    };
}
