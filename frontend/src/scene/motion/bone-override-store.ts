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
import { clearBoneOverride } from './bone-override';

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
    /** 落败方来源 stage（M8，满足 §九 验收 3「冲突来源可追溯至 stage」；由 stageOf 注入填充） */
    loserStage?: string;
    /** 抢占方来源 stage（M8） */
    winnerStage?: string;
}

/** 构造选项（ADR-147 M8：注入模块→stage 解析器，填充 BoneConflict.stage） */
export interface BoneOverrideStoreOptions {
    /** 模块 → stage 解析器；返回 undefined 表示未知 stage（M8：填充 BoneConflict.stage） */
    stageOf?: (moduleId: string) => string | undefined;
    /**
     * 引擎槽清除回调（M7 运行时接入）：store 接管骨骼所有权后，
     * 抢占 / release / dispose 时须经此回调清真实引擎覆盖（bone-override.clearBoneOverride），
     * 保持与旧 registry 行为一致（claimBones 抢占即清落败方引擎槽、disable 清 owned 骨骼）。
     * store 自身只维护逻辑副本，不直接持有 Babylon 运行时。
     */
    onClearEngineSlot?: (modelId: string, bone: string) => void;
}

// ── 存储契约 ──

export interface BoneOverrideStore {
    // —— 槽位（原 _overrideMaps 职责）——
    setSlot(modelId: string, bone: string, slot: OverrideSlot): void;
    getSlot(modelId: string, bone: string): OverrideSlot | undefined;
    /**
     * 清槽位（M6 所有权守卫）。
     * @param expectedModuleId 可选；提供时仅当 slot 归属 == expected 才清，否则 warn 并忽略（防越权清他人 slot）
     */
    clearSlot(modelId: string, bone: string, expectedModuleId?: string): void;

    // —— 模块认领（原 _ownedBones + claimBones 职责）——
    /**
     * 认领骨骼；返回本模块本次 claim 后**现拥有**的骨骼列表（含已拥有 + 新认领 + 抢占），
     * 供各 bake 门控（`claimed.includes(bone)` / `claimed.length === 0`）。
     * 注意：与旧 registry 一致，返回 `claimed` 而非 `preempted`（ADR-147 M3）。
     */
    claimBones(modelId: string, moduleId: string, priority: number, bones: readonly string[]): string[];
    /** 释放模块全部已认领骨骼，并级联清理其槽位；返回被释放的骨骼集合 */
    releaseBones(modelId: string, moduleId: string): Set<string>;
    getOwnedBones(modelId: string, moduleId: string): Set<string>;
    /** 查询某骨当前归属模块 id（无归属返回 null）；供 isBoneOwnedByOther 等运行时判定 */
    getBoneOwnerModule(modelId: string, bone: string): string | null;
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
    private _opts: BoneOverrideStoreOptions;

    constructor(opts: BoneOverrideStoreOptions = {}) {
        this._opts = opts;
    }

    // —— 槽位 ——

