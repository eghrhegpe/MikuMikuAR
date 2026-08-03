// [doc:architecture] Procedural Motion — 程序化动作状态机核心
// 从 proc-motion-bridge.ts 拆出（ADR-237 P1：ProcMotionController 575 行单类瘦身）。
// 职责: Idle / Auto Dance VMD 生成调度、节拍联动、per-model 活跃状态管理。
// 参数 setter 群（ProcMotionParamsMixin）见 proc-motion-params.ts；
// 模块级懒单例 + 转发层见 proc-motion-bridge.ts。
//
// [adr-XX per-motion] 参数存储优先级：
//   1. activeMotion.procMotion（随动作走，多角色共享参数）
//   2. _fallbackProcState（无动作时的本地默认值，向后兼容）
// 读取时取优先值，写入时写入 activeMotion（若存在）并同步 fallback。

import {
    ProcMotionState,
    ProcMotionMode,
    DEFAULT_PROC_STATE,
    generateIdleVmd,
    generateAutoDanceVmd,
    shouldAutoDance,
    shouldIdle,
    PROC_VMD_NAME_IDLE,
    PROC_VMD_NAME_AUTODANCE,
} from '@/motion-algos/procedural-motion';
import { BeatDetector } from '@/motion-algos/beat-detector';
import { focusedModelId } from '@/core/config';
// [doc:adr-238] 音频操作经 scene-action-bridge（outfit/audio 注册）
import { getSceneAction } from '@/core/scene-action-bridge';
import { modelManager, focusedMmdModel, focusedModel } from '../scene';
import { onPerceptionModelRemoved } from './perception';
import { logWarn } from '@/core/logger';
import { safeDispose } from '@/core/dispose-helpers';
import { getActiveMotion } from './motion-intent';
import { rebuildCompositeAnimation } from './vmd-layers';

/** 清除模型上的 vmdData/vmdName（纯工具函数，无状态依赖）。 */
export function _clearVmdData(
    inst: import('../../core/config').ModelInstance | null | undefined
): void {
    if (inst) {
        inst.vmdData = null;
        inst.vmdName = '';
    }
}

// ═══════════════════════════════════════════════════════════
// ProcMotionControllerBase — 程序化动作状态机核心
// （ProcMotionParamsMixin 经 protected 成员混入参数 setter 群）
// ═══════════════════════════════════════════════════════════

export class ProcMotionControllerBase {
    // ── 私有状态（原 8 个模块级 let，外部不可直接访问）──
    // [ADR-237 P1] _fallbackProcState / _beatDetector / _refProcState 改 protected
    // 供 ProcMotionParamsMixin 访问。
    protected _fallbackProcState: ProcMotionState = { ...DEFAULT_PROC_STATE };
    protected _beatDetector: BeatDetector | null = null;
    private _starting = false;
    private _stopRequested = false; // await 期间被 stop 时置位，防止 start 完成后重新激活
    private _regeneratePending = false;
    /** [fix:P1] Set 支持多模型并发程序化，替代原 procModelId 单值 */
    private _activeModels = new Set<string>();
    /** [fix:P2] per-model 程序化状态（kind + 上次 BPM）。
     *  原 `_activeKind`/`_lastBeatBpm` 为全局单值，多模型并发时最后一个启动的模型
     *  覆盖它们，导致 updateProcMotion 对焦点模型的 kind/BPM 判断失真（重复/漏重生成）。
     *  现按 modelId 记录，生命周期与 `_activeModels` 同步（成功 set / 停止 delete）。 */
    private _modelProcState = new Map<string, { kind: ProcMotionMode; bpm: number }>();

    // ── 内部工具 ──

    private _procVmdActive(): boolean {
        return this._activeModels.size > 0;
    }

    /** [adr-XX per-motion] 获取当前生效的程序化配置引用。
     *  读取优先级：显式 modelId 的 per-model 状态 > activeMotion > fallback。
     *  [P5 per-slot] 显式 modelId 时优先读 modelManager 中的 per-model 状态，
     *  使 regenerateProcMotion(modelId) 正确读取该模型独有参数（如 boneToggles）。
     *  返回的是可变引用，内部使用；外部读取用 getProcMotionState()（浅拷贝）。
     *  [ADR-237 P1] protected：供 ProcMotionParamsMixin 的 setter 群读取。 */
    protected _refProcState(modelId?: string): ProcMotionState {
        // [P5 per-slot] 显式 modelId → 读 per-model 状态（UI 写入 modelRegistry 的源）
        if (modelId) {
            const inst = modelManager.get(modelId);
            if (inst?.procMotion) {
                return inst.procMotion as ProcMotionState;
            }
        }
        const intent = getActiveMotion();
        if (intent?.procMotion) {
            return intent.procMotion as ProcMotionState;
        }
        return this._fallbackProcState;
    }

