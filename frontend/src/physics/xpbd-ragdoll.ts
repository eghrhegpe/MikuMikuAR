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

/** 内部四元数乘法 out = a × b（xpbd-ragdoll 局部用） */
function _quatMul(a: Float32Array, b: Float32Array, out: Float32Array): void {
  const ax=a[0],ay=a[1],az=a[2],aw=a[3], bx=b[0],by=b[1],bz=b[2],bw=b[3];
  out[0]=aw*bx+ax*bw+ay*bz-az*by;
  out[1]=aw*by-ax*bz+ay*bw+az*bx;
  out[2]=aw*bz+ax*by-ay*bx+az*bw;
  out[3]=aw*bw-ax*bx-ay*by-az*bz;
}

/** 3x3 矩阵转四元数（Shepperd 方法），返回 [x,y,z,w] */
function _mat3ToQuaternion(r00:number,r01:number,r02:number, r10:number,r11:number,r12:number, r20:number,r21:number,r22:number): Float32Array {
  const trace = r00 + r11 + r22;
  let x=0, y=0, z=0, w=1;
  if (trace > 0) {
    const s = 0.5 / Math.sqrt(trace + 1);
    w = 0.25 / s; x = (r21 - r12) * s; y = (r02 - r20) * s; z = (r10 - r01) * s;
  } else if (r00 > r11 && r00 > r22) {
    const s = 2 * Math.sqrt(1 + r00 - r11 - r22);
    w = (r21 - r12) / s; x = 0.25 * s; y = (r01 + r10) / s; z = (r02 + r20) / s;
  } else if (r11 > r22) {
    const s = 2 * Math.sqrt(1 + r11 - r00 - r22);
    w = (r02 - r20) / s; x = (r01 + r10) / s; y = 0.25 * s; z = (r12 + r21) / s;
  } else {
    const s = 2 * Math.sqrt(1 + r22 - r00 - r11);
    w = (r10 - r01) / s; x = (r02 + r20) / s; y = (r12 + r21) / s; z = 0.25 * s;
  }
  const q = new Float32Array([x, y, z, w]);
  const len = Math.sqrt(x*x+y*y+z*z+w*w);
  if (len > 1e-10) { q[0]/=len; q[1]/=len; q[2]/=len; q[3]/=len; }
  return q;
}

/**
 * 从 parent/child worldMatrix 提取 child 相对 parent 的旋转四元数。
 * worldMatrix 为 16 元素行优先 Float32Array（Babylon 约定）。
 * localRot = parentRot⁻¹ × childRot（project_memory: 父逆左乘）。
 */
function _extractRelativeQuaternion(parentMat: Float32Array, childMat: Float32Array): Float32Array {
  // Babylon Matrix 行优先：row0=[0,1,2], row1=[4,5,6], row2=[8,9,10]
  const parentRot = _mat3ToQuaternion(parentMat[0], parentMat[1], parentMat[2],
                                       parentMat[4], parentMat[5], parentMat[6],
                                       parentMat[8], parentMat[9], parentMat[10]);
  const childRot = _mat3ToQuaternion(childMat[0], childMat[1], childMat[2],
                                      childMat[4], childMat[5], childMat[6],
                                      childMat[8], childMat[9], childMat[10]);
  const parentInv = new Float32Array(4);
  // 共轭 = 逆（单位四元数）
  parentInv[0] = -parentRot[0]; parentInv[1] = -parentRot[1];
  parentInv[2] = -parentRot[2]; parentInv[3] = parentRot[3];
  const rel = new Float32Array(4);
  _quatMul(parentInv, childRot, rel); // rel = parentInv × childRot（父逆左乘）
  return rel;
}

// ── Ragdoll Builder ──

/** 单个关节的物理参数（per-joint 或 per-group） */
export interface RagdollJointParams {
  /** 柔度（compliance），0=完全刚性，越大越软 */
  compliance: number;
  /** 刚度缩放 (0~1) */
  stiffness: number;
  /** 阻尼 (0~1) */
  damping: number;
  /** sphere 专属：圆锥限位半角（弧度） */
  coneHalfAngle: number;
  /** sphere 专属：twist 扭转范围 [min, max]（弧度） */
  twistRange: [number, number];
}

export const DEFAULT_RAGDOLL_JOINT_PARAMS: RagdollJointParams = {
  compliance: 0,
  stiffness: 1.0,
  damping: 0.0,
  coneHalfAngle: Math.PI / 4,
  twistRange: [-Math.PI / 4, Math.PI / 4],
};

