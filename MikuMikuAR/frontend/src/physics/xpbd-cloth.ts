/**
 * XPBD 布料模拟 — 程序化网格生成 + 物理模拟 + Babylon.js Mesh 更新
 *
 * 从锚定骨骼出发，生成环形粒子网格，用 XPBD 约束模拟布料运动。
 * 每帧：
 *   1. 将最上层粒子固定到骨骼世界位置
 *   2. solver.step(dt)
 *   3. 更新 Babylon.js mesh 顶点 + 法线
 *
 * 职能纯粹：接收 Babylon Scene + XPBD Solver + SDF Collider → 产出布料对象。
 */

import { XpbdSolver } from "./xpbd-solver";
import type { SdfCollider } from "./xpbd-collider";

// Babylon.js 类型引用（运行时 any，编译期 import type）
// import type { Scene, Mesh, VertexData } from "@babylonjs/core";

// ============================================================
// 类型
// ============================================================

/** 布料拓扑类型 */
export type ClothTopology = "skirt" | "tube" | "cape" | "rope";

/** 布料配置（生成参数） */
export interface ClothConfig {
  /** 锚定骨骼名（如 "腰"），用于外部查询世界矩阵 */
  anchorBone: string;
  /** 拓扑类型 */
  topology: ClothTopology;
  /** 内半径（腰部开口半径），default 0.15 */
  innerRadius: number;
  /** 裙长/布料长度（从锚点向下），default 0.6 */
  length: number;
  /** 裙摆角度（度），0=直筒 | 90=最大扩张，default 15 */
  slope: number;
  /** 水平分段数，default 24 */
  segmentsH: number;
  /** 垂直分段数（层数），default 12 */
  segmentsV: number;
  /** 粒子碰撞半径，default 0.03 */
  particleRadius: number;
  /** 布料柔度（compliance），0=完全刚性，default 0.001 */
  compliance: number;
  /** 布料总质量，均分给非固定粒子，default 0.5 */
  totalMass: number;
  /** 布料阻尼（覆盖 solver 默认值），0~1，default 0.96 */
  damping: number;
  /** 重力倍率，default 1.0 */
  gravityScale: number;
  /** 弯曲约束柔度，default = compliance * 5（比距离约束更软） */
  bendCompliance: number;
}

export const DEFAULT_CLOTH_CONFIG: ClothConfig = {
  anchorBone: "腰",
  topology: "skirt",
  innerRadius: 0.15,
  length: 0.6,
  slope: 15,
  segmentsH: 24,
  segmentsV: 12,
  particleRadius: 0.03,
  compliance: 0.001,
  totalMass: 0.5,
  damping: 0.96,
  gravityScale: 1.0,
  bendCompliance: 0.005,
};

/** 布料实例（运行时对象） */
export interface ClothInstance {
  config: ClothConfig;
  solver: XpbdSolver;
  /** 粒子索引 → 网格 (segmentsH × segmentsV) */
  particleGrid: number[];
  /** 锚定粒子索引（最上层整环），这些粒子 mass=0 */
  anchorIndices: number[];
  /** 每层粒子数 = segmentsH */
  ringSize: number;
  /** 总层数 = segmentsV */
  ringCount: number;
  /** Babylon.js Mesh（程序化生成的独立网格） */
  mesh: any;
  /** 网格三角形索引（缓存用于每帧 ComputeNormals） */
  meshIndices: Int32Array;
  /** 是否启用模拟 */
  enabled: boolean;
  /** 锚定骨骼未找到时是否已警告过（只打印一次） */
  _anchorMissingWarned: boolean;
  /**
   * 每帧更新回调（由 buildClothUpdateFn 生成后设置）。
   * 接收 deltaTime（秒），由 ModelManager 的渲染观察者每帧调用。
   */
  updateFn?: (deltaTime: number) => void;
}

// ============================================================
// 主工厂函数
// ============================================================

/**
 * 创建布料实例
 *
 * @param scene Babylon.js Scene 对象
 * @param config 布料配置
 * @param collider SDF 胶囊碰撞器（可选，如需身体碰撞）
 * @returns ClothInstance
 */