    // ── 公共 API（状态机核心） ──

    /** 只读访问器，外部不可直接修改程序化动作激活状态。 */
    isProcVmdActive(): boolean {
        return this._procVmdActive();
    }

    getProcBeatDetector(): BeatDetector | null {
        return this._beatDetector;
    }

    createProcBeatDetector(): BeatDetector {
        this._beatDetector = new BeatDetector();
        return this._beatDetector;
    }

    protected async _startProcMotion(
        targetMode: ProcMotionMode,
        bpm?: number,
        /** [P5 per-slot] 显式指定目标模型；不传时回退到焦点模型（向后兼容）。 */
        modelIdOverride?: string
    ): Promise<void> {
        if (this._starting) {
            return;
        }
        this._starting = true;
        this._stopRequested = false;

        // 保存加载前的模型 ID，防止 await 后焦点切换导致操作错配（Issue #3）
        // [P5 per-slot] 优先使用显式传入的 modelIdOverride，使非焦点模型也能驱动程序化
        const modelAtStart =
            modelIdOverride !== undefined
                ? (modelManager.get(modelIdOverride)?.mmdModel ?? null)
                : focusedMmdModel();
        const modelIdAtStart = modelIdOverride ?? focusedModelId ?? null;
        if (!modelAtStart) {
            this._starting = false;
            return;
        }
        const morphNames = modelAtStart.morph.morphs.map((m) => m.name) ?? [];
        const boneNames = modelAtStart.runtimeBones.map((b) => b.name);
        logWarn(
            'proc-motion',
            `bones: [${boneNames.slice(0, 10).join(', ')}${boneNames.length > 10 ? '...' : ''}]`
        );
        logWarn(
            'proc-motion',
            `morphs: [${morphNames.slice(0, 5).join(', ')}${morphNames.length > 5 ? '...' : ''}]`
        );
        let buf: ArrayBuffer;

        // [P5 per-slot] 显式指定目标时跳过焦点校验：调用方已决定目标，焦点切换不应取消该模型的程序化
        // [fix] _procVmdActive/procModelId 移至成功分支内赋值（P1: 防止 early return 后状态泄漏）
        const isExplicitTarget = modelIdOverride !== undefined;
        const bpmValid = bpm !== null && bpm !== undefined && bpm > 0 && Number.isFinite(bpm);
        try {
            // [fix:P2#2] bpm 校验 + VMD 生成全部移入 try：任一环节抛错时 finally 仍复位 _starting，
            // 避免 try 外抛错导致 _starting 永久为 true、程序化动作锁死无法复现。
            if (targetMode === 'autodance' && !bpmValid) {
                throw new Error('proc-motion: autodance 模式需要有效 BPM，当前 BPM 无效');
            }
            if (targetMode === 'autodance' && bpmValid) {
                // [audit] per-mode：生成用 autodance 专属参数
                buf = generateAutoDanceVmd(
                    this._refProcState(modelIdOverride).params.autodance,
                    bpm!,
                    morphNames,
                    boneNames
                );
            } else {
                // [audit] per-mode：生成用 idle 专属参数
                buf = generateIdleVmd(this._refProcState(modelIdOverride).params.idle, boneNames);
            }

            // D4: 仅在未显式指定目标时检查焦点切换，避免无意义的 VMD 生成
            if (!isExplicitTarget && focusedModelId !== modelIdAtStart) {
                logWarn('proc-motion', '焦点已在生成期间切换，取消本次程序化动作');
                this._starting = false;
                return;
            }
            const inst = modelManager.get(modelIdAtStart);
            if (!inst) {
                this._starting = false;
                return;
            }
            // [adr-XX per-motion] 程序化 base 走 vmdLayers 管线：写入 vmdData + rebuild
            // 替代旧的直写 loadVMDMotion/setRuntimeAnimation，避免与图层叠加冲突
            const procVmdName =
                targetMode === 'autodance' && bpmValid
                    ? PROC_VMD_NAME_AUTODANCE
                    : PROC_VMD_NAME_IDLE;
            inst.vmdData = buf;
            inst.vmdName = procVmdName;
            inst.vmdPath = null; // 程序化无文件路径
            rebuildCompositeAnimation(modelIdAtStart);

            // 同步写入后校验：仅在未显式指定目标时检查焦点是否仍在该模型上
            const currentId = focusedModelId ?? null;
            if (!isExplicitTarget && currentId !== modelIdAtStart) {
                logWarn('proc-motion', '生成后焦点已切换，丢弃本次程序化动作结果');
                inst.vmdData = null;
                inst.vmdName = '';
                rebuildCompositeAnimation(modelIdAtStart);
                this._activeModels.delete(modelIdAtStart);
                this._modelProcState.delete(modelIdAtStart);
            } else if (this._stopRequested) {
                logWarn('proc-motion', '生成完成但已被 stop，丢弃结果');
                inst.vmdData = null;
                inst.vmdName = '';
                rebuildCompositeAnimation(modelIdAtStart);
                this._activeModels.delete(modelIdAtStart);
                this._modelProcState.delete(modelIdAtStart);
            } else {
                // 成功：加入活跃集合 + 记录 per-model 状态（kind/bpm 供重生成判断）
                this._activeModels.add(modelIdAtStart);
                this._modelProcState.set(modelIdAtStart, {
                    kind: targetMode === 'autodance' && bpmValid ? 'autodance' : 'idle',
                    bpm: bpmValid ? bpm! : 120,
                });
                // 感知层独立激活，不依赖程序化动作生命周期
            }
        } catch (err) {
            logWarn('proc-motion', '程序化动作生成失败:', err);
            this._activeModels.delete(modelIdAtStart);
            this._modelProcState.delete(modelIdAtStart);
            _clearVmdData(modelManager.get(modelIdAtStart));
        } finally {
            this._starting = false;
        }

        // Re-trigger check after finally (cannot use return inside finally — no-unsafe-finally)
        if (this._regeneratePending) {
            this._regeneratePending = false;
            // 取最后一个活跃模型重触发
            const lastModel = [...this._activeModels].pop();
            if (lastModel) {
                const mode =
                    this._refProcState(lastModel).mode === 'autodance' ? 'autodance' : 'idle';
                const bpm = this._beatDetector?.getBPM() ?? 120;
                void this._startProcMotion(
                    mode,
                    mode === 'autodance' ? bpm : undefined,
                    lastModel
                ).catch((e) => {
                    logWarn('proc-motion', 'Re-trigger startProcMotion 失败:', e);
                });
            } else {
                logWarn('proc-motion', 'Re-trigger skipped: no active models');
            }
        }
    }

