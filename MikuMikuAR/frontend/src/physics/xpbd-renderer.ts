/**
 * XPBD 粒子/mesh 可视化调试 (XPBD Renderer)
 *
 * 在 Babylon.js 场景中渲染调试几何：
 * - 粒子小球体
 * - 约束彩色线段
 * - 胶囊碰撞体线框
 * - 布料/软体变形 mesh
 *
 * 职能纯粹：接收 Babylon Scene + XPBD 数据 → 更新可视化对象。
 * 不参与物理计算。
 */

import type { XpbdSolver } from './xpbd-solver';
import type { SdfCollider } from './xpbd-collider';

// Babylon.js 类型引用（运行时可用）
// 使用 import type 避免循环依赖

// ============================================================
// 接口
// ============================================================

export interface XpbdRendererConfig {
    /** 粒子球体颜色（RGBA） */
    particleColor: [number, number, number, number];
    /** 约束线颜色（RGBA） */
    constraintColor: [number, number, number, number];
    /** 胶囊碰撞体颜色（RGBA） */
    colliderColor: [number, number, number, number];
    /** 粒子球半径 */
    particleSphereRadius: number;
    /** 约束线粗细 */
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

/**
 * XpbdRenderer
 *
 * 用法:
 *   const renderer = new XpbdRenderer(scene);
 *   renderer.showParticles(true);
 *   // 每帧:
 *   renderer.updateParticles(solver);
 *   renderer.updateConstraints(solver);
 *   renderer.updateColliders(collider);
 */
export class XpbdRenderer {
    // 将 Scene 存为 any 以兼容 Babylon.js 的多种版本
    private scene: any;

    // 粒子可视化
    private particleMeshes: any[] = [];
    private particleVisible = false;

    // 约束可视化
    private constraintLines: any[] = [];
    private constraintVisible = false;

    // 胶囊可视化
    private colliderMeshes: any[] = [];
    private colliderVisible = false;

    // 材质缓存
    private particleMat: any = null;
    private constraintMat: any = null;
    private colliderMat: any = null;

    config: XpbdRendererConfig;

    constructor(scene: any, config?: Partial<XpbdRendererConfig>) {
        this.scene = scene;
        this.config = { ...DEFAULT_CONFIG, ...config };
        this._initMaterials();
    }

    // ---- 材质初始化 ----

    private _initMaterials(): void {
        const BABYLON = (globalThis as any).BABYLON;
        if (!BABYLON) {
            return;
        }

        if (BABYLON.StandardMaterial) {
            const [pr, pg, pb, pa] = this.config.particleColor;
            this.particleMat = new BABYLON.StandardMaterial('xpbd_particle');
            this.particleMat.diffuseColor = new BABYLON.Color3(pr, pg, pb);
            this.particleMat.alpha = pa;
            this.particleMat.emissiveColor = new BABYLON.Color3(pr * 0.5, pg * 0.5, pb * 0.5);
            this.particleMat.backFaceCulling = false;

            const [cr, cg, cb, ca] = this.config.constraintColor;
            this.constraintMat = new BABYLON.StandardMaterial('xpbd_constraint');
            this.constraintMat.diffuseColor = new BABYLON.Color3(cr, cg, cb);
            this.constraintMat.alpha = ca;
            this.constraintMat.emissiveColor = new BABYLON.Color3(cr, cg, cb);
            this.constraintMat.backFaceCulling = false;

            const [sr, sg, sb, sa] = this.config.colliderColor;
            this.colliderMat = new BABYLON.StandardMaterial('xpbd_collider');
            this.colliderMat.diffuseColor = new BABYLON.Color3(sr, sg, sb);
            this.colliderMat.alpha = sa;
            this.colliderMat.wireframe = true;
            this.colliderMat.backFaceCulling = false;
        }
    }

    // ---- 粒子可视化 ----

