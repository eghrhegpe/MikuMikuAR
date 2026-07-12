/**
 * ghost-particle-sim.ts — CPU 幽灵粒子模拟器（方案B）
 *
 * 与 GPU GPUParticleSystem 并行运行一套轻量 CPU 粒子模拟，
 * 仅负责碰撞检测（不渲染），触地后通过回调通知上层触发 splash/ripple。
 *
 * 同步策略：与 GPU 粒子共享相同的 gravity / wind / emitPower / lifetime / boxEmitter 参数，
 * 使用相同的 updateSpeed 作为时间步长，确保飞行轨迹视觉一致。
 *
 * 降采样策略：幽灵粒子 emitRate = GPU emitRate / downsampleFactor，
 * 触地后按 splashProbability 概率触发 splash burst，避免高频触发压垮 burst 池。
 */

import { Scene, Observer, Vector3 } from '@babylonjs/core';
import { getGroundHeightAt } from './env-impl';
import { envState } from '@/core/config';

// ======== 类型定义 ========

/** 幽灵粒子配置 — 从 GPU 粒子参数镜像 */
export interface GhostParticleConfig {
    emitRate: number; // 幽灵粒子发射率（已降采样后的值）
    gravity: Vector3; // 重力（与 GPU 粒子一致）
    windScale: number; // 风力响应系数（与 GPU 粒子一致，通常 0.1）
    minEmitPower: number; // 最小发射力度
    maxEmitPower: number; // 最大发射力度
    minLifeTime: number; // 最小生命
    maxLifeTime: number; // 最大生命
    boxHalf: number; // box emitter XZ 半宽
    boxYRange: number; // box emitter Y 偏移范围
    heightAboveGround: number; // 发射器在 groundLevel 以上高度
    updateSpeed: number; // 时间步长（与 GPU 粒子 updateSpeed 一致）
    splashProbability: number; // 触地触发 splash 的概率 (0-1)
    emitterFollowCamera: boolean; // 是否跟随相机（全景天气=true）
}

/** 幽灵粒子（SoA 风格的平铺数组，避免 GC） */
interface GhostParticle {
    x: number;
    y: number;
    z: number;
    vx: number;
    vy: number;
    vz: number;
    life: number;
    active: boolean;
}

// ======== 按粒子类型的降采样配置 ========

/** key = EnvState['particleType']，值 = { 降采样因子, splash概率 } */
const GHOST_DOWNSAMPLE: Record<string, { downsample: number; splashProb: number }> = {
    rain: { downsample: 30, splashProb: 0.3 },
    snow: { downsample: 5, splashProb: 0.5 },
    sakura: { downsample: 2, splashProb: 0.4 },
    leaves: { downsample: 2, splashProb: 0.3 },
};

/** 获取降采样配置 */
export function getGhostDownsample(type: string): { downsample: number; splashProb: number } {
    return GHOST_DOWNSAMPLE[type] ?? { downsample: 1, splashProb: 0.3 };
}

// ======== 幽灵粒子模拟器 ========

const MAX_GHOST_PARTICLES = 300;

export class GhostParticleSimulator {
    private _scene: Scene;
    private _particles: GhostParticle[] = [];
    private _config: GhostParticleConfig | null = null;
    private _emitAccum = 0;
    private _observer: Observer<Scene> | null = null;
    private _initialDir1: Vector3;
    private _initialDir2: Vector3;
    private _curDir1: Vector3;
    private _curDir2: Vector3;

    /** 触地回调（在上层设置，触发 splash burst / ripple） */
    public onImpact: ((x: number, y: number, z: number) => void) | null = null;

    constructor(scene: Scene) {
        this._scene = scene;
        this._initialDir1 = new Vector3();
        this._initialDir2 = new Vector3();
        this._curDir1 = new Vector3();
        this._curDir2 = new Vector3();
    }

    /**
     * 启动幽灵模拟器。
     * @param config 幽灵粒子配置
     * @param dir1 GPU 粒子的初始 direction1（不含风力）
     * @param dir2 GPU 粒子的初始 direction2（不含风力）
     */
    start(config: GhostParticleConfig, dir1: Vector3, dir2: Vector3): void {
        this._config = config;
        this._initialDir1.copyFrom(dir1);
        this._initialDir2.copyFrom(dir2);
        this._curDir1.copyFrom(dir1);
        this._curDir2.copyFrom(dir2);
        this._emitAccum = 0;

        // 清空残留粒子
        for (const p of this._particles) {
            p.active = false;
        }

        if (this._observer) {
            this._scene.onBeforeRenderObservable.remove(this._observer);
        }
        this._observer = this._scene.onBeforeRenderObservable.add(() => {
            this._update();
        });
    }

