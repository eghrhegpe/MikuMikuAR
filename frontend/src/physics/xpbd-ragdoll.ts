// ============================================================
// XPBD Ragdoll Physics Module
// Builds XPBD particles/constraints from MMD bone topology and writes back to bones
// ADR-061: Motion Override — Ragdoll physics for main-body bones only
// ============================================================

import { XpbdSolver, XpbdParticle, XpbdConstraint } from './xpbd-solver';
import type { IMmdRuntimeBone } from 'babylon-mmd/esm/Runtime/IMmdRuntimeBone';
import { Quaternion, Vector3, Matrix } from '@babylonjs/core/Maths/math.vector';

// ── WASM Runtime Extension ──
interface MmdRuntimeBoneExtended extends IMmdRuntimeBone {
  worldMatrix: Float32Array;
  updateWorldMatrix(updateAbsoluteTransform: boolean, updateLocalTransform: boolean): void;
}

// ── Public Interfaces ──

export interface RagdollInstance {
  solver: XpbdSolver;
  particles: XpbdParticle[];
  constraints: XpbdConstraint[];
  enabled: boolean;
  updateFn: (dt: number) => void;
  dispose: () => void;
  modelId: string;
  isWasm: boolean;
  boneNames: string[]; // index i = particles[i]
}

export interface RagdollDiagnostics {
  enabled: boolean;
  instances: number;
  particles: number;
  constraints: number;
  mode: 'js' | 'wasm' | 'none';
}

// ── Utilities ──

/**
 * Recursively propagate child bone worldMatrix after parent override (WASM mode).
 * Copied from bone-override.ts _propagateChildrenWasm (lines 58-65).
 */
function _propagateChildrenWasm(
  parent: IMmdRuntimeBone,
  parentOldMat: Matrix,
  parentNewMat: Matrix
): void {
  const parentOldInv = new Matrix();
  parentOldInv.copyFrom(parentOldMat);
  parentOldInv.invert();

  for (const child of parent.childBones) {
    const childBuf = (child as MmdRuntimeBoneExtended).worldMatrix;
    if (!childBuf) continue;

    const childOldMat = Matrix.FromArray(childBuf);
    const localMat = new Matrix();
    childOldMat.multiplyToRef(parentOldInv, localMat);

    const childNewMat = new Matrix();
    localMat.multiplyToRef(parentNewMat, childNewMat);

    // Write back worldMatrix buffer
    const arr = childNewMat.asArray();
    for (let i = 0; i < 16; i++) {
      childBuf[i] = arr[i];
    }

    _propagateChildrenWasm(child, childOldMat, childNewMat);
  }
}

// ── Ragdoll Builder ──

export interface BuildRagdollOptions {
  /** Custom ground Y for clamping (default -10) */
  groundY?: number;
}

/**
 * Build XPBD particles and constraints for main-body bones.
 * Skips finger/toe/eye bones (MVP main-body only).
 * @param modelId Unique model identifier
 * @param runtimeBones Readonly array of IMmdRuntimeBone from babylon-mmd
 * @param opts Optional build configuration
 * @returns RagdollInstance ready for stepping
 */
export function buildRagdoll(
  modelId: string,
  runtimeBones: readonly IMmdRuntimeBone[],
  opts: BuildRagdollOptions = {}
): RagdollInstance {
  const groundY = opts.groundY ?? -10;

  // Classify bones and build particles
  const particles: XpbdParticle[] = [];
  const constraints: XpbdConstraint[] = [];
  const boneNames: string[] = [];

  // Helper to check if a bone should be skipped (finger/toe/eye: 细枝末节，物理无意义)。
  // head/頭/首 不跳过：ragdoll 驱动 head 的 position，perception.ts 驱动 head 的 rotation，
  // 两者靠 onBeforeRenderObservable 注册时序分层（ragdoll 在 scene.ts 启动期注册，
  // perception 在模型加载/存档恢复时注册，通常晚于 ragdoll）。
  // 当前 perception 的 _applyHeadGazeJS/_applyHeadGazeWasm 均为"读 position → 写 rotation"，
  // 与 ragdoll 的 position 写入不冲突；但此分层依赖注册顺序，若调整注册时机需重新评估。
  const shouldSkipBone = (name: string): boolean => {
    const lower = name.toLowerCase();
    return lower.includes('finger') || lower.includes('toe') || lower.includes('eye');
  };

  // First pass: create particles for non-skipped bones
  for (const bone of runtimeBones) {
    if (shouldSkipBone(bone.name)) {
      continue;
    }

    const p = new Float32Array(3);
    const prevP = new Float32Array(3);
    const v = new Float32Array(3);

    // Set initial position from worldMatrix translation (cols 12-14)
    p[0] = bone.worldMatrix[12];
    p[1] = bone.worldMatrix[13];
    p[2] = bone.worldMatrix[14];
    prevP[0] = p[0];
    prevP[1] = p[1];
    prevP[2] = p[2];

    // Root detection: names containing "全ての親", "Root", "センター"
    const isRoot = 
      bone.name.includes('全ての親') ||
      bone.name.includes('Root') ||
      bone.name.includes('センター');

    const invMass = isRoot ? 0 : 1.0;

    particles.push({
      p,
      prevP,
      v,
      invMass,
      radius: 0.1,
      orientation: new Float32Array([0, 0, 0, 1]),
      prevOrientation: new Float32Array([0, 0, 0, 1]),
      angularVelocity: new Float32Array(3),
      invInertia: invMass === 0 ? 0 : 1,
    });
    boneNames.push(bone.name);
  }

  // Second pass: create distance constraints to parent bones
  for (let i = 0; i < particles.length; i++) {
    const bone = runtimeBones.find((b) => b.name === boneNames[i])!;
    if (!bone.parentBone) continue; // root has no parent

    const parentIdx = boneNames.indexOf(bone.parentBone.name);
    if (parentIdx === -1) continue; // parent not in ragdoll (e.g., skipped)

    const restValue = Math.hypot(
      bone.worldMatrix[12] - bone.parentBone.worldMatrix[12],
      bone.worldMatrix[13] - bone.parentBone.worldMatrix[13],
      bone.worldMatrix[14] - bone.parentBone.worldMatrix[14]
    );

    constraints.push({
      type: 'distance',
      indices: [parentIdx, i],
      compliance: 0, // rigid for MVP
      restValue,
      lambda: new Float32Array(1),
      stiffness: 1.0,
      damping: 0.0,
    });
  }

  // Initialize solver
  const solver = new XpbdSolver({
    gravity: [0, -9.8, 0],
    substeps: 4,
    damping: 0.98,
    groundY,
  });
  solver.particles = particles;
  solver.constraints = constraints;

  // Create update function stub (caller will set it)
  const updateFn = (dt: number) => {
    // Will be overridden by modelManager.addRagdoll
  };

  // Dispose function
  const dispose = () => {
    solver.reset();
    particles.length = 0;
    constraints.length = 0;
  };

    return {
    solver,
    particles,
    constraints,
    enabled: true,
    updateFn,
    dispose,
    modelId,
    isWasm: runtimeBones.length > 0 ? !('linkedBone' in runtimeBones[0]) : false,
    boneNames,
  };
}

