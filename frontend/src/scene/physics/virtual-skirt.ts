/**
 * virtual-skirt.ts — ADR-084 Phase 2-3: WASM Bullet 注入 + 顶点回写
 *
 * 运行时将 Phase 1 拓扑分析得到的虚拟裙骨链，注入 WASM Bullet 物理世界：
 *   · 链头 Kinematic 盒子锚定体（跟随腰骨）
 *   · 链身 Dynamic 球体 + Generic6DofSpringConstraint 弹簧链
 *   · 每帧 PerFrameUpdateRegistry 调度：锚定体跟随腰骨 + 读刚体位移 → 写回 mesh 顶点
 *
 * 设计约束（ADR-081 教训）：本模块不被 scene.ts 启动期 eager 导入，
 * 仅由用户显式开启虚拟裙骨时按需 `await import()`。
 *
 * 关联：skirt-analyzer.ts（Phase 1）、physics-bridge.ts（PerFrameUpdateRegistry / getBoneWorldPosition）
 */

import { Matrix, Vector3 } from '@babylonjs/core/Maths/math.vector';
import type { Scene } from '@babylonjs/core/scene';
import { VertexBuffer } from '@babylonjs/core/Buffers/buffer';
import type { IMmdModel } from 'babylon-mmd/esm/Runtime/IMmdModel';
import type { MmdWasmRuntime } from 'babylon-mmd/esm/Runtime/Optimized/mmdWasmRuntime';
import { MmdWasmPhysicsRuntimeImpl } from 'babylon-mmd/esm/Runtime/Optimized/Physics/mmdWasmPhysicsRuntimeImpl';
import type { MmdWasmPhysicsRuntime } from 'babylon-mmd/esm/Runtime/Optimized/Physics/mmdWasmPhysicsRuntime';
import { RigidBody } from 'babylon-mmd/esm/Runtime/Optimized/Physics/Bind/rigidBody';
import { RigidBodyConstructionInfo } from 'babylon-mmd/esm/Runtime/Optimized/Physics/Bind/rigidBodyConstructionInfo';
import { Generic6DofSpringConstraint } from 'babylon-mmd/esm/Runtime/Optimized/Physics/Bind/constraint';
import { PhysicsSphereShape, PhysicsBoxShape } from 'babylon-mmd/esm/Runtime/Optimized/Physics/Bind/physicsShape';
import { MotionType } from 'babylon-mmd/esm/Runtime/Optimized/Physics/Bind/motionType';
import { analyzeSkirt } from './skirt-analyzer';
import { PerFrameUpdateRegistry, getBoneWorldPosition } from '../../physics/physics-bridge';
import { isAndroidPlatform } from '../../core/platform';

// ============================================================================
// 配置
// ============================================================================

export interface VirtualSkirtConfig {
    /** 开关 */
    enabled: boolean;
    /** 质量档位（auto 在 Android 上自动降为 low，桌面为 high） */
    quality: VirtualSkirtQuality;
    /** 链数（4-32） */
    chains: number;
    /** 每链骨节数（4-16） */
    segmentsPerChain: number;
    /** 弹簧刚度（10-200） */
    stiffness: number;
    /** 弹簧阻尼（0-1） */
    damping: number;
    /** 单骨节质量（0.01-0.5） */
    mass: number;
    /** 碰撞球半径（0 = 自动推算） */
    radius: number;
    /** 顶点数上限（性能保护，默认 2000；会被质量档位进一步收紧） */
    maxVertices: number;
    /** Y 阈值比例（裙摆区域判定） */
    skirtYRatio: number;
}

/** 质量档位：auto 按平台自动解析，其余为固定档 */
export type VirtualSkirtQuality = 'auto' | 'high' | 'medium' | 'low';