/**
 * 关节组预设：按骨骼名匹配关键字归组，每组独立参数。
 * 真实人体各关节限位差异巨大（肩≈90°、肘 twist≈0°），全局统一无意义。
 */
export const RAGDOLL_JOINT_GROUPS: Record<string, { keywords: string[]; params: RagdollJointParams }> = {
  spine:   { keywords: ['上半身', '下半身', '腰', 'spine', 'chest'], params: { compliance: 0, stiffness: 1, damping: 0.1, coneHalfAngle: Math.PI/6, twistRange: [-Math.PI/8, Math.PI/8] } },
  shoulder:{ keywords: ['肩', '腕', 'shoulder', 'arm'], params: { compliance: 0, stiffness: 1, damping: 0.05, coneHalfAngle: Math.PI/2, twistRange: [-Math.PI/4, Math.PI/4] } },
  elbow:   { keywords: ['ひじ', 'elbow'], params: { compliance: 0, stiffness: 1, damping: 0.05, coneHalfAngle: Math.PI/8, twistRange: [0, 0] } },
  neck:    { keywords: ['首', '頭', 'head', 'neck'], params: { compliance: 0, stiffness: 1, damping: 0.1, coneHalfAngle: Math.PI/3, twistRange: [-Math.PI/4, Math.PI/4] } },
};

/** 按骨骼名查找关节组参数，未匹配返回 DEFAULT */
export function getJointParams(boneName: string, overrides?: Record<string, RagdollJointParams>): RagdollJointParams {
  if (overrides?.[boneName]) return overrides[boneName];
  for (const g of Object.values(RAGDOLL_JOINT_GROUPS)) {
    if (g.keywords.some(kw => boneName.toLowerCase().includes(kw.toLowerCase()))) return g.params;
  }
  return DEFAULT_RAGDOLL_JOINT_PARAMS;
}

export interface BuildRagdollOptions {
  /** Custom ground Y for clamping (default -10) */
  groundY?: number;
  /** per-joint 参数覆盖（按骨骼名索引），未覆盖的用关节组预设 */
  jointParamsOverrides?: Record<string, RagdollJointParams>;
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

    const jp = getJointParams(bone.name, opts.jointParamsOverrides);

    constraints.push({
      type: 'distance',
      indices: [parentIdx, i],
      compliance: jp.compliance,
      restValue,
      lambda: new Float32Array(1),
      stiffness: jp.stiffness,
      damping: jp.damping,
    });

    // ---- sphere 约束（角向限位，3-DOF）----
    const restQ = _extractRelativeQuaternion(bone.parentBone.worldMatrix, bone.worldMatrix);
    constraints.push({
      type: 'sphere',
      indices: [parentIdx, i],
      coneHalfAngle: jp.coneHalfAngle,
      twistRange: jp.twistRange,
      restQuaternion: restQ,
      compliance: jp.compliance,
      restValue: 0,
      lambda: new Float32Array(2),  // [swing, twist]
      stiffness: jp.stiffness,
      damping: jp.damping,
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
  getRuntimeBones: () => readonly IMmdRuntimeBone[],
  blendWeight: number = 1
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

      // Rotation: 由 solver 解出的 orientation 写回（非 head 骨骼）
      const isHeadBone = /head|首|頭/i.test(boneName);
      if (isHeadBone) {
        // head 划界：不写 rotationQuaternion，保留 perception 的 gaze 写入
        // 仅写 position（ragdoll 仍驱动 head 位置）
      } else {
        const q = p.orientation;
        const physicsRot = new Quaternion(q[0], q[1], q[2], q[3]);
        if (blendWeight >= 0.999) {
          linked.rotationQuaternion = physicsRot;
        } else {
          // Slerp(动画姿态, 物理姿态, blendWeight)：blendWeight=0 动画主导, 1 物理主导
          const animRot = linked.rotationQuaternion ?? Quaternion.Identity();
          linked.rotationQuaternion = Quaternion.Slerp(animRot, physicsRot, blendWeight);
        }
      }

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

      // Compose new matrix: position from particle.p + rotation from solver orientation
      const pos = Vector3.FromArray(p.p);
      const isHeadBone = /head|首|頭/i.test(boneName);
      let rot: Quaternion;
      if (isHeadBone) {
        // head 划界 MVP：保留原 worldMatrix 旋转（简化用 Identity，后续完善）
        rot = Quaternion.Identity();
      } else {
        const q = p.orientation;
        rot = new Quaternion(q[0], q[1], q[2], q[3]);
      }

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