    /**
     * 停止程序化动作。
     * [fix:P2] 支持按模型停止：传 modelId 仅清理该模型（per-model 场景避免误杀其他活跃模型，
     * 焦点模型 off / 加载用户 VMD 时不再清空全部）；不传则全量清理（兼容既有调用：
     * dispose / setProcMotionMode('off') / 外部加载 VMD）。
     */
    stopProcMotion(modelId?: string): void {
        this._stopRequested = true;
        // 感知层独立于程序化动作，不再随 stopProcMotion 注销
        // gaze 由 perception.ts 管理，always-on
        if (modelId) {
            this._stopActiveModel(modelId);
            return;
        }
        // [fix:P1] 遍历所有活跃模型，逐一清理（复制数组：循环内 delete 需迭代快照）
        for (const id of [...this._activeModels]) {
            this._stopActiveModel(id);
        }
    }

    /** 清理单个模型的程序化数据并移出活跃集合。 */
    private _stopActiveModel(modelId: string): void {
        const inst = modelManager.get(modelId);
        if (inst) {
            // [fix] 若用户已在程序化动作 active 期间加载了真实 VMD（vmdPath 非空），
            // 不可盲目清除 vmdData —— 否则会覆盖用户刚点击的动作。
            // 仅在模型未持有用户真实 VMD 时才清除程序化数据并 rebuild 到静止姿。
            const userVmdPresent =
                inst.vmdPath !== null && inst.vmdPath !== undefined && inst.vmdPath !== '';
            if (!userVmdPresent) {
                inst.vmdData = null;
                inst.vmdName = '';
                inst.vmdPath = null;
                rebuildCompositeAnimation(modelId);
            }
        }
        this._activeModels.delete(modelId);
        this._modelProcState.delete(modelId);
    }

    onModelRemoved(id: string): void {
        this._activeModels.delete(id);
        this._modelProcState.delete(id);
        // 感知层清理
        onPerceptionModelRemoved(id);
    }