/** 质量档位 → LOD 上限 + 降频步长 + 顶点硬上限 */
interface QualityPreset {
    /** 链数上限（LOD：物理刚体数量上限） */
    chainsCap: number;
    /** 每链骨节数上限（LOD） */
    segmentsCap: number;
    /** 顶点回写降频：每 N 帧写回一次（1 = 每帧） */
    throttleEvery: number;
    /** 顶点数硬上限（超过则跳过该模型） */
    maxVertices: number;
}

export const QUALITY_PRESETS: Record<Exclude<VirtualSkirtQuality, 'auto'>, QualityPreset> = {
    high:   { chainsCap: 32, segmentsCap: 16, throttleEvery: 1, maxVertices: 4000 },
    medium: { chainsCap: 16, segmentsCap: 10, throttleEvery: 2, maxVertices: 2500 },
    low:    { chainsCap: 10, segmentsCap: 6,  throttleEvery: 3, maxVertices: 1500 },
};

/**
 * Phase 5: 解析有效质量档位。
 * `auto` 在 Android 上降为 `low`（低端机减负），桌面保持 `high`。
 * 纯函数，便于单测，且不依赖运行期平台探测副作用。
 */
export function resolveVirtualSkirtQuality(
    quality: VirtualSkirtQuality,
    isAndroid: boolean,
): Exclude<VirtualSkirtQuality, 'auto'> {
    if (quality === 'auto') return isAndroid ? 'low' : 'high';
    return quality;
}

export const defaultVirtualSkirtConfig: VirtualSkirtConfig = {
    enabled: false,
    quality: 'auto',
    chains: 12,
    segmentsPerChain: 8,
    stiffness: 50,
    damping: 0.3,
    mass: 0.05,
    radius: 0,
    maxVertices: 2000,
    skirtYRatio: 0.3,
};

/** 腰骨候选名（按优先级） */
const WAIST_BONE_CANDIDATES = ['Waist', 'センター', 'Center', '腰', '上半身'];
/** 期望锚定体半尺寸（米） */
const ANCHOR_HALF_SIZE = 0.08;

// ============================================================================
// 控制器
// ============================================================================

/**
 * 虚拟裙骨物理控制器。
 * 生命周期：build() 注入 → 每帧 _update() → dispose() 释放。
 */
export class VirtualSkirtController {
    private impl: MmdWasmPhysicsRuntimeImpl | null = null;
    private worldId = -1;

    private anchorRb: RigidBody | null = null;
    private anchorInfo: RigidBodyConstructionInfo | null = null;
    private anchorShape: PhysicsBoxShape | null = null;

    private readonly segmentRbs: RigidBody[] = [];
    private readonly segmentInfos: RigidBodyConstructionInfo[] = [];
    private readonly segmentShapes: PhysicsSphereShape[] = [];
    private readonly constraints: Generic6DofSpringConstraint[] = [];

    private analysis: ReturnType<typeof analyzeSkirt> | null = null;
    private registry: PerFrameUpdateRegistry | null = null;
    /** mesh rest pose 快照（Phase 3 顶点回写基准） */
    private restPositions: Float32Array | null = null;
    /** 重建后 new 出来的对象类型标记，供 tsc 推断 */
    private readonly _tmpMatrix = new Matrix();
    /** 每帧回写复用的临时矩阵缓冲（避免 per-frame GC） */
    private readonly _tmpArray = new Float32Array(16);
    /** 每帧回写复用的顶点工作缓冲（避免 per-frame alloc） */
    private _workBuf: Float32Array | null = null;
    /** Phase 5: 降频帧计数器 */
    private _frame = 0;
    /** Phase 5: 解析后的有效质量档位 */
    private _effectiveQuality: VirtualSkirtQuality = 'high';
    /** Phase 5: 有效降频步长（每 N 帧写回） */
    private _throttleEvery = 1;
    /** Phase 5: LOD 生效后的有效链数（供状态读取） */
    private _effectiveChains = 0;
    /** Phase 5: LOD 生效后的有效骨节数（供状态读取） */
    private _effectiveSegments = 0;
    private _disposed = false;

