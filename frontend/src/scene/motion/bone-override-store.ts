// [doc:adr-147 Phase 2] 集中骨骼覆盖状态（BoneOverrideStore）
//
// 根因 R3：当前骨骼覆盖状态散落三处、各自生命周期、靠 module-base.ts 的
// enable/disable/setParam 手动同步，极易漂移（disable 漏清 slot、切模型静默跳过）。
// 本文件给出统一存储契约 + 参考实现：所有读写走统一 API，三套副本在内部保持一致，
// 消除「幽灵 slot / 孤儿所有权 / 配置与运行时脱节」。
//
// 实施边界（ADR-147 多写者约束）：本文件仅为 Phase 2 接口骨架 + 参考实现，
// 暂未接入 scene.ts / bone-override.ts / registry.ts。接入为 Phase 2 step 2，
// 需与 motion-modules 写者协调认领边界，规避源码碰撞。

import { Quaternion, Vector3 } from '@babylonjs/core';

// ── 统一类型（复用现有 _OverrideSlot 契约，并补 sourceModuleId 归属追踪）──

/** 单骨覆盖槽位（原 _OverrideSlot 的共享命名版） */
export interface OverrideSlot {
    quat: Quaternion;
    weight: number;
    enabled: boolean;
    /** 可选位置覆盖；undefined = 不动位置，沿用动画值 */
    pos?: Vector3;
    /** 是否覆盖动画旋转 */
    overrideRotation?: boolean;
    /** 归属模块 id；根治 R3 的「幽灵 slot」（无归属 = 孤儿） */
    sourceModuleId?: string | null;
}

/** 单骨所有权记录 */
export interface BoneOwnership {
    moduleId: string;
    priority: number;
}

/** 模块运行时状态（合并原 intent.motionModules + _ownedBones 的职责） */
export interface ModuleRuntimeState {
    enabled: boolean;
    priority: number;
    ownedBones: Set<string>;
}

/** 骨骼冲突记录（原 registry._boneConflicts 的统一版） */
export interface BoneConflict {
    modelId: string;
    bone: string;
    loserModuleId: string;
    winnerModuleId: string;
    loserPriority: number;
    winnerPriority: number;
}

// ── 存储契约 ──

export interface BoneOverrideStore {
    // —— 槽位（原 _overrideMaps 职责）——
    setSlot(modelId: string, bone: string, slot: OverrideSlot): void;
    getSlot(modelId: string, bone: string): OverrideSlot | undefined;
    clearSlot(modelId: string, bone: string): void;

    // —— 模块认领（原 _ownedBones + claimBones 职责）——
    /** 认领骨骼；返回被抢占（高优先级覆盖低优先级）的骨骼列表 */
    claimBones(modelId: string, moduleId: string, priority: number, bones: readonly string[]): string[];
    /** 释放模块全部已认领骨骼，并级联清理其槽位；返回被释放的骨骼集合 */
    releaseBones(modelId: string, moduleId: string): Set<string>;
    getOwnedBones(modelId: string, moduleId: string): Set<string>;
    setModuleEnabled(modelId: string, moduleId: string, enabled: boolean): void;

    // —— 冲突（原 _boneConflicts 职责）——
    getConflicts(modelId: string): BoneConflict[];
    getAllConflicts(): BoneConflict[];

    // —— 模型生命周期 ——
    disposeModel(modelId: string): void;
}

// ── 参考实现（内部保证三副本一致）──

export class InMemoryBoneOverrideStore implements BoneOverrideStore {
    private _slots = new Map<string, Map<string, OverrideSlot>>();
    private _ownedBones = new Map<string, Map<string, Set<string>>>();
    private _boneOwner = new Map<string, Map<string, BoneOwnership>>();
    private _moduleState = new Map<string, Map<string, ModuleRuntimeState>>();
    private _conflicts = new Map<string, BoneConflict[]>();

    // —— 槽位 ——

    setSlot(modelId: string, bone: string, slot: OverrideSlot): void {
        let map = this._slots.get(modelId);
        if (!map) {
            map = new Map();
            this._slots.set(modelId, map);
        }
        map.set(bone, slot);
    }

    getSlot(modelId: string, bone: string): OverrideSlot | undefined {
        return this._slots.get(modelId)?.get(bone);
    }

    clearSlot(modelId: string, bone: string): void {
        this._slots.get(modelId)?.delete(bone);
    }

    // —— 模块认领 ——