    async updateProcMotion(): Promise<void> {
        // [fix:P2#1] 统一以当前焦点模型为目标：自动重生成也读 per-model 参数。
        // 此前 _startProcMotion 不带 modelIdOverride 会退化为全局 activeMotion/fallback 参数，
        // 覆盖用户在模型面板设置的 per-model 强度/速度/骨骼微动。
        const targetModelId = focusedModelId ?? undefined;
        const st = this._refProcState(targetModelId);
        if (st.mode === 'off') {
            // [fix:P2] 仅停止焦点模型：非焦点模型可能持有自己的 per-model 程序化，
            // 全量停止会误杀它们（模型面板开的 autodance 被焦点 off 每帧清掉）。
            if (targetModelId && this._activeModels.has(targetModelId)) {
                this.stopProcMotion(targetModelId);
            }
            return;
        }

        // Issue #1: focusedModel() 可能为 null/undefined
        const model = focusedModel();
        const audioOn = getSceneAction('isAudioPlaying')?.() ?? false;
        // [fix:adr-129/proc-slot] 程序化动作现已写入 inst.vmdData（替代旧直写 setRuntimeAnimation，
        // 见 _startProcMotion 内注），故不能再用 vmdData 判定"用户/场景 VMD 是否存在"——
        // 否则每帧 onBeforeRender 调用的 updateProcMotion 会把程序化数据误判为"用户 VMD"，
        // 触发 stopProcMotion() 清空 vmdData，导致动作1（基础槽位）程序化瞬间失效。
        // 正确判别依据：inst.vmdPath。程序化动作 vmdPath 恒为 null（_startProcMotion 显式置空），
        // 用户/场景 VMD 则必有非空 vmdPath（applyIntentToModel / loadVMDFromPath 写入）。
        const hasUserVmd = !!model?.vmdPath;
        const mode = st.mode;
        const wantAutoDance = shouldAutoDance(audioOn, mode);
        const wantIdle = shouldIdle(audioOn, hasUserVmd, mode);

        if (hasUserVmd && targetModelId && this._activeModels.has(targetModelId)) {
            // [fix:P2] 仅停止焦点模型：用户为该模型加载 VMD，不应清空其他模型的程序化
            this.stopProcMotion(targetModelId);
            return;
        }

        if (wantAutoDance && !hasUserVmd && this._beatDetector) {
            const bpm = this._beatDetector.getBPM() ?? 120;
            // [fix:P2] per-model 判断：读目标模型自己的 kind/bpm，而非全局单值
            const cur = targetModelId ? this._modelProcState.get(targetModelId) : undefined;
            if (!cur || cur.kind !== 'autodance' || Math.abs(bpm - cur.bpm) > 10) {
                await this._startProcMotion('autodance', bpm, targetModelId);
            }
            return;
        }

        if (wantIdle && !hasUserVmd) {
            // [fix:P2] per-model 判断：目标模型无记录或非 idle 才启动
            const cur = targetModelId ? this._modelProcState.get(targetModelId) : undefined;
            if (!cur || cur.kind !== 'idle') {
                await this._startProcMotion('idle', undefined, targetModelId);
            }
            return;
        }
    }

    regenerateProcMotion(
        /** [P5 per-slot] 显式指定目标模型；不传时回退到焦点模型（向后兼容）。 */
        modelId?: string
    ): void {
        const st = this._refProcState(modelId);
        // [fix] mode === 'off' 时立刻停掉程序化，不继续往下走到 idle 重启动
        if (st.mode === 'off') {
            // [fix:P2] 仅停止目标模型：regenerateProcMotion(modelId) 不应清空其他活跃模型
            if (modelId && this._activeModels.has(modelId)) {
                this.stopProcMotion(modelId);
            }
            return;
        }
        // 以下执行 regenerate（冷启动或热更新均走此路径）
        // [P5 per-slot] 优先使用传入的 modelId；否则回退到焦点
        const targetModel = modelId
            ? (modelManager.get(modelId)?.mmdModel ?? null)
            : focusedMmdModel();
        if (!targetModel) {
            logWarn('proc-motion', 'regenerateProcMotion: 无目标 MMD 模型，跳过');
            return;
        }
        // Issue #4: 如果 regenerate 调用时正在生成，标记 deferred 重跑
        if (this._starting) {
            this._regeneratePending = true;
            return;
        }
        const mode =
            this._refProcState(modelId).mode === 'autodance'
                ? ('autodance' as const)
                : ('idle' as const);
        // Issue #5: _beatDetector 可能为 null
        const bpm = this._beatDetector?.getBPM() ?? 120;
        this._startProcMotion(mode, mode === 'autodance' ? bpm : undefined, modelId);
    }

    /** 释放全部资源，重置为初始状态。 */
    dispose(): void {
        this.stopProcMotion();
        this._beatDetector = safeDispose(this._beatDetector);
        this._fallbackProcState = { ...DEFAULT_PROC_STATE };
        this._regeneratePending = false;
        this._stopRequested = false;
        this._starting = false;
        this._modelProcState.clear();
    }
}