export function createCloth(
  scene: any,
  config: Partial<ClothConfig> = {},
  collider?: SdfCollider | null,
): ClothInstance {
  const cfg = { ...DEFAULT_CLOTH_CONFIG, ...config };
  const solver = new XpbdSolver({
    substeps: 4,
    damping: cfg.damping,
  });
  solver.setGravity(0, -9.8 * cfg.gravityScale, 0);

  const ringSize = cfg.segmentsH;
  const ringCount = cfg.segmentsV;

  // ---- 粒子放置 ----
  const particleGrid: number[] = []; // ringCount × ringSize
  const anchorIndices: number[] = [];
  const nonAnchorMass =
    cfg.totalMass / (ringSize * (ringCount - 1)); // 顶层固定，其余均分

  for (let row = 0; row < ringCount; row++) {
    const t = row / (ringCount - 1); // 0 (top) → 1 (bottom)
    const y = -t * cfg.length;       // Y 向下

    // 半径：top = innerRadius, bottom = innerRadius + length * tan(slopeDeg)
    const slopeRad = (cfg.slope * Math.PI) / 180;
    const r = cfg.innerRadius + t * cfg.length * Math.tan(slopeRad);

    for (let col = 0; col < ringSize; col++) {
      const angle = (col / ringSize) * Math.PI * 2;
      const x = Math.cos(angle) * r;
      const z = Math.sin(angle) * r;

      const mass = row === 0 ? Infinity : nonAnchorMass;
      const idx = solver.addParticle([x, y, z], mass, cfg.particleRadius);
      particleGrid.push(idx);

      if (row === 0) {
        anchorIndices.push(idx);
      }
    }
  }

  // ---- 约束建立 ----

  // 距离约束：水平（同层相邻）+ 垂直（不同层）
  for (let row = 0; row < ringCount; row++) {
    for (let col = 0; col < ringSize; col++) {
      const i = particleGrid[row * ringSize + col];

      // 水平：当前 → 右邻居
      const nextCol = (col + 1) % ringSize;
      const h = particleGrid[row * ringSize + nextCol];
      solver.addDistanceConstraint(i, h, cfg.compliance);

      // 垂直：当前 → 下方
      if (row + 1 < ringCount) {
        const v = particleGrid[(row + 1) * ringSize + col];
        solver.addDistanceConstraint(i, v, cfg.compliance);
      }
    }
  }

  // 弯曲约束：水平 + 垂直 skip-1
  const bendC = cfg.bendCompliance;
  for (let row = 0; row < ringCount; row++) {
    for (let col = 0; col < ringSize; col++) {
      const i = particleGrid[row * ringSize + col];

      // 水平弯曲：skip-1
      const bendH = particleGrid[row * ringSize + (col + 2) % ringSize];
      const midH = particleGrid[row * ringSize + (col + 1) % ringSize];
      solver.addBendConstraint(i, midH, bendH, bendC);

      // 垂直弯曲：skip-1
      if (row + 2 < ringCount) {
        const bendV = particleGrid[(row + 2) * ringSize + col];
        const midV = particleGrid[(row + 1) * ringSize + col];
        solver.addBendConstraint(i, midV, bendV, bendC);
      }
    }
  }

  // 地面碰撞（默认在很低的位置，防止掉出场景）
  solver.addGroundCollision(-5);

  // ---- Mesh 创建 ----
  const { mesh, indices: meshIndices } = _createClothMesh(
    scene, cfg, particleGrid, solver, ringSize, ringCount,
  );

  const instance: ClothInstance = {
    config: cfg,
    solver,
    particleGrid,
    anchorIndices,
    ringSize,
    ringCount,
    mesh,
    meshIndices,
    enabled: true,
    _anchorMissingWarned: false,
  };

  return instance;
}

// ============================================================
// 每帧更新
// ============================================================

/**
 * 构建布料更新闭包（在 scene.registerBeforeRender 中调用）
 *
 * @param cloth 布料实例
 * @param anchorMatrixFn 获取锚定骨骼世界矩阵的函数 (BoneName → Float32Array[16] 列主序)
 * @param collider SDF 碰撞器（null 则跳过）
 * @returns beforeRender 回调函数
 */
export function buildClothUpdateFn(
  cloth: ClothInstance,
  anchorMatrixFn: (boneName: string) => Float32Array | null,
  collider?: SdfCollider | null,
): () => void {
  // 锚定粒子在局部空间的初始位置缓存（相对于 anchor bone）
  const anchorLocalPositions: [number, number, number][] = [];
  for (const idx of cloth.anchorIndices) {
    const p = cloth.solver.particles[idx];
    anchorLocalPositions.push([p.p[0], p.p[1], p.p[2]]);
  }

  return () => {
    if (!cloth.enabled) return;

    const solver = cloth.solver;

    // 1. 锚定粒子跟随骨骼
    const mat = anchorMatrixFn(cloth.config.anchorBone);
    if (mat) {
      cloth._anchorMissingWarned = false;
      // 列主序: mat[12]=tx, mat[13]=ty, mat[14]=tz
      // mat[0..2]=col0 (X axis), mat[4..6]=col1 (Y axis), mat[8..10]=col2 (Z axis)
      const tx = mat[12], ty = mat[13], tz = mat[14];

      for (let i = 0; i < cloth.anchorIndices.length; i++) {
        const idx = cloth.anchorIndices[i];
        const [lx, ly, lz] = anchorLocalPositions[i];

        // worldPos = mat * localPos
        const wx = mat[0] * lx + mat[4] * ly + mat[8] * lz + tx;
        const wy = mat[1] * lx + mat[5] * ly + mat[9] * lz + ty;
        const wz = mat[2] * lx + mat[6] * ly + mat[10] * lz + tz;

        const p = solver.particles[idx];
        p.prevP[0] = p.p[0] = wx;
        p.prevP[1] = p.p[1] = wy;
        p.prevP[2] = p.p[2] = wz;
      }
    } else if (!cloth._anchorMissingWarned) {
      // 回退：骨骼未找到时锚定粒子保持当前位置（不更新，防止撕裂悬空）
      console.warn(
        `[xpbd-cloth] anchor bone "${cloth.config.anchorBone}" not found. ` +
        `Anchor particles will hold their last position.`,
      );
      cloth._anchorMissingWarned = true;
    }

    // 2. SDF 身体碰撞（在 step 之前做一次，step 内也会做地面碰撞）
    if (collider) {
      collider.solve(solver);
    }

    // 3. XPBD 步进
    solver.step(1 / 60);

    // 4. 更新 Mesh 顶点
    _updateClothMesh(cloth);
  };
}

