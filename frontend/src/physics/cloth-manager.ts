// [doc:architecture] Cloth Manager — 布料模拟控制器
// 从 scene-menu.ts 提取，职责: 布料创建/销毁/重建
// UI 层通过 toggleCloth / recreateCloth 调用，不再寄生菜单文件

import { SdfCollider, DEFAULT_BODY_CAPSULES } from './xpbd-collider';
import type { CapsuleSpec } from './xpbd-collider';
import { createCloth, buildClothUpdateFn, setDebugUpdateFn } from './xpbd-cloth';
import { XpbdRenderer } from './xpbd-renderer';
import { scene, modelManager } from '../scene/scene';
import { focusedModelId, envState, setStatus } from '../core/config';

/** 当前布料的碰撞体引用 */
let _currentCollider: SdfCollider | null = null;

/** 当前布料重力倍率（与 WASM 共用同一 slider，独立追踪避免耦合） */
let _clothGravity = 1.0;

/** 调试可视化渲染器 */
let _renderer: XpbdRenderer | null = null;

/** 为当前聚焦模型创建布料 */
function _createClothForFocusedModel(): void {
    const id = focusedModelId;
    if (!id || !modelManager) {
        setStatus('⚠ 请先加载模型', false);
        return;
    }

    // 防止重复创建（UI 多次点击）
    if (modelManager.clothInstances.has(id)) {
        setStatus('⚠ 布料已存在', false);
        return;
    }

    const mmd = modelManager.focusedMmdModel();
    if (!mmd) {
        setStatus('⚠ 当前模型无 MMD 数据', false);
        return;
    }

    // Build SDF collider
    const collider = new SdfCollider();
    collider.init(DEFAULT_BODY_CAPSULES);
    _currentCollider = collider;

    // Scale collider to match model size
    const model = modelManager.modelRegistry.get(id);
    if (model && model.rootMesh) {
        const boundingInfo = model.rootMesh.getBoundingInfo();
        if (boundingInfo) {
            const modelHeight =
                boundingInfo.boundingBox.maximumWorld.y - boundingInfo.boundingBox.minimumWorld.y;
            if (modelHeight > 0.001) {
                const defaultHeight = 2.0;
                const scaleFactor = modelHeight / defaultHeight;
                collider.scaleAll(Math.max(0.5, Math.min(2.0, scaleFactor)));
            }
        }
    }

    // Build anchor matrix function
    const anchorMatrixFn = (boneName: string): Float32Array | null => {
        return modelManager.getBoneWorldMatrix(boneName);
    };

    // Build bone parent map for dynamic capsule sizing
    const boneParentMap: Record<string, string> = {};
    const mmdForBones = modelManager.focusedMmdModel();
    if (mmdForBones) {
        for (const bone of mmdForBones.runtimeBones) {
            if (bone.parentBone) {
                boneParentMap[bone.name] = bone.parentBone.name;
            }
        }
    }

    // Dynamically size capsules based on actual bone distances
    collider.updateCapsuleSizes(anchorMatrixFn, boneParentMap);

    // Use config from envState
    let cfg = { ...envState.clothConfig };

    // 首次创建（innerRadius == 1.0 是旧默认值笔误）时自动推算尺寸
    if (cfg.innerRadius >= 0.9) {
        const fitted = autoFitClothDimensions(
            cfg.anchorBone || '腰',
            anchorMatrixFn,
            mmdForBones?.runtimeBones ?? [],
        );
        cfg.innerRadius = fitted.innerRadius;
        cfg.length = fitted.length;
        // 回写到 envState 以便 UI 同步
        envState.clothConfig = { ...envState.clothConfig, ...cfg };
    }

    // Create cloth
    const cloth = createCloth(scene, cfg, collider);
    // 应用全局 solver substeps
    cloth.solver.substeps = envState.solverSubsteps;
    // 应用全局重力
    cloth.solver.setGravity(0, -9.8 * _clothGravity, 0);

    // Build update function (with time scale getter)
    const updateFn = buildClothUpdateFn(cloth, anchorMatrixFn, collider, () => envState.solverTimeScale);

    // Register with model manager
    modelManager.addCloth(id, cloth, updateFn);

    // 应用当前碰撞状态到新布料
    _applyCollisionState();

    // 设置调试更新回调（如果调试可视化已启用）
    if (envState.clothDebugParticles || envState.clothDebugConstraints || envState.clothDebugColliders) {
        setDebugUpdateFn((solver, coll) => updateDebugVisualization(solver, coll));
    }

    setStatus(
        `✓ 布料已创建 (${cloth.solver.particles.length} 粒子, ${cloth.solver.constraints.length} 约束, mesh: ${cloth.mesh ? 'ok' : 'null'})`,
        true,
    );
}

