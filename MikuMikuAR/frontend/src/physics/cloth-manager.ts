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

/** 调试可视化渲染器 */
let _renderer: XpbdRenderer | null = null;

/** 调试可视化状态 */
let _debugParticles = false;
let _debugConstraints = false;
let _debugColliders = false;

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
    const cfg = envState.clothConfig;

    // Create cloth
    const cloth = createCloth(scene, cfg, collider);

    // Build update function
    const updateFn = buildClothUpdateFn(cloth, anchorMatrixFn, collider);

    // Register with model manager
    modelManager.addCloth(id, cloth, updateFn);

    // 设置调试更新回调（如果调试可视化已启用）
    if (_debugParticles || _debugConstraints || _debugColliders) {
        setDebugUpdateFn((solver, coll) => updateDebugVisualization(solver, coll));
    }

    setStatus('✓ 布料模拟已启用', true);
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
    _debugParticles = enabled;
    const r = _getRenderer();
    if (r) r.showParticles(enabled);
    _syncDebugUpdateFn();
}

/** 开关约束可视化 */
export function setDebugConstraints(enabled: boolean): void {
    _debugConstraints = enabled;
    const r = _getRenderer();
    if (r) r.showConstraints(enabled);
    _syncDebugUpdateFn();
}

/** 开关碰撞体可视化 */
export function setDebugColliders(enabled: boolean): void {
    _debugColliders = enabled;
    const r = _getRenderer();
    if (r) r.showColliders(enabled);
    _syncDebugUpdateFn();
}

/** 同步调试更新回调 */
function _syncDebugUpdateFn(): void {
    if (_debugParticles || _debugConstraints || _debugColliders) {
        setDebugUpdateFn((solver, coll) => updateDebugVisualization(solver, coll));
    } else {
        setDebugUpdateFn(null);
    }
}

/** 获取调试状态 */
export function getDebugState(): { particles: boolean; constraints: boolean; colliders: boolean } {
    return {
        particles: _debugParticles,
        constraints: _debugConstraints,
        colliders: _debugColliders,
    };
}

/** 更新调试可视化（每帧调用） */
export function updateDebugVisualization(solver: import('./xpbd-solver').XpbdSolver, collider: SdfCollider | null): void {
    const r = _getRenderer();
    if (!r) return;

    if (_debugParticles) {
        r.updateParticles(solver);
    }
    if (_debugConstraints) {
        r.updateConstraints(solver);
    }
    if (_debugColliders && collider) {
        r.updateColliders(collider);
    }
}

/** 销毁调试渲染器 */
export function disposeDebugRenderer(): void {
    if (_renderer) {
        _renderer.dispose();
        _renderer = null;
    }
    _debugParticles = false;
    _debugConstraints = false;
    _debugColliders = false;
}