// ── Solver Step ──

export function stepRagdoll(inst: RagdollInstance, dt: number): void {
  inst.solver.step(dt);

  // Ground clamp: for each particle with invMass > 0, clamp y to groundY
  const groundY = inst.solver.groundY;
  for (const p of inst.particles) {
    if (p.invMass > 0 && p.p[1] < groundY) {
      p.p[1] = groundY;
    }
  }
}

// ── Writeback to Bones ──

export function writeBack(
  inst: RagdollInstance,
  isWasm: boolean,
  getRuntimeBones: () => readonly IMmdRuntimeBone[]
): void {
  const bones = getRuntimeBones();

  if (!isWasm) {
    // JS mode: write to linkedBone.rotationQuaternion + setPosition
    for (let i = 0; i < inst.particles.length; i++) {
      const boneName = inst.boneNames[i];
      const rb = bones.find((b) => b.name === boneName);
      if (!rb) continue;

      const linked = (rb as any).linkedBone as {
        rotationQuaternion?: Quaternion;
        setPosition: (v: Vector3) => void;
        updateWorldMatrix: (a: boolean, b: boolean) => void;
        getSkeleton?: () => { _markAsDirty?: () => void };
      };
      if (!linked) continue;

      const p = inst.particles[i];
      const worldPos = Vector3.FromArray(p.p);

      // Translation: local position relative to parent
      let localPos: Vector3;
      if (rb.parentBone) {
        const parentRb = bones.find((b) => b.name === rb.parentBone!.name);
        if (parentRb) {
          const parentWorldPos = Vector3.FromArray([
            parentRb.worldMatrix[12],
            parentRb.worldMatrix[13],
            parentRb.worldMatrix[14],
          ]);
          localPos = worldPos.clone().subtract(parentWorldPos);
        } else {
          localPos = worldPos.clone();
        }
      } else {
        localPos = worldPos.clone();
      }

      // Update position
      linked.setPosition(localPos);

      // Rotation: set to identity (ragdoll drives translation primarily)
      linked.rotationQuaternion = Quaternion.Identity();

      // Force skeleton refresh
      (rb as MmdRuntimeBoneExtended).updateWorldMatrix(false, false);
      linked.getSkeleton?.()?._markAsDirty?.();
    }
  } else {
    // WASM mode: write to worldMatrix Float32Array directly
    for (let i = 0; i < inst.particles.length; i++) {
      const boneName = inst.boneNames[i];
      const rb = bones.find((b) => b.name === boneName);
      if (!rb) continue;

      const buf = (rb as MmdRuntimeBoneExtended).worldMatrix;
      if (!buf) {
        console.warn('ragdoll writeback: WASM mode failed - missing worldMatrix');
        continue;
      }

      const p = inst.particles[i];
      const oldMat = Matrix.FromArray(buf);

      // Compose new matrix: position from particle.p + rotation from current
      const pos = Vector3.FromArray(p.p);
      const rot = Quaternion.Identity(); // Simplified: no rotation solve yet

      const newMat = Matrix.Compose(Vector3.One(), rot, pos);

      // Write back
      const arr = newMat.asArray();
      for (let j = 0; j < 16; j++) {
        buf[j] = arr[j];
      }

      // Propagate to children
      _propagateChildrenWasm(rb, oldMat, newMat);
    }
  }
}