/** 销毁当前聚焦模型的布料 */
function _destroyClothForFocusedModel(): void {
    const id = focusedModelId;
    if (!id || !modelManager) {
        return;
    }
    modelManager.removeCloth(id);
}

// ======== 公开 API ========

/** 切换布料模拟开关 */
export function toggleCloth(enabled: boolean): void {
    if (enabled) {
        _createClothForFocusedModel();
    } else {
        _destroyClothForFocusedModel();
    }
    envState.clothEnabled = enabled;
    _reportClothStatus();
}

/** 用当前配置重建布料（参数变更后调用）
 * @returns true 表示重建成功，false 表示布料未启用
 */
export function recreateCloth(): boolean {
    if (!envState.clothEnabled) {
        return false;
    }
    _destroyClothForFocusedModel();
    _createClothForFocusedModel();
    return true;
}

// ======== 自动推算布料尺寸 ========

/**
 * 从模型骨骼实际位置推算布料尺寸参数。
 *
 * @param anchorBoneName 锚定骨骼名（如 "腰"）
 * @param getBoneMatrix 获取骨骼世界矩阵的函数
 * @param bones MMD 运行时骨骼列表（含 parentBone 引用）
 * @returns 推算出的 innerRadius 和 length（已 clamp 到合理范围）
 */
export function autoFitClothDimensions(
    anchorBoneName: string,
    getBoneMatrix: (name: string) => Float32Array | null,
    bones: ReadonlyArray<{ name: string; parentBone: { name: string } | null; worldMatrix: Float32Array }>,
): { innerRadius: number; length: number } {
    const DEFAULTS = { innerRadius: 0.12, length: 0.6 };

    const anchorMat = getBoneMatrix(anchorBoneName);
    if (!anchorMat) return DEFAULTS;

    const anchorBone = bones.find((b) => b.name === anchorBoneName);
    if (!anchorBone) return DEFAULTS;

    // --- innerRadius：锚骨骼与父骨骼的距离 × 0.8 ---
    const parentName = anchorBone.parentBone?.name;
    const parentMat = parentName ? getBoneMatrix(parentName) : null;
    let innerRadius = DEFAULTS.innerRadius;
    if (parentMat) {
        const dx = anchorMat[12] - parentMat[12];
        const dy = anchorMat[13] - parentMat[13];
        const dz = anchorMat[14] - parentMat[14];
        const boneLen = Math.sqrt(dx * dx + dy * dy + dz * dz);
        if (boneLen > 0.01) {
            innerRadius = boneLen * 0.8;
        }
    }

    // --- length：从锚骨骼向下找最远的末端骨骼，用 Y 轴垂直距离 ---
    // 典型链：腰 → 下半身 → 左足 → 左ひざ → 左足首
    const anchorY = anchorMat[13];
    let minY = anchorY;
    // 找所有从锚骨骼向下可达的骨骼（BFS，最多 6 层）
    const visited = new Set<string>([anchorBoneName]);
    let frontier: string[] = [anchorBoneName];
    for (let depth = 0; depth < 6 && frontier.length > 0; depth++) {
        const next: string[] = [];
        for (const name of frontier) {
            for (const b of bones) {
                if (b.parentBone?.name === name && !visited.has(b.name)) {
                    visited.add(b.name);
                    next.push(b.name);
                    const mat = getBoneMatrix(b.name);
                    if (mat && mat[13] < minY) {
                        minY = mat[13];
                    }
                }
            }
        }
        frontier = next;
    }

    const verticalSpan = anchorY - minY; // 正值 = 从腰往下到最远末端
    let length = DEFAULTS.length;
    if (verticalSpan > 0.05) {
        // 裙长取垂直跨度的 40%~60%（裙不到脚踝，留有余量）
        length = verticalSpan * 0.5;
    }

    return {
        innerRadius: Math.max(0.03, Math.min(innerRadius, 0.5)),
        length: Math.max(0.1, Math.min(length, 2.0)),
    };
}