    /**
     * 创建/更新粒子球体
     * 在求解器重置后需要重新调用（粒子数量变化时）
     */
    updateParticles(solver: XpbdSolver): void {
        const BABYLON = (globalThis as any).BABYLON;
        if (!BABYLON?.MeshBuilder) {
            return;
        }

        // 确保有足够的 mesh
        while (this.particleMeshes.length < solver.particles.length) {
            const sphere = BABYLON.MeshBuilder.CreateSphere(
                `xpbd_particle_${this.particleMeshes.length}`,
                { diameter: this.config.particleSphereRadius * 2, segments: 8 },
                this.scene
            );
            sphere.material = this.particleMat;
            sphere.isVisible = this.particleVisible;
            this.particleMeshes.push(sphere);
        }

        // 清理多余的
        while (this.particleMeshes.length > solver.particles.length) {
            const m = this.particleMeshes.pop();
            m?.dispose?.();
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
     * 渲染线条约束（距离约束 + 弯曲约束）
     * 每帧调用，使用 LinesMesh 更新
     */
    updateConstraints(solver: XpbdSolver): void {
        const BABYLON = (globalThis as any).BABYLON;
        if (!BABYLON) {
            return;
        }

        // 清除旧线
        this._clearConstraintLines();

        if (!this.constraintVisible) {
            return;
        }

        const positions: number[] = [];

        for (const c of solver.constraints) {
            if (c.type === 'volume') {
                continue;
            } // 四面体不画线

            const i = c.indices[0];
            const k = c.indices[c.indices.length - 1];
            const pi = solver.particles[i];
            const pk = solver.particles[k];
            if (!pi || !pk) {
                continue;
            }

            positions.push(pi.p[0], pi.p[1], pi.p[2]);
            positions.push(pk.p[0], pk.p[1], pk.p[2]);
        }

        if (positions.length === 0) {
            return;
        }

        const lines = BABYLON.MeshBuilder.CreateLines(
            'xpbd_constraints',
            { points: positions, updatable: true },
            this.scene
        );
        lines.color = new BABYLON.Color3(
            this.config.constraintColor[0],
            this.config.constraintColor[1],
            this.config.constraintColor[2]
        );
        lines.alpha = this.config.constraintColor[3];
        this.constraintLines.push(lines);
    }

    showConstraints(visible: boolean): void {
        this.constraintVisible = visible;
    }

    private _clearConstraintLines(): void {
        for (const line of this.constraintLines) {
            line?.dispose?.();
        }
        this.constraintLines = [];
    }

    // ---- 胶囊碰撞体可视化 ----

    /**
     * 创建/更新胶囊碰撞体的线框可视化
     */
    updateColliders(collider: SdfCollider): void {
        const BABYLON = (globalThis as any).BABYLON;
        if (!BABYLON) {
            return;
        }

        // 清除旧的
        for (const m of this.colliderMeshes) {
            m?.dispose?.();
        }
        this.colliderMeshes = [];

        if (!this.colliderVisible) {
            return;
        }

        for (const cap of collider.capsules) {
            if (!cap.enabled) {
                continue;
            }

            const sphere = BABYLON.MeshBuilder.CreateSphere(
                `xpbd_collider_${cap.name}`,
                {
                    diameter: cap.radius * 2,
                    segments: 16,
                },
                this.scene
            );
            const cylinder = BABYLON.MeshBuilder.CreateCylinder(
                `xpbd_collider_cyl_${cap.name}`,
                {
                    height: cap.halfHeight * 2,
                    diameter: cap.radius * 2,
                    tessellation: 16,
                },
                this.scene
            );

            sphere.material = this.colliderMat;
            cylinder.material = this.colliderMat;
            sphere.isVisible = this.colliderVisible;
            cylinder.isVisible = this.colliderVisible;

            // 定位：cylinder 中心在 capsule center，沿 direction 方向
            cylinder.position.x = cap.center[0];
            cylinder.position.y = cap.center[1];
            cylinder.position.z = cap.center[2];

            // 旋转 cylinder 对齐 direction
            // 默认 cylinder 沿 Y 轴，需要旋转到 cap.direction
            const dy = cap.direction[1];
            const crossX = -cap.direction[2];
            const crossZ = cap.direction[0];
            const angle = Math.acos(Math.min(1, Math.max(-1, dy)));
            const crossLen = Math.sqrt(crossX * crossX + crossZ * crossZ);
            if (crossLen > 1e-6) {
                cylinder.rotation.x = (crossX / crossLen) * angle;
                cylinder.rotation.z = (crossZ / crossLen) * angle;
            }

            // 两端球体
            const hh = cap.halfHeight;
            sphere.position.x = cap.center[0] + cap.direction[0] * hh;
            sphere.position.y = cap.center[1] + cap.direction[1] * hh;
            sphere.position.z = cap.center[2] + cap.direction[2] * hh;

            const sphere2 = BABYLON.MeshBuilder.CreateSphere(
                `xpbd_collider_${cap.name}_bot`,
                { diameter: cap.radius * 2, segments: 16 },
                this.scene
            );
            sphere2.material = this.colliderMat;
            sphere2.isVisible = this.colliderVisible;
            sphere2.position.x = cap.center[0] - cap.direction[0] * hh;
            sphere2.position.y = cap.center[1] - cap.direction[1] * hh;
            sphere2.position.z = cap.center[2] - cap.direction[2] * hh;

            this.colliderMeshes.push(sphere, cylinder, sphere2);
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
        this._clearConstraintLines();
        for (const m of this.particleMeshes) {
            m?.dispose?.();
        }
        for (const m of this.colliderMeshes) {
            m?.dispose?.();
        }
        this.particleMeshes = [];
        this.colliderMeshes = [];
        this.particleMat?.dispose?.();
        this.constraintMat?.dispose?.();
        this.colliderMat?.dispose?.();
    }
}