    constructor(
        private readonly model: IMmdModel,
        private readonly scene: Scene,
        private readonly wasmRuntime: MmdWasmRuntime,
        private readonly config: VirtualSkirtConfig,
    ) {}

    /**
     * 注入虚拟裙骨链到 WASM Bullet 物理世界。
     * @returns 是否成功注入（false = 模型已有裙骨 / 无裙摆 / 物理不可用）
     */
    build(): boolean {
        if (this._disposed) return false;

        // Phase 5: 质量档位解析 → LOD 上限 + 降频步长 + 顶点硬上限
        const effQuality = resolveVirtualSkirtQuality(this.config.quality, isAndroidPlatform());
        const preset = QUALITY_PRESETS[effQuality];
        this._effectiveQuality = effQuality;
        this._throttleEvery = preset.throttleEvery;
        const effChains = Math.min(this.config.chains, preset.chainsCap);
        const effSegments = Math.min(this.config.segmentsPerChain, preset.segmentsCap);
        this._effectiveChains = effChains;
        this._effectiveSegments = effSegments;
        const maxVerts = Math.min(this.config.maxVertices, preset.maxVertices);
        this._frame = 0;

        const mesh = this.model.mesh;
        const positions = mesh.getVerticesData(VertexBuffer.PositionKind);
        const rawIndices = mesh.getIndices();
        if (!positions || !rawIndices) return false;
        const indices =
            rawIndices instanceof Uint32Array ? rawIndices : new Uint32Array(rawIndices);

        // 顶点数上限保护（质量档位可进一步收紧）
        if (positions.length / 3 > maxVerts) return false;

        const boneNames = this.model.runtimeBones?.map((b) => b.name) ?? [];
        const result = analyzeSkirt(positions, indices, {
            chains: effChains,
            segmentsPerChain: effSegments,
            skirtYRatio: this.config.skirtYRatio,
            boneNames,
            collisionRadius: this.config.radius > 0 ? this.config.radius : undefined,
        });

        if (result.hasExistingSkirtBones) return false;
        if (result.totalSegments === 0) return false;
        this.analysis = result;

        // 获取物理运行时 impl
        const physicsRuntime = this.wasmRuntime.physics as MmdWasmPhysicsRuntime | null;
        if (!physicsRuntime) return false;
        const impl = physicsRuntime.getImpl(MmdWasmPhysicsRuntimeImpl);
        if (!impl) return false;
        this.impl = impl;

        // worldId：优先复用模型自身物理世界（可碰撞模型刚体），否则分配独立 world
        const modelWorldId = (this.model as unknown as { _physicsModel?: { _worldId?: number } })._physicsModel?._worldId;
        this.worldId =
            typeof modelWorldId === 'number' ? modelWorldId : (physicsRuntime.nextWorldId++);

        const wasmInstance = impl.wasmInstance;

        // --- 锚定体（Kinematic 盒子，跟随腰骨） ---
        const waistName = WAIST_BONE_CANDIDATES.find(
            (n) => this.model.runtimeBones?.some((b) => b.name === n),
        );
        const waistPos = waistName
            ? getBoneWorldPosition(this.model, waistName)
            : null;
        const ax = waistPos?.x ?? 0;
        const ay = waistPos?.y ?? 0.8;
        const az = waistPos?.z ?? 0;

        this.anchorShape = new PhysicsBoxShape(
            impl,
            new Vector3(ANCHOR_HALF_SIZE, ANCHOR_HALF_SIZE * 0.5, ANCHOR_HALF_SIZE),
        );
        this.anchorInfo = new RigidBodyConstructionInfo(wasmInstance);
        this.anchorInfo.shape = this.anchorShape;
        this.anchorInfo.motionType = MotionType.Kinematic;
        this.anchorInfo.mass = 0;
        this.anchorInfo.setInitialTransform(Matrix.Translation(ax, ay, az));
        this.anchorRb = new RigidBody(impl, this.anchorInfo);
        impl.addRigidBody(this.anchorRb, this.worldId);

        // --- 链身：Dynamic 球体 + 弹簧约束 ---
        const radius =
            this.config.radius > 0
                ? this.config.radius
                : (this.analysis.chains[0]?.segments[0]?.radius ?? 0.02);

        for (const chain of this.analysis.chains) {
            let parent: RigidBody = this.anchorRb;
            for (const seg of chain.segments) {
                const shape = new PhysicsSphereShape(impl, seg.radius || radius);
                const info = new RigidBodyConstructionInfo(wasmInstance);
                info.shape = shape;
                info.motionType = MotionType.Dynamic;
                info.mass = this.config.mass;
                info.linearDamping = 0.1;
                info.angularDamping = 0.3;
                info.friction = 0.5;
                info.restitution = 0.0;
                info.disableDeactivation = true;
                info.setInitialTransform(
                    Matrix.Translation(seg.restPosition[0], seg.restPosition[1], seg.restPosition[2]),
                );
                const rb = new RigidBody(impl, info);
                impl.addRigidBody(rb, this.worldId);
                this.segmentRbs.push(rb);
                this.segmentInfos.push(info);
                this.segmentShapes.push(shape);

                const spring = new Generic6DofSpringConstraint(
                    impl,
                    parent,
                    rb,
                    Matrix.Identity(),
                    Matrix.Identity(),
                    false,
                );
                spring.enableSpring(0, true);
                spring.setStiffness(0, this.config.stiffness);
                spring.enableSpring(1, true);
                spring.setStiffness(1, this.config.stiffness);
                spring.enableSpring(2, true);
                spring.setStiffness(2, this.config.stiffness);
                spring.enableSpring(3, true);
                spring.setStiffness(3, this.config.stiffness * 0.6);
                spring.enableSpring(4, true);
                spring.setStiffness(4, this.config.stiffness * 0.6);
                spring.enableSpring(5, false); // Z 角锁定防扭转
                spring.setDamping(0, this.config.damping);
                spring.setDamping(1, this.config.damping);
                spring.setDamping(2, this.config.damping);
                impl.addConstraint(spring, this.worldId, true);
                this.constraints.push(spring);

                parent = rb;
            }
        }

        // --- Phase 3 准备：rest pose 快照 ---
        this.restPositions = positions instanceof Float32Array ? positions.slice() : Float32Array.from(positions);

        // --- 每帧更新 ---
        this.registry = new PerFrameUpdateRegistry(this.scene);
        this.registry.register('virtual-skirt', () => this._update());

        return true;
    }