// ======== 碰撞体参数 API ========

/** 获取当前碰撞体（无布料时返回 null） */
export function getCollider(): SdfCollider | null {
    return _currentCollider;
}

/** 获取碰撞体规格列表 */
export function getColliderSpecs(): CapsuleSpec[] {
    if (!_currentCollider) return [];
    return _currentCollider.capsules.map((c) => ({
        name: c.name,
        boneName: c.boneName,
        radius: c.radius,
        halfHeight: c.halfHeight,
    }));
}

/** 设置单个碰撞体的半径 */
export function setCapsuleRadius(name: string, radius: number): void {
    if (!_currentCollider) return;
    const c = _currentCollider.capsules.find((c) => c.name === name);
    if (c) {
        c.radius = radius;
    }
}

/** 设置单个碰撞体的半高 */
export function setCapsuleHalfHeight(name: string, halfHeight: number): void {
    if (!_currentCollider) return;
    const c = _currentCollider.capsules.find((c) => c.name === name);
    if (c) {
        c.halfHeight = halfHeight;
    }
}

/** 设置碰撞体刚度 */
export function setColliderStiffness(stiffness: number): void {
    if (!_currentCollider) return;
    _currentCollider.stiffness = stiffness;
}

/** 设置碰撞体摩擦系数 */
export function setColliderFriction(friction: number): void {
    if (!_currentCollider) return;
    _currentCollider.friction = friction;
}

/** 开关单个碰撞体 */
export function setCapsuleEnabled(name: string, enabled: boolean): void {
    if (!_currentCollider) return;
    _currentCollider.setEnabledByName(name, enabled);
}

/** 全部开关碰撞体 */
export function setAllCapsulesEnabled(enabled: boolean): void {
    if (!_currentCollider) return;
    _currentCollider.setAllEnabled(enabled);
}

// ======== 调试可视化 API ========

/** 获取或创建调试渲染器 */
function _getRenderer(): XpbdRenderer {
    if (!_renderer && scene) {
        _renderer = new XpbdRenderer(scene);
    }
    return _renderer!;
}

/** 开关粒子可视化 */
export function setDebugParticles(enabled: boolean): void {
    envState.clothDebugParticles = enabled;
    const r = _getRenderer();
    if (r) r.showParticles(enabled);
    _syncDebugUpdateFn();
}

/** 开关约束可视化 */
export function setDebugConstraints(enabled: boolean): void {
    envState.clothDebugConstraints = enabled;
    const r = _getRenderer();
    if (r) r.showConstraints(enabled);
    _syncDebugUpdateFn();
}

/** 开关碰撞体可视化 */
export function setDebugColliders(enabled: boolean): void {
    envState.clothDebugColliders = enabled;
    const r = _getRenderer();
    if (r) r.showColliders(enabled);
    _syncDebugUpdateFn();
}

/** 同步调试更新回调 */
function _syncDebugUpdateFn(): void {
    if (envState.clothDebugParticles || envState.clothDebugConstraints || envState.clothDebugColliders) {
        setDebugUpdateFn((solver, coll) => updateDebugVisualization(solver, coll));
    } else {
        setDebugUpdateFn(null);
    }
}

/** 获取调试状态 */
export function getDebugState(): { particles: boolean; constraints: boolean; colliders: boolean } {
    return {
        particles: envState.clothDebugParticles,
        constraints: envState.clothDebugConstraints,
        colliders: envState.clothDebugColliders,
    };
}

/** 更新调试可视化（每帧调用） */
export function updateDebugVisualization(solver: import('./xpbd-solver').XpbdSolver, collider: SdfCollider | null): void {
    const r = _getRenderer();
    if (!r) return;

    if (envState.clothDebugParticles) {
        r.updateParticles(solver);
    }
    if (envState.clothDebugConstraints) {
        r.updateConstraints(solver);
    }
    if (envState.clothDebugColliders && collider) {
        r.updateColliders(collider);
    }
}

/** 销毁调试渲染器 */
export function disposeDebugRenderer(): void {
    if (_renderer) {
        _renderer.dispose();
        _renderer = null;
    }
    envState.clothDebugParticles = false;
    envState.clothDebugConstraints = false;
    envState.clothDebugColliders = false;
}