    setSlot(modelId: string, bone: string, slot: OverrideSlot): void {
        // M6 所有权守卫：slot 归属 sourceModuleId 时，禁止为「其他模块」写的骨写入 slot（防 R3 幽灵 slot 换壳）
        const owner = this._ownerMap(modelId).get(bone);
        if (slot.sourceModuleId && owner && owner.moduleId !== slot.sourceModuleId) {
            console.warn(
                `[adr-147] setSlot 越权：${slot.sourceModuleId} 写 bone="${bone}" 但已被 ${owner.moduleId} 认领，已忽略`
            );
            return;
        }
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

    clearSlot(modelId: string, bone: string, expectedModuleId?: string): void {
        // M6 所有权守卫：提供 expectedModuleId 时，仅当 slot 归属匹配才清，否则 warn 并忽略
        const existing = this._slots.get(modelId)?.get(bone);
        if (expectedModuleId && existing && existing.sourceModuleId && existing.sourceModuleId !== expectedModuleId) {
            console.warn(
                `[adr-147] clearSlot 越权：${expectedModuleId} 清 bone="${bone}" 但 slot 归属 ${existing.sourceModuleId}，已忽略`
            );
            return;
        }
        this._slots.get(modelId)?.delete(bone);
        // M7：清真实引擎槽（store 只维护逻辑副本，引擎清理委托回调）
        this._opts.onClearEngineSlot?.(modelId, bone);
    }

    // —— 模块认领 ——

    claimBones(
        modelId: string,
        moduleId: string,
        priority: number,
        bones: readonly string[]
    ): string[] {
        this._ensureModule(modelId, moduleId);
        // claimBones 携带权威 priority，每次刷新（setModuleEnabled 不传 priority，不能覆盖既有优先级）
        this._moduleState.get(modelId)!.get(moduleId)!.priority = priority;
        const owned = this._ownedMap(modelId).get(moduleId)!;
        const ownerByBone = this._ownerMap(modelId);
        // M3：返回 claimed = 本模块现拥有的骨骼（含已拥有 + 新认领 + 抢占），对齐 registry.claimed
        const claimed: string[] = [];

        for (const bone of bones) {
            const conflict = ownerByBone.get(bone);
            if (conflict && conflict.moduleId !== moduleId) {
                // 与 registry.ts:204 一致：数值越小优先级越高
                // （ADR-147 §六 语义迁移映射：避免 Phase 2 step2 接入时仲裁结果整体翻转）
                if (priority < conflict.priority) {
                    // 抢占：清落败方所有权 + 槽位，记录「落败方视角」冲突（loser=原主）
                    console.warn(
                        `[adr-147] bone "${bone}" 被模块 "${moduleId}"(priority=${priority}) 从 "${conflict.moduleId}"(priority=${conflict.priority}) 抢占`
                    );
                    this._releaseBoneFromOwner(modelId, conflict.moduleId, bone);
                    this.clearSlot(modelId, bone, conflict.moduleId);
                    this._recordConflict(
                        modelId,
                        bone,
                        conflict.moduleId,
                        conflict.priority,
                        moduleId,
                        priority
                    );
                } else {
                    // 落败：跳过该骨（不拥有），但记录「本模块视角」冲突（M4 双视角，对齐 registry:220 loser=moduleId）
                    console.warn(
                        `[adr-147] bone "${bone}" 已被模块 "${conflict.moduleId}"(priority=${conflict.priority}) 占用，模块 "${moduleId}"(priority=${priority}) 跳过该骨骼`
                    );
                    this._recordConflict(
                        modelId,
                        bone,
                        moduleId,
                        priority,
                        conflict.moduleId,
                        conflict.priority
                    );
                    continue;
                }
            }
            // 认领成功：写所有权 + 模块 ownedBones
            ownerByBone.set(bone, { moduleId, priority });
            owned.add(bone);
            claimed.push(bone);
        }

        return claimed;
    }

    releaseBones(modelId: string, moduleId: string): Set<string> {
        const owned = this._ownedMap(modelId).get(moduleId);
        if (!owned) return new Set();
        const ownerByBone = this._ownerMap(modelId);
        const released = new Set<string>();
        for (const bone of [...owned]) {
            this._releaseBoneFromOwner(modelId, moduleId, bone);
            this.clearSlot(modelId, bone, moduleId);
            released.add(bone);
        }
        owned.clear();
        // M5：清本模块作为 loser 的冲突卡片（对齐 registry._clearConflict）
        const list = this._conflicts.get(modelId);
        if (list) {
            this._conflicts.set(modelId, list.filter((c) => c.loserModuleId !== moduleId));
        }
        return released;
    }

    getOwnedBones(modelId: string, moduleId: string): Set<string> {
        return new Set(this._ownedMap(modelId).get(moduleId) ?? []);
    }

    getBoneOwnerModule(modelId: string, bone: string): string | null {
        return this._ownerMap(modelId).get(bone)?.moduleId ?? null;
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
        // M7：清真实引擎槽（按所有权遍历，因为引擎槽由模块直接写 _overrideMaps，store._slots 可能为空）
        const ownedMap = this._ownedBones.get(modelId);
        if (ownedMap) {
            for (const set of ownedMap.values()) {
                for (const bone of set) {
                    this._opts.onClearEngineSlot?.(modelId, bone);
                }
            }
        }
        this._slots.delete(modelId);
        this._ownedBones.delete(modelId);
        this._boneOwner.delete(modelId);
        this._moduleState.delete(modelId);
        this._conflicts.delete(modelId);
    }

    // —— 内部辅助 ——

    private _ensureModule(modelId: string, moduleId: string): void {
        let perModel = this._moduleState.get(modelId);
        if (!perModel) {
            perModel = new Map();
            this._moduleState.set(modelId, perModel);
        }
        if (!perModel.has(moduleId)) {
            // 仅首建时置默认 priority=0；后续权威优先级由 claimBones 的 `state.priority = priority` 统一写入（M9 去哨兵）
            perModel.set(moduleId, { enabled: true, priority: 0, ownedBones: new Set() });
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
        // 去重（对齐 registry._recordConflict 的 some 检查，避免同 (bone,loser,winner) 重复累加）
        if (list.some((c) => c.bone === bone && c.loserModuleId === loserModuleId && c.winnerModuleId === winnerModuleId)) {
            return;
        }
        list.push({
            modelId,
            bone,
            loserModuleId,
            winnerModuleId,
            loserPriority,
            winnerPriority,
            loserStage: this._opts.stageOf?.(loserModuleId),
            winnerStage: this._opts.stageOf?.(winnerModuleId),
        });
    }
}

// ── 单例（Phase 2 step 2 运行时接入；引擎槽清除委托 bone-override.clearBoneOverride）──

let _storeInstance: BoneOverrideStore | null = null;

/** 获取全局 BoneOverrideStore 单例（registry / module-base 等委托此存储骨骼所有权与冲突状态） */
export function getBoneOverrideStore(): BoneOverrideStore {
    if (!_storeInstance) {
        _storeInstance = new InMemoryBoneOverrideStore({
            stageOf: () => 'bone-override',
            // store 回调签名为 (modelId, bone)，而 clearBoneOverride 为 (bone, modelId)，此处重排
            onClearEngineSlot: (modelId, bone) => clearBoneOverride(bone, modelId),
        });
    }
    return _storeInstance;
}