    claimBones(
        modelId: string,
        moduleId: string,
        priority: number,
        bones: readonly string[]
    ): string[] {
        this._ensureModule(modelId, moduleId, priority);
        // claimBones 携带权威 priority，每次刷新（setModuleEnabled 不传 priority，不能覆盖既有优先级）
        this._moduleState.get(modelId)!.get(moduleId)!.priority = priority;
        const owned = this._ownedMap(modelId).get(moduleId)!;
        const ownerByBone = this._ownerMap(modelId);
        const preempted: string[] = [];

        for (const bone of bones) {
            const conflict = ownerByBone.get(bone);
            if (conflict && conflict.moduleId !== moduleId) {
                // 与 registry.ts:204 一致：数值越小优先级越高
                // （ADR-147 §六 语义迁移映射：避免 Phase 2 step2 接入时仲裁结果整体翻转）
                if (priority < conflict.priority) {
                    // 抢占：清落败方所有权 + 槽位，记录冲突
                    this._releaseBoneFromOwner(modelId, conflict.moduleId, bone);
                    this.clearSlot(modelId, bone);
                    preempted.push(bone);
                    this._recordConflict(
                        modelId,
                        bone,
                        conflict.moduleId,
                        conflict.priority,
                        moduleId,
                        priority
                    );
                } else {
                    // 落败：跳过（冲突已在历史记录，这里不重复写）
                    continue;
                }
            }
            // 认领成功：写所有权 + 模块 ownedBones
            ownerByBone.set(bone, { moduleId, priority });
            owned.add(bone);
        }

        return preempted;
    }

    releaseBones(modelId: string, moduleId: string): Set<string> {
        const owned = this._ownedMap(modelId).get(moduleId);
        if (!owned) return new Set();
        const ownerByBone = this._ownerMap(modelId);
        const released = new Set<string>();
        for (const bone of [...owned]) {
            this._releaseBoneFromOwner(modelId, moduleId, bone);
            this.clearSlot(modelId, bone);
            released.add(bone);
        }
        owned.clear();
        return released;
    }

    getOwnedBones(modelId: string, moduleId: string): Set<string> {
        return new Set(this._ownedMap(modelId).get(moduleId) ?? []);
    }

    setModuleEnabled(modelId: string, moduleId: string, enabled: boolean): void {
        this._ensureModule(modelId, moduleId);
        const state = this._moduleState.get(modelId)!.get(moduleId)!;
        state.enabled = enabled;
        if (!enabled) {
            // 禁用级联释放全部已认领骨骼 + 槽位（根治 R3 孤儿 slot）
            this.releaseBones(modelId, moduleId);
        }
    }

    // —— 冲突 ——

    getConflicts(modelId: string): BoneConflict[] {
        return [...(this._conflicts.get(modelId) ?? [])];
    }

    getAllConflicts(): BoneConflict[] {
        const all: BoneConflict[] = [];
        for (const list of this._conflicts.values()) all.push(...list);
        return all;
    }

    // —— 模型生命周期 ——

    disposeModel(modelId: string): void {
        this._slots.delete(modelId);
        this._ownedBones.delete(modelId);
        this._boneOwner.delete(modelId);
        this._moduleState.delete(modelId);
        this._conflicts.delete(modelId);
    }

    // —— 内部辅助 ——

    private _ensureModule(modelId: string, moduleId: string, priority = 0): void {
        let perModel = this._moduleState.get(modelId);
        if (!perModel) {
            perModel = new Map();
            this._moduleState.set(modelId, perModel);
        }
        if (!perModel.has(moduleId)) {
            perModel.set(moduleId, { enabled: true, priority, ownedBones: new Set() });
        } else if (priority !== 0) {
            // 仅显式传入非 0 priority 时刷新（setModuleEnabled 调 _ensureModule 不传 priority=0，避免误清既有优先级）
            perModel.get(moduleId)!.priority = priority;
        }
        // 同步确保 _ownedBones 的 per-module set 存在（避免 claimBones 取 owned 时 undefined）
        let ownedPerModel = this._ownedBones.get(modelId);
        if (!ownedPerModel) {
            ownedPerModel = new Map();
            this._ownedBones.set(modelId, ownedPerModel);
        }
        if (!ownedPerModel.has(moduleId)) {
            ownedPerModel.set(moduleId, new Set());
        }
    }

    private _ownedMap(modelId: string): Map<string, Set<string>> {
        let m = this._ownedBones.get(modelId);
        if (!m) {
            m = new Map();
            this._ownedBones.set(modelId, m);
        }
        return m;
    }

    private _ownerMap(modelId: string): Map<string, BoneOwnership> {
        let m = this._boneOwner.get(modelId);
        if (!m) {
            m = new Map();
            this._boneOwner.set(modelId, m);
        }
        return m;
    }

    private _releaseBoneFromOwner(modelId: string, moduleId: string, bone: string): void {
        this._ownerMap(modelId).delete(bone);
        this._ownedMap(modelId).get(moduleId)?.delete(bone);
    }

    private _recordConflict(
        modelId: string,
        bone: string,
        loserModuleId: string,
        loserPriority: number,
        winnerModuleId: string,
        winnerPriority: number
    ): void {
        let list = this._conflicts.get(modelId);
        if (!list) {
            list = [];
            this._conflicts.set(modelId, list);
        }
        list.push({ modelId, bone, loserModuleId, winnerModuleId, loserPriority, winnerPriority });
    }
}
