// [doc:architecture] Ragdoll Manager — 布偶模拟控制器
// 从 cloth-manager.ts 提取，职责: 布偶创建/销毁/重建
// UI 层通过 toggleRagdoll / recreateRagdoll 调用，不再寄生菜单文件

import { SdfCollider, DEFAULT_BODY_CAPSULES } from './xpbd-collider';
import type { CapsuleSpec } from './xpbd-collider';
import {
  buildRagdoll,
  stepRagdoll,
  writeBack,
  DEFAULT_RAGDOLL_JOINT_PARAMS,
  RAGDOLL_JOINT_GROUPS,
  type RagdollInstance,
  type RagdollJointParams,
} from './xpbd-ragdoll';
import { XpbdRenderer } from './xpbd-renderer';
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

/** 调试可视化渲染器（懒加载；全部 debug 关闭时销毁释放网格） */
let _renderer: XpbdRenderer | null = null;

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
    updateRagdollDebugVisualization(inst);
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

// ======== 关节参数 API ========

/** 设置单个关节的物理参数（按骨骼名索引，合并到 envState.ragdollJointParams）
 *  热更新：若布偶已存在，重建约束以应用新参数
 */
export function setRagdollJointParams(jointName: string, params: Partial<RagdollJointParams>): void {
  const existing = envState.ragdollJointParams?.[jointName] ?? DEFAULT_RAGDOLL_JOINT_PARAMS;
  const merged: RagdollJointParams = { ...DEFAULT_RAGDOLL_JOINT_PARAMS, ...existing, ...params };
  if (!envState.ragdollJointParams) envState.ragdollJointParams = {};
  envState.ragdollJointParams[jointName] = merged;
  // 热更新：若 ragdoll 已存在，重建约束以应用新参数
  if (_ragdollInstance) {
    recreateRagdoll();
  }
}

/** 对关节组套用 loose/normal/stiff 预设（按 compliance/stiffness 缩放） */
export function applyRagdollJointPreset(group: string, preset: 'loose' | 'normal' | 'stiff'): void {
  const multipliers: Record<string, number> = { loose: 0.5, normal: 1, stiff: 1.5 };
  const m = multipliers[preset];
  if (m === undefined) return;
  const g = RAGDOLL_JOINT_GROUPS[group];
  if (!g) return;
  setRagdollJointParams(group, {
    compliance: g.params.compliance * m,
    stiffness: Math.min(1, g.params.stiffness * m),
    damping: g.params.damping,
    coneHalfAngle: g.params.coneHalfAngle,
    twistRange: g.params.twistRange,
  });
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

/** 获取或创建调试渲染器（懒加载；创建时套用当前 debug 开关状态） */
function _getRenderer(): XpbdRenderer | null {
  if (!_scene) return null;
  if (!_renderer) {
    _renderer = new XpbdRenderer(_scene);
    _renderer.showParticles(envState.ragdollDebugParticles);
    _renderer.showConstraints(envState.ragdollDebugConstraints);
    _renderer.showColliders(envState.ragdollDebugColliders);
  }
  return _renderer;
}

/** 开关粒子可视化 */
export function setRagdollDebugParticles(enabled: boolean): void {
  envState.ragdollDebugParticles = enabled;
  _getRenderer()?.showParticles(enabled);
  _syncDebugUpdateFn();
}

/** 开关约束可视化 */
export function setRagdollDebugConstraints(enabled: boolean): void {
  envState.ragdollDebugConstraints = enabled;
  _getRenderer()?.showConstraints(enabled);
  _syncDebugUpdateFn();
}

/** 开关碰撞体可视化 */
export function setRagdollDebugColliders(enabled: boolean): void {
  envState.ragdollDebugColliders = enabled;
  _getRenderer()?.showColliders(enabled);
  _syncDebugUpdateFn();
}

/** 同步调试渲染器生命周期：全部 debug 关闭时销毁渲染器释放网格 */
function _syncDebugUpdateFn(): void {
  const anyOn =
    envState.ragdollDebugParticles ||
    envState.ragdollDebugConstraints ||
    envState.ragdollDebugColliders;
  if (!anyOn && _renderer) {
    _renderer.dispose();
    _renderer = null;
  }
}

/** 每帧更新调试可视化（由 ragdoll updateFn 调用，纯展示不参算） */
function updateRagdollDebugVisualization(inst: RagdollInstance): void {
  const r = _getRenderer();
  if (!r) return;
  if (envState.ragdollDebugParticles) {
    r.updateParticles(inst.solver);
  }
  if (envState.ragdollDebugConstraints) {
    r.updateConstraints(inst.solver);
  }
  if (envState.ragdollDebugColliders && _currentCollider) {
    r.updateColliders(_currentCollider);
  }
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
