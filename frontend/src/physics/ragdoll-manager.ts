// [doc:architecture] Ragdoll Manager — 布偶模拟控制器
// 从 cloth-manager.ts 提取，职责: 布偶创建/销毁/重建
// UI 层通过 toggleRagdoll / recreateRagdoll 调用，不再寄生菜单文件

import { SdfCollider, DEFAULT_BODY_CAPSULES } from './xpbd-collider';
import type { CapsuleSpec } from './xpbd-collider';
import {
  buildRagdoll,
  stepRagdoll,
  writeBack,
  type RagdollInstance,
} from './xpbd-ragdoll';
import { scene, modelManager } from '../scene/scene';
import { focusedModelId, envState } from '../core/state';
import { setStatus } from '../core/status-bar';
import { t } from '../core/i18n/t';
import { IMmdRuntimeBone } from 'babylon-mmd/esm/Runtime/IMmdRuntimeBone';
import { Scene } from '@babylonjs/core/scene';

/** 当前布偶的碰撞体引用 */
let _currentCollider: SdfCollider | null = null;

/** 当前布偶重力倍率（与 WASM 共用同一 slider，独立追踪避免耦合） */
let _ragdollGravity = 1.0;

/** 当前布偶实例 */
let _ragdollInstance: RagdollInstance | null = null;

/** 当前聚焦模型的布偶 ID */
let _currentRagdollModelId: string | null = null;

/** 布偶是否已初始化 */
let _isRagdollInitialized = false;

/** 场景引用（懒加载） */
let _scene: Scene | null = null;

/** 获取运行时骨骼的函数 */
let _getRuntimeBones: (() => readonly IMmdRuntimeBone[]) | null = null;

// ======== 内部工具函数 ========