// ======== 碰撞状态同步（内部）========

/** 应用当前 envState 碰撞开关到所有布料和碰撞体 */
function _applyCollisionState(): void {
    const groundEffective = envState.collisionEnabled && envState.groundCollisionEnabled;
    const bodyEffective = envState.collisionEnabled && envState.bodyCollisionEnabled;

    for (const [, cloth] of modelManager.clothInstances) {
        if (cloth && cloth.solver) {
            cloth.solver.groundCollisionEnabled = groundEffective;
        }
    }

    if (_currentCollider) {
        _currentCollider.setAllEnabled(bodyEffective);
    }
}

// ======== Solver 参数 API =========

/** 获取全局 solver 迭代次数 */
export function getSolverSubsteps(): number {
    return envState.solverSubsteps;
}

/** 设置全局 solver 迭代次数（更新现有布料 + 新建布料默认值） */
export function setSolverSubsteps(v: number): void {
    envState.solverSubsteps = v;
    for (const [, cloth] of modelManager.clothInstances) {
        if (cloth && cloth.solver) {
            cloth.solver.substeps = v;
        }
    }
}

// ======== 模拟速度 API =========

/** 获取模拟速度倍率 */
export function getTimeScale(): number {
    return envState.solverTimeScale;
}

/** 设置模拟速度倍率（实时生效） */
export function setTimeScale(v: number): void {
    envState.solverTimeScale = v;
}

// ======== 布料重力 API =========

/** 设置布料重力倍率（应用到所有现有布料） */
export function setClothGravity(scale: number): void {
    _clothGravity = scale;
    for (const [, cloth] of modelManager.clothInstances) {
        if (cloth && cloth.solver) {
            cloth.solver.setGravity(0, -9.8 * scale, 0);
        }
    }
}

// ======== 碰撞 API =========

/** 获取碰撞主开关状态 */
export function getCollisionEnabled(): boolean {
    return envState.collisionEnabled;
}

/** 设置碰撞主开关 */
export function setCollisionEnabled(v: boolean): void {
    envState.collisionEnabled = v;
    _applyCollisionState();
}

/** 获取身体碰撞开关状态 */
export function getBodyCollisionEnabled(): boolean {
    return envState.bodyCollisionEnabled;
}

/** 设置身体碰撞开关 */
export function setBodyCollisionEnabled(v: boolean): void {
    envState.bodyCollisionEnabled = v;
    _applyCollisionState();
}

/** 获取地面碰撞开关状态（从 envState） */
export function getGroundCollisionEnabled(): boolean {
    return envState.groundCollisionEnabled;
}

/** 设置地面碰撞开关 */
export function setGroundCollisionEnabled(v: boolean): void {
    envState.groundCollisionEnabled = v;
    _applyCollisionState();
}

// ======== 诊断 API ========

/** 布料状态诊断信息 */
export interface ClothDiagnostics {
    enabled: boolean;
    instanceCount: number;
    activeModelIds: string[];
    currentMeshVisible: boolean;
    particleCount: number;
    constraintCount: number;
}

/** 获取当前布料诊断信息 */
export function getClothDiagnostics(): ClothDiagnostics {
    const instances = modelManager ? Array.from(modelManager.clothInstances.entries()) : [];
    const focusedId = focusedModelId || '';
    const focusedCloth = modelManager?.clothInstances.get(focusedId);
    return {
        enabled: envState.clothEnabled,
        instanceCount: instances.length,
        activeModelIds: instances.map(([id]) => id),
        currentMeshVisible: focusedCloth?.mesh?.isVisible ?? false,
        particleCount: focusedCloth?.solver?.particles?.length ?? 0,
        constraintCount: focusedCloth?.solver?.constraints?.length ?? 0,
    };
}

/** 在状态栏报告布料状态 */
function _reportClothStatus(): void {
    const diag = getClothDiagnostics();
    if (diag.enabled) {
        if (diag.instanceCount > 0) {
            setStatus(
                `✓ 布料模拟已启用 (${diag.instanceCount} 例, ${diag.particleCount} 粒子, ${diag.constraintCount} 约束)`,
                true,
            );
        } else {
            setStatus('⚠ 布料已启用但未找到活跃实例', false);
        }
    } else {
        setStatus('布料模拟已关闭', true);
    }
}
