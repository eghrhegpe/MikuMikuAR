/**
 * XPBD 粒子/mesh 可视化调试 (XPBD Renderer)
 *
 * 在 Babylon.js 场景中渲染调试几何：
 * - 粒子小球体
 * - 约束彩色线段（复用 LinesMesh，每帧更新顶点）
 * - 胶囊碰撞体线框（四元数对齐方向）
 * - 布料/软体变形 mesh
 *
 * 职能纯粹：接收 Babylon Scene + XPBD 数据 → 更新可视化对象。
 * 不参与物理计算。
 */

import { Scene } from '@babylonjs/core/scene';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { LinesMesh } from '@babylonjs/core/Meshes/linesMesh';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { Vector3, Quaternion } from '@babylonjs/core/Maths/math.vector';
import type { XpbdSolver } from './xpbd-solver';
import type { SdfCollider } from './xpbd-collider';

// ============================================================
// 接口
// ============================================================

export interface XpbdRendererConfig {
    particleColor: [number, number, number, number];
    constraintColor: [number, number, number, number];
    colliderColor: [number, number, number, number];
    particleSphereRadius: number;
    constraintLineRadius: number;
}

const DEFAULT_CONFIG: XpbdRendererConfig = {
    particleColor: [0, 1, 0.5, 0.8],
    constraintColor: [0.3, 0.6, 1, 0.6],
    colliderColor: [1, 0.3, 0.3, 0.5],
    particleSphereRadius: 0.03,
    constraintLineRadius: 0.01,
};

// ============================================================
// 可视化对象管理器
// ============================================================

export class XpbdRenderer {
    private scene: Scene;

    // 粒子可视化
    private particleMeshes: Mesh[] = [];
    private particleVisible = false;

    // 约束可视化（复用单条 LinesMesh，每帧 updateVerticesData）
    private constraintLines: LinesMesh | null = null;
    private bendLines: LinesMesh | null = null;
    private constraintVisible = false;

    // 胶囊可视化
    private colliderMeshes: Mesh[] = [];
    private colliderVisible = false;

    // 材质缓存
    private particleMat: StandardMaterial | null = null;
    private constraintMat: StandardMaterial | null = null;
    private colliderMat: StandardMaterial | null = null;

    // 缓存 Vector3 / Quaternion 避免每帧分配
    private _tmpVec = new Vector3();
    private _tmpQuat = new Quaternion();
    private _yAxis = new Vector3(0, 1, 0);

    config: XpbdRendererConfig;

    constructor(scene: Scene, config?: Partial<XpbdRendererConfig>) {
        this.scene = scene;
        this.config = { ...DEFAULT_CONFIG, ...config };
        this._initMaterials();
    }

    // ---- 材质初始化 ----

    private _initMaterials(): void {
        const [pr, pg, pb, pa] = this.config.particleColor;
        this.particleMat = new StandardMaterial('xpbd_particle', this.scene);
        this.particleMat.diffuseColor = new Color3(pr, pg, pb);
        this.particleMat.alpha = pa;
        this.particleMat.emissiveColor = new Color3(pr * 0.5, pg * 0.5, pb * 0.5);
        this.particleMat.backFaceCulling = false;

        const [cr, cg, cb, ca] = this.config.constraintColor;
        this.constraintMat = new StandardMaterial('xpbd_constraint', this.scene);
        this.constraintMat.diffuseColor = new Color3(cr, cg, cb);
        this.constraintMat.alpha = ca;
        this.constraintMat.emissiveColor = new Color3(cr, cg, cb);
        this.constraintMat.backFaceCulling = false;

        const [sr, sg, sb, sa] = this.config.colliderColor;
        this.colliderMat = new StandardMaterial('xpbd_collider', this.scene);
        this.colliderMat.diffuseColor = new Color3(sr, sg, sb);
        this.colliderMat.alpha = sa;
        this.colliderMat.wireframe = true;
        this.colliderMat.backFaceCulling = false;
    }