/** 为当前聚焦模型创建布偶 */
function _createRagdollForFocusedModel(): boolean {
  const id = focusedModelId;
  if (!id || !modelManager) {
    setStatus(t('physics.loadModelFirst'), false);
    return false;
  }

  // 防止重复创建（UI 多次点击）
  if (_currentRagdollModelId === id) {
    setStatus(t('physics.ragdollExists'), false);
    return false;
  }

  const mmd = modelManager.focusedMmdModel();
  if (!mmd) {
    setStatus(t('physics.noMmdData'), false);
    return false;
  }

  if (!mmd.runtimeBones || mmd.runtimeBones.length === 0) {
    setStatus(t('physics.noBones'), false);
    return false;
  }

  // Build SDF collider
  const collider = new SdfCollider();
  collider.init(DEFAULT_BODY_CAPSULES);
  _currentCollider = collider;

  // 提领模型整体高度（用于 autoFitRagdollDimensions 归一化）
  let modelHeight: number | undefined;

  const model = modelManager.get(id);
  if (model && model.rootMesh) {
    const boundingInfo = model.rootMesh.getBoundingInfo();
    if (boundingInfo) {
      modelHeight =
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
  for (const bone of mmd.runtimeBones) {
    if (bone.parentBone) {
      boneParentMap[bone.name] = bone.parentBone.name;
    }
  }

  // Dynamically size capsules based on actual bone distances
  collider.updateCapsuleSizes(anchorMatrixFn, boneParentMap);

  // Build ragdoll
  const inst = buildRagdoll(id, mmd.runtimeBones);
  
  // Detect WASM mode
  inst.isWasm = !('linkedBone' in mmd.runtimeBones[0]);

  // Build the update function
  const updateFn = (dt: number) => {
    if (!inst.enabled) return;
    stepRagdoll(inst, dt);
    writeBack(inst, inst.isWasm, _getRuntimeBones!);
  };

  // Register with model manager
  modelManager.addRagdoll(id, inst, updateFn);

  // Store instance state
  _ragdollInstance = inst;
  _currentRagdollModelId = id;
  _isRagdollInitialized = true;

  setStatus(
    t('physics.ragdollCreated', {
      particles: inst.particles.length,
      constraints: inst.constraints.length,
      mode: inst.isWasm ? 'WASM' : 'JS',
    }),
    true
  );

  return true;
}

/** 销毁当前聚焦模型的布偶 */
function _disposeRagdollForFocusedModel(): void {
  const id = focusedModelId;
  if (!id || !modelManager) {
    return;
  }

  modelManager.removeRagdoll(id);

  // Clean up collider
  _currentCollider = null;

  // Clean up internal state
  _ragdollInstance = null;
  _currentRagdollModelId = null;
  _isRagdollInitialized = false;
}

// ======== 公开 API ========

/** 初始化布偶系统 */
export function initRagdoll(getBones: () => readonly IMmdRuntimeBone[], scene: Scene): void {
  _getRuntimeBones = getBones;
  _scene = scene;
  
  // 如果布偶已启用，立即创建
  if (envState.ragdollEnabled) {
    _createRagdollForFocusedModel();
  }
}

/** 切换布偶模拟开关 */
export function toggleRagdoll(enabled: boolean): void {
  if (enabled) {
    _createRagdollForFocusedModel();
  } else {
    _disposeRagdollForFocusedModel();
  }
  envState.ragdollEnabled = enabled;
  _reportRagdollStatus();
}

/** 用当前配置重建布偶（参数变更后调用）
 * @returns true 表示重建成功，false 表示布偶未启用
 */
export function recreateRagdoll(): boolean {
  if (!envState.ragdollEnabled) {
    return false;
  }
  _disposeRagdollForFocusedModel();
  return _createRagdollForFocusedModel();
}

// ======== 诊断 API ========

/** 布偶状态诊断信息 */
export interface RagdollDiagnostics {
  enabled: boolean;
  instances: number;
  particles: number;
  constraints: number;
  mode: 'js' | 'wasm' | 'none';
}

/** 获取当前布偶诊断信息 */
export function getRagdollDiagnostics(): RagdollDiagnostics {
  return {
    enabled: envState.ragdollEnabled,
    instances: _ragdollInstance ? 1 : 0,
    particles: _ragdollInstance?.particles.length ?? 0,
    constraints: _ragdollInstance?.constraints.length ?? 0,
    mode: _ragdollInstance ? (_ragdollInstance.isWasm ? 'wasm' : 'js') : 'none',
  };
}

/** 在状态栏报告布偶状态 */
function _reportRagdollStatus(): void {
  const diag = getRagdollDiagnostics();
  if (diag.enabled) {
    if (diag.instances > 0) {
      setStatus(
        t('physics.ragdollEnabled', {
          particles: diag.particles,
          constraints: diag.constraints,
          mode: diag.mode,
        }),
        true
      );
    } else {
      setStatus(t('physics.noActiveInstance'), false);
    }
  } else {
    setStatus(t('physics.ragdollDisabled'), true);
  }
}

// ======== 调试可视化 API ========

/** 开关粒子可视化 */
export function setRagdollDebugParticles(enabled: boolean): void {
  envState.ragdollDebugParticles = enabled;
  _syncDebugUpdateFn();
}

/** 开关约束可视化 */
export function setRagdollDebugConstraints(enabled: boolean): void {
  envState.ragdollDebugConstraints = enabled;
  _syncDebugUpdateFn();
}

/** 开关碰撞体可视化 */
export function setRagdollDebugColliders(enabled: boolean): void {
  envState.ragdollDebugColliders = enabled;
  _syncDebugUpdateFn();
}

/** 同步调试更新回调 */
function _syncDebugUpdateFn(): void {
  // Ragdoll uses the same pattern as cloth-manager
  // The actual visualization would be handled by a renderer if implemented
}

/** 获取调试状态 */
export function getRagdollDebugState(): { particles: boolean; constraints: boolean; colliders: boolean } {
  return {
    particles: envState.ragdollDebugParticles,
    constraints: envState.ragdollDebugConstraints,
    colliders: envState.ragdollDebugColliders,
  };
}

// ======== 碰撞体参数 API ========

/** 获取当前碰撞体（无布偶时返回 null） */
export function getRagdollCollider(): SdfCollider | null {
  return _currentCollider;
}

/** 获取碰撞体规格列表 */
export function getRagdollColliderSpecs(): CapsuleSpec[] {
  if (!_currentCollider) {
    return [];
  }
  return _currentCollider.capsules.map((c) => ({
    name: c.name,
    boneName: c.boneName,
    radius: c.radius,
    halfHeight: c.halfHeight,
  }));
}

/** 设置单个碰撞体的半径 */
export function setRagdollCapsuleRadius(name: string, radius: number): void {
  if (!_currentCollider) {
    return;
  }
  const c = _currentCollider.capsules.find((c) => c.name === name);
  if (c) {
    c.radius = radius;
  }
}

/** 设置单个碰撞体的半高 */
export function setRagdollCapsuleHalfHeight(name: string, halfHeight: number): void {
  if (!_currentCollider) {
    return;
  }
  const c = _currentCollider.capsules.find((c) => c.name === name);
  if (c) {
    c.halfHeight = halfHeight;
  }
}

/** 设置碰撞体刚度 */
export function setRagdollColliderStiffness(stiffness: number): void {
  if (!_currentCollider) {
    return;
  }
  _currentCollider.stiffness = stiffness;
}

/** 设置碰撞体摩擦系数 */
export function setRagdollColliderFriction(friction: number): void {
  if (!_currentCollider) {
    return;
  }
  _currentCollider.friction = friction;
}

/** 开关单个碰撞体 */
export function setRagdollCapsuleEnabled(name: string, enabled: boolean): void {
  if (!_currentCollider) {
    return;
  }
  _currentCollider.setEnabledByName(name, enabled);
}

/** 全部开关碰撞体 */
export function setAllRagdollCapsulesEnabled(enabled: boolean): void {
  if (!_currentCollider) {
    return;
  }
  _currentCollider.setAllEnabled(enabled);
}