    /** 停止模拟器 */
    stop(): void {
        if (this._observer) {
            this._scene.onBeforeRenderObservable.remove(this._observer);
            this._observer = null;
        }
        this._config = null;
        this._emitAccum = 0;
        for (const p of this._particles) {
            p.active = false;
        }
    }

    /** 更新风力方向（由上层每帧或风力变化时调用） */
    updateWind(windVec: Vector3): void {
        this._curDir1.copyFrom(this._initialDir1).addInPlace(windVec);
        this._curDir2.copyFrom(this._initialDir2).addInPlace(windVec);
    }

    /** 更新配置参数（响应滑条变化） */
    updateConfig(partial: Partial<GhostParticleConfig>): void {
        if (!this._config) {
            return;
        }
        Object.assign(this._config, partial);
    }

    // ======== 内部方法 ========

    private _update(): void {
        const cfg = this._config;
        if (!cfg) {
            return;
        }

        const dt = cfg.updateSpeed;

        // 1. 发射新粒子
        this._emitAccum += cfg.emitRate * dt;
        while (this._emitAccum >= 1) {
            this._emitAccum -= 1;
            this._spawn();
        }

        // 2. 更新活跃粒子 + 碰撞检测
        const gx = cfg.gravity.x;
        const gy = cfg.gravity.y;
        const gz = cfg.gravity.z;

        for (let i = 0; i < this._particles.length; i++) {
            const p = this._particles[i];
            if (!p.active) {
                continue;
            }

            // 物理积分：仅施加重力（GPU 粒子 wind 通过 direction1/2 注入初始速度，非持续力）
            p.vx += gx * dt;
            p.vy += gy * dt;
            p.vz += gz * dt;

            // 位置积分
            p.x += p.vx * dt;
            p.y += p.vy * dt;
            p.z += p.vz * dt;

            // 生命衰减
            p.life -= dt;

            // 碰撞检测：与地面
            const groundH = getGroundHeightAt(p.x, p.z);
            if (p.y <= groundH) {
                // 触地！
                if (p.life > 0 && Math.random() < cfg.splashProbability) {
                    this.onImpact?.(p.x, groundH, p.z);
                }
                p.active = false;
            } else if (p.life <= 0) {
                p.active = false;
            }
        }
    }

    private _spawn(): void {
        const cfg = this._config;
        if (!cfg) {
            return;
        }

        // 找一个空闲粒子槽
        let p: GhostParticle | undefined;
        for (let i = 0; i < this._particles.length; i++) {
            if (!this._particles[i].active) {
                p = this._particles[i];
                break;
            }
        }
        if (!p) {
            if (this._particles.length >= MAX_GHOST_PARTICLES) {
                return;
            }
            p = {
                x: 0,
                y: 0,
                z: 0,
                vx: 0,
                vy: 0,
                vz: 0,
                life: 0,
                active: false,
            };
            this._particles.push(p);
        }

        // 计算发射位置（与 GPU box emitter 一致）
        const cam = this._scene.activeCamera;
        const camX = cam?.position.x ?? 0;
        const camZ = cam?.position.z ?? 0;
        const groundY = envState.groundLevel ?? 0;

        if (cfg.emitterFollowCamera) {
            // 全景天气：box emitter 相对于 emitter 中心（跟随相机）
            p.x = camX + (Math.random() * 2 - 1) * cfg.boxHalf;
            p.y = groundY + cfg.heightAboveGround + Math.random() * cfg.boxYRange;
            p.z = camZ + (Math.random() * 2 - 1) * cfg.boxHalf;
        } else {
            // 局部效果（不落地类型不使用幽灵，这里做安全处理）
            p.x = camX + (Math.random() * 2 - 1) * cfg.boxHalf;
            p.y = groundY + cfg.heightAboveGround;
            p.z = camZ + (Math.random() * 2 - 1) * cfg.boxHalf;
        }

        // 计算初始速度（direction1~2 的插值 × emitPower）
        // 风力已通过上层 updateWind 注入到 _curDir1/2
        const t = Math.random();
        const dirX = this._curDir1.x + (this._curDir2.x - this._curDir1.x) * t;
        const dirY = this._curDir1.y + (this._curDir2.y - this._curDir1.y) * t;
        const dirZ = this._curDir1.z + (this._curDir2.z - this._curDir1.z) * t;

        const power = cfg.minEmitPower + Math.random() * (cfg.maxEmitPower - cfg.minEmitPower);

        p.vx = dirX * power;
        p.vy = dirY * power;
        p.vz = dirZ * power;

        // 生命值
        p.life = cfg.minLifeTime + Math.random() * (cfg.maxLifeTime - cfg.minLifeTime);

        p.active = true;
    }

    /** 释放资源 */
    dispose(): void {
        this.stop();
        this._particles.length = 0;
        this.onImpact = null;
    }
}