    // ---- 粒子可视化 ----

    updateParticles(solver: XpbdSolver): void {
        // 确保有足够的 mesh
        while (this.particleMeshes.length < solver.particles.length) {
            const sphere = MeshBuilder.CreateSphere(
                `xpbd_particle_${this.particleMeshes.length}`,
                { diameter: this.config.particleSphereRadius * 2, segments: 8 },
                this.scene
            );
            if (this.particleMat) {
                sphere.material = this.particleMat;
            }
            sphere.isVisible = this.particleVisible;
            this.particleMeshes.push(sphere);
        }

        // 清理多余的
        while (this.particleMeshes.length > solver.particles.length) {
            const m = this.particleMeshes.pop();
            m?.dispose();
        }

        // 更新位置
        for (let i = 0; i < solver.particles.length; i++) {
            const p = solver.particles[i];
            const mesh = this.particleMeshes[i];
            if (mesh) {
                mesh.position.x = p.p[0];
                mesh.position.y = p.p[1];
                mesh.position.z = p.p[2];
            }
        }
    }

    showParticles(visible: boolean): void {
        this.particleVisible = visible;
        for (const m of this.particleMeshes) {
            m.isVisible = visible;
        }
    }

    // ---- 约束可视化 ----

    /**
     * 渲染线条约束。首帧创建 with updatable:true 的 LinesMesh，
     * 后续帧仅通过 updateVerticesData 更新顶点，避免 GC。
     */
    updateConstraints(solver: XpbdSolver): void {
        if (!this.constraintVisible) {
            if (this.constraintLines) {
                this.constraintLines.dispose();
                this.constraintLines = null;
            }
            return;
        }

        const distancePositions: number[] = [];
        const bendPositions: number[] = [];
        for (const c of solver.constraints) {
            if (c.type === 'volume' || c.type === 'ground') {
                continue;
            }
            const i = c.indices[0];
            const k = c.indices[c.indices.length - 1];
            const pi = solver.particles[i];
            const pk = solver.particles[k];
            if (!pi || !pk) {
                continue;
            }
            if (c.type === 'bend') {
                bendPositions.push(pi.p[0], pi.p[1], pi.p[2]);
                bendPositions.push(pk.p[0], pk.p[1], pk.p[2]);
            } else {
                distancePositions.push(pi.p[0], pi.p[1], pi.p[2]);
                distancePositions.push(pk.p[0], pk.p[1], pk.p[2]);
            }
        }

        // 距离约束用蓝色，弯曲约束用黄色
        this._updateConstraintLines(distancePositions, [0.3, 0.6, 1]);
        this._updateBendLines(bendPositions, [1, 0.8, 0.2]);
    }

    private _updateConstraintLines(positions: number[], color: [number, number, number]): void {
        if (positions.length === 0) {
            if (this.constraintLines) {
                this.constraintLines.dispose();
                this.constraintLines = null;
            }
            return;
        }

        const pointCount = positions.length / 3;
        if (!this.constraintLines || this.constraintLines.getTotalVertices() !== pointCount) {
            if (this.constraintLines) {
                this.constraintLines.dispose();
            }
            const pts: Vector3[] = [];
            for (let i = 0; i < positions.length; i += 3) {
                pts.push(new Vector3(positions[i], positions[i + 1], positions[i + 2]));
            }
            this.constraintLines = MeshBuilder.CreateLines(
                'xpbd_constraints',
                { points: pts, updatable: true },
                this.scene
            ) as LinesMesh;
            this.constraintLines.color = new Color3(color[0], color[1], color[2]);
        } else {
            this.constraintLines.updateVerticesData(
                'position',
                new Float32Array(positions),
                false,
                true
            );
        }
    }