    /** 每帧回调：锚定体跟随腰骨 + 顶点回写 */
    private _update(): void {
        // 模型被外部卸载（如切换/删除）时，mesh 已销毁，必须 self-dispose 避免悬空回写
        if (this.model.mesh.isDisposed?.()) {
            this.dispose();
            return;
        }
        if (!this.impl || !this.anchorRb || !this.analysis) return;

        // 锚定体跟随腰骨（Kinematic）
        const waistName = WAIST_BONE_CANDIDATES.find(
            (n) => this.model.runtimeBones?.some((b) => b.name === n),
        );
        if (waistName) {
            const m = (this.model as unknown as { runtimeBones: { name: string; worldMatrix: Float32Array }[] })
                .runtimeBones.find((b) => b.name === waistName)?.worldMatrix;
            if (m) {
                this._tmpMatrix.fromArray(m);
                this.anchorRb.setTransformMatrix(this._tmpMatrix);
            }
        }

        // Phase 5: 降频 — 锚定体每帧跟随腰部，顶点写回按 _throttleEvery 降频
        // (低端机每 N 帧才向 GPU 上传一次位移，物理仍在 WASM 内持续模拟)
        if (this._frame % this._throttleEvery === 0) {
            this._writeBackVertices();
        }
        this._frame++;
    }