// ============================================================
// Mesh 创建 & 更新
// ============================================================

/**
 * 从粒子网格创建可更新的 Babylon.js Mesh
 *
 * 网格拓扑: ringCount 个环，每个环 ringSize 个顶点
 * 三角形: 每个 {row, col} → 两个三角形:
 *   (row,col), (row+1,col), (row,col+1)  上三角
 *   (row+1,col), (row+1,col+1), (row,col+1)  下三角
 */
function _createClothMesh(
  scene: any,
  cfg: ClothConfig,
  particleGrid: number[],
  solver: XpbdSolver,
  ringSize: number,
  ringCount: number,
): { mesh: any; indices: Int32Array } {
  const BABYLON = (globalThis as any).BABYLON;
  if (!BABYLON) {
    console.warn("[xpbd-cloth] BABYLON not found on globalThis, mesh creation skipped");
    return { mesh: null, indices: new Int32Array(0) };
  }

  // 收集顶点位置（从粒子读取初始 position）
  const positions: number[] = [];
  // UV: 按柱面展开，u = col/ringSize, v = row/(ringCount-1)
  const uvs: number[] = [];

  for (let row = 0; row < ringCount; row++) {
    const v = row / (ringCount - 1);
    for (let col = 0; col < ringSize; col++) {
      const u = col / ringSize;
      const pIdx = particleGrid[row * ringSize + col];
      const p = solver.particles[pIdx];
      positions.push(p.p[0], p.p[1], p.p[2]);
      uvs.push(u, v);
    }
  }

  // 索引
  const indexArray: number[] = [];
  for (let row = 0; row < ringCount - 1; row++) {
    for (let col = 0; col < ringSize; col++) {
      const a = row * ringSize + col;
      const b = (row + 1) * ringSize + col;
      const c = row * ringSize + (col + 1) % ringSize;
      const d = (row + 1) * ringSize + (col + 1) % ringSize;

      // 上三角 (a, b, c)
      indexArray.push(a, b, c);
      // 下三角 (b, d, c)
      indexArray.push(b, d, c);
    }
  }

  // 用 ComputeNormals 计算初始法线
  const normals = new Float32Array(positions.length);
  BABYLON.VertexData.ComputeNormals(
    new Float32Array(positions),
    new Int32Array(indexArray),
    normals,
  );

  // 创建 Mesh
  const mesh = new BABYLON.Mesh("xpbd_cloth", scene);

  const vertexData = new BABYLON.VertexData();
  vertexData.positions = positions;
  vertexData.indices = indexArray;
  vertexData.normals = Array.from(normals);
  vertexData.uvs = uvs;
  vertexData.applyToMesh(mesh);

  // 材质
  const mat = new BABYLON.StandardMaterial("xpbd_cloth_mat", scene);
  mat.diffuseColor = new BABYLON.Color3(0.2, 0.3, 0.8);
  mat.alpha = 0.85;
  mat.backFaceCulling = false;
  mat.specularColor = new BABYLON.Color3(0.1, 0.1, 0.1);
  mesh.material = mat;

  return { mesh, indices: new Int32Array(indexArray) };
}

/**
 * 每帧更新 Mesh 顶点位置 + 用 ComputeNormals 重算法线
 */
function _updateClothMesh(cloth: ClothInstance): void {
  const BABYLON = (globalThis as any).BABYLON;
  if (!BABYLON || !cloth.mesh) return;

  const { solver, particleGrid, meshIndices } = cloth;
  const count = particleGrid.length;

  // 更新位置
  const positions = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    const pIdx = particleGrid[i];
    const p = solver.particles[pIdx];
    const off = i * 3;
    positions[off] = p.p[0];
    positions[off + 1] = p.p[1];
    positions[off + 2] = p.p[2];
  }

  // 根据当前顶点位置 + 三角形索引，用 Babylon 工具重算法线
  const normals = new Float32Array(count * 3);
  BABYLON.VertexData.ComputeNormals(positions, meshIndices, normals);

  cloth.mesh.updateVerticesData(BABYLON.VertexBuffer.PositionKind, positions, false, true);
  cloth.mesh.updateVerticesData(BABYLON.VertexBuffer.NormalKind, normals, false, true);
}

// ============================================================
// 销毁
// ============================================================

/**
 * 销毁布料实例（释放 solver 资源和 mesh）
 */
export function disposeCloth(cloth: ClothInstance): void {
  cloth.solver.reset();
  cloth.mesh?.material?.dispose?.();
  cloth.mesh?.dispose?.();
  cloth.enabled = false;
}