    private _updateBendLines(positions: number[], color: [number, number, number]): void {
        if (positions.length === 0) {
            if (this.bendLines) {
                this.bendLines.dispose();
                this.bendLines = null;
            }
            return;
        }

        const pointCount = positions.length / 3;
        if (!this.bendLines || this.bendLines.getTotalVertices() !== pointCount) {
            if (this.bendLines) {
                this.bendLines.dispose();
            }
            const pts: Vector3[] = [];
            for (let i = 0; i < positions.length; i += 3) {
                pts.push(new Vector3(positions[i], positions[i + 1], positions[i + 2]));
            }
            this.bendLines = MeshBuilder.CreateLines(
                'xpbd_bend',
                { points: pts, updatable: true },
                this.scene
            ) as LinesMesh;
            this.bendLines.color = new Color3(color[0], color[1], color[2]);
        } else {
            this.bendLines.updateVerticesData('position', new Float32Array(positions), false, true);
        }
    }

    showConstraints(visible: boolean): void {
        this.constraintVisible = visible;
    }

    // ---- 胶囊碰撞体可视化 ----

    /**
     * 创建胶囊碰撞体线框。圆柱体用 Quaternion 对齐 direction。
     * 每帧销毁重建（调试用，非性能敏感路径）。
     */
    updateColliders(collider: SdfCollider): void {
        for (const m of this.colliderMeshes) {
            m.dispose();
        }
        this.colliderMeshes = [];

        if (!this.colliderVisible) {
            return;
        }

        for (const cap of collider.capsules) {
            if (!cap.enabled) {
                continue;
            }

            const sphere1 = MeshBuilder.CreateSphere(
                `xpbd_collider_${cap.name}`,
                { diameter: cap.radius * 2, segments: 16 },
                this.scene
            );
            const cylinder = MeshBuilder.CreateCylinder(
                `xpbd_collider_cyl_${cap.name}`,
                { height: cap.halfHeight * 2, diameter: cap.radius * 2, tessellation: 16 },
                this.scene
            );
            const sphere2 = MeshBuilder.CreateSphere(
                `xpbd_collider_${cap.name}_bot`,
                { diameter: cap.radius * 2, segments: 16 },
                this.scene
            );

            if (this.colliderMat) {
                sphere1.material = this.colliderMat;
                cylinder.material = this.colliderMat;
                sphere2.material = this.colliderMat;
            }

            // 两端球体位置
            const hh = cap.halfHeight;
            const dir = this._tmpVec.set(cap.direction[0], cap.direction[1], cap.direction[2]);
            sphere1.position.set(
                cap.center[0] + dir.x * hh,
                cap.center[1] + dir.y * hh,
                cap.center[2] + dir.z * hh
            );
            cylinder.position.set(cap.center[0], cap.center[1], cap.center[2]);
            sphere2.position.set(
                cap.center[0] - dir.x * hh,
                cap.center[1] - dir.y * hh,
                cap.center[2] - dir.z * hh
            );

            // 使用四元数对齐圆柱体到 direction（默认沿 Y 轴）
            Quaternion.RotationYawPitchRollToRef(0, 0, 0, this._tmpQuat);
            Quaternion.FromUnitVectorsToRef(this._yAxis, dir, this._tmpQuat);
            cylinder.rotationQuaternion = this._tmpQuat.clone();

            this.colliderMeshes.push(sphere1, cylinder, sphere2);
        }
    }

    showColliders(visible: boolean): void {
        this.colliderVisible = visible;
        for (const m of this.colliderMeshes) {
            m.isVisible = visible;
        }
    }

    // ---- 清理 ----

    dispose(): void {
        this.constraintLines?.dispose();
        this.constraintLines = null;
        this.bendLines?.dispose();
        this.bendLines = null;
        for (const m of this.particleMeshes) {
            m.dispose();
        }
        for (const m of this.colliderMeshes) {
            m.dispose();
        }
        this.particleMeshes = [];
        this.colliderMeshes = [];
        this.particleMat?.dispose();
        this.constraintMat?.dispose();
        this.colliderMat?.dispose();
    }
}