    /** Phase 3：读刚体世界位移 → 按权重写回 mesh 顶点 */
    private _writeBackVertices(): void {
        if (!this.restPositions || !this.analysis || this.segmentRbs.length === 0) return;

        const rest = this.restPositions;
        if (!rest) return;
        // 复用类成员工作缓冲，避免每帧 new Float32Array（GC 压力）
        if (!this._workBuf || this._workBuf.length !== rest.length) {
            this._workBuf = new Float32Array(rest.length);
        }
        const buf = this._workBuf;
        buf.set(rest); // 基准 = 静态 rest pose
        const tmp = this._tmpArray;
        let rbIdx = 0;

        for (const chain of this.analysis.chains) {
            for (const seg of chain.segments) {
                const rb = this.segmentRbs[rbIdx++];
                rb.getTransformMatrixToArray(tmp, 0);
                const dx = tmp[12] - seg.restPosition[0];
                const dy = tmp[13] - seg.restPosition[1];
                const dz = tmp[14] - seg.restPosition[2];
                for (let i = 0; i < seg.vertexIndices.length; i++) {
                    const v = seg.vertexIndices[i];
                    const w = seg.weights[i];
                    buf[v * 3] += dx * w;
                    buf[v * 3 + 1] += dy * w;
                    buf[v * 3 + 2] += dz * w;
                }
            }
        }

        this.model.mesh.updateVerticesData(VertexBuffer.PositionKind, buf, false, false);
    }

    /**
     * 释放所有物理资源。顺序（ADR-084 §五）：
     * removeConstraint → removeRigidBody → rb.dispose → constraint.dispose → info.dispose → shape.dispose
     */
    dispose(): void {
        if (this._disposed) return;
        this._disposed = true;

        this.registry?.unregister('virtual-skirt');
        this.registry = null;

        const impl = this.impl;
        if (!impl) return;
        const worldId = this.worldId;

        for (const c of this.constraints) impl.removeConstraint(c, worldId);
        for (const rb of this.segmentRbs) impl.removeRigidBody(rb, worldId);
        if (this.anchorRb) impl.removeRigidBody(this.anchorRb, worldId);

        for (const c of this.constraints) c.dispose();
        this.constraints.length = 0;

        for (const rb of this.segmentRbs) rb.dispose();
        this.segmentRbs.length = 0;
        if (this.anchorRb) this.anchorRb.dispose();
        this.anchorRb = null;

        for (const info of this.segmentInfos) info.dispose();
        this.segmentInfos.length = 0;
        if (this.anchorInfo) this.anchorInfo.dispose();
        this.anchorInfo = null;

        for (const s of this.segmentShapes) s.dispose();
        this.segmentShapes.length = 0;
        if (this.anchorShape) this.anchorShape.dispose();
        this.anchorShape = null;

        this.impl = null;
        this.analysis = null;
        this.restPositions = null;
        this._workBuf = null;
        this._frame = 0;
    }

    /** 已注入的骨节总数 */
    get segmentCount(): number {
        return this.segmentRbs.length;
    }

    /** 已注入的约束总数 */
    get constraintCount(): number {
        return this.constraints.length;
    }

    /** Phase 5: 解析后的有效质量档位 */
    get effectiveQuality(): VirtualSkirtQuality {
        return this._effectiveQuality;
    }

    /** Phase 5: LOD 生效后的有效链数 */
    get effectiveChains(): number {
        return this._effectiveChains;
    }

    /** Phase 5: LOD 生效后的有效骨节数 */
    get effectiveSegments(): number {
        return this._effectiveSegments;
    }

    /** Phase 5: 当前降频步长（每 N 帧写回一次） */
    get throttleEvery(): number {
        return this._throttleEvery;
    }
}
