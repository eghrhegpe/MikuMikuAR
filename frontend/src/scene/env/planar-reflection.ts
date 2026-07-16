// planar-reflection.ts — 统一平面反射引擎（ADR-092）
// 水面（screenSpace：RenderTargetTexture + 镜像相机 + ShaderMaterial 屏空采样）
// 与地面（mirrorTexture：MirrorTexture 引擎自动投影）共用同一套基础设施：
// RT 创建、BFC 存取、renderList 脏标记、帧跳过、try/catch 渲染、dispose、可恢复互斥。
//
// 关键修正（对比旧分叉实现）：
//  - 地面 MirrorTexture 不再手动 .render() 也不 push customRenderTargets —— 由 Babylon 随材质
//    自动渲染，根除「双重驱动」导致的稳态反射错乱（旧 env-impl 同时走三条路径）。
//  - 互斥可恢复：启用某面 requestExclusive 关闭另一面；某面关闭 releaseExclusive 触发另一面
//    按各自 envState 重建 → 关地即开水、关水即开地，根治「双双失效」。

import {
    Scene,
    BaseTexture,
    RenderTargetTexture,
    MirrorTexture,
    Texture,
    FreeCamera,
    Plane,
    Matrix,
    Material,
    Color4,
    AbstractMesh,
    Vector3,
} from '@babylonjs/core';
import type { EnvState } from '@/core/config';
import { logWarn } from '@/core/utils';
import { REFRESHRATE_RENDER_ONCE, type FrozenCamera } from './env-type-helpers';

const RT_REFRESH_ONCE = REFRESHRATE_RENDER_ONCE;

/** 帧跳过：high 每帧、medium 每 2 帧、low 每 4 帧、off 跳帧。两模式共用。 */
const FRAME_SKIP: Record<string, number> = { high: 0, medium: 1, low: 3, off: 999 };

export type ReflectionMode = 'mirrorTexture' | 'screenSpace';

export interface PlanarReflectionConfig {
    /** 资源名前缀（RT / 相机命名用） */
    name: string;
    /** 反射模式：地面用 mirrorTexture，水面用 screenSpace */
    mode: ReflectionMode;
    /** 质量 → 分辨率映射（两模式分辨率不同，各自提供） */
    resolutionMap: Record<string, number>;
    /** 是否启用反射（quality!=='off' && blend>0） */
    getQuality: (s: EnvState) => string;
    getBlend: (s: EnvState) => number;
    /** 反射面高度（地面 groundLevel / 水面 waterLevel） */
    getSurfaceLevel: (s: EnvState) => number;
    /** mirrorTexture 模式：计算镜像平面（随倾斜/pitch/roll 变化）；screenSpace 模式无需提供 */
    getMirrorPlane?: (s: EnvState, scene: Scene) => Plane;
    /** screenSpace 模式：计算镜像相机世界矩阵（水面的 _worldMatrix 镜像矩阵） */
    getMirrorCameraMatrix?: (s: EnvState, scene: Scene) => Matrix | null;
    /** renderList 过滤：返回 true 表示该 mesh 应进入反射 */
    predicate: (mesh: AbstractMesh, level: number) => boolean;
    /** 挂载目标材质（ground: StandardMaterial / water: ShaderMaterial） */
    getMaterial: () => Material | null;
    /** 将 RT 挂到材质（rt 为 null 表示停用，清空材质反射引用） */
    mount: (rt: BaseTexture | null) => void;
    /** 反射强度写入材质（ground: reflectionTexture.level / water: planarReflectBlend uniform） */
    setBlend: (blend: number) => void;
    /** 水面专用：相机入水时跳过反射渲染 */
    skipWhenUnderwater?: boolean;
    /** 停用时的额外清理（如水面清零 planarReflectBlend uniform） */
    onDisable?: () => void;
    /** ADR-114 Phase 2: 是否生成 mipmap（地面 PBR 反射模糊用，水面保持 false） */
    generateMipMaps?: boolean;
}

// ======== 互斥协调器（模块级单例）========
let _activeEngine: PlanarReflection | null = null;
const _surfaces = new Map<string, { engine: PlanarReflection; onReleased: () => void }>();

export function registerReflectionSurface(
    name: string,
    engine: PlanarReflection,
    onReleased: () => void
): void {
    _surfaces.set(name, { engine, onReleased });
}

/** @internal 测试用：重置互斥协调器状态（清除所有注册面与活跃引擎） */
export function resetReflectionSurfaces(): void {
    _activeEngine = null;
    _surfaces.clear();
}

function requestExclusive(engine: PlanarReflection): void {
    if (_activeEngine && _activeEngine !== engine) {
        // 标记被强制停用的面，阻止它在 onReleased 中主动重建
        (_activeEngine as PlanarReflection & { _mutexDisabled: boolean })._mutexDisabled = true;
        _activeEngine.disable();
    }
    _activeEngine = engine;
}

function releaseExclusive(engine: PlanarReflection): void {
    if (_activeEngine !== engine) {
        return;
    }
    _activeEngine = null;
    // 清除另一面的互斥标记并触发恢复（关地即开水、关水即开地）
    for (const entry of _surfaces.values()) {
        if (entry.engine !== engine) {
            entry.engine._mutexDisabled = false;
            entry.onReleased();
            break;
        }
    }
}

// ======== 反射引擎 ========
export class PlanarReflection {
    private readonly cfg: PlanarReflectionConfig;
    private rt: MirrorTexture | RenderTargetTexture | null = null;
    private mirrorCam: FreeCamera | null = null;
    private readonly bfcMap = new Map<number, boolean>();
    private frameCount = 0;
    private renderListDirty = true;
    private lastMeshCount = 0;
    private lastLevel = 0;
    private enabled = false;
    /** @internal 互斥协调器标记：被另一面强制停用时禁止主动重建，由 releaseExclusive 清除恢复。 */
    _mutexDisabled = false;

    /** 强制标记 renderList 为脏，下次 update() 时重新 populate。供 applyGround 原地更新路径调用。 */
    markRenderListDirty(): void {
        this.renderListDirty = true;
    }

    constructor(cfg: PlanarReflectionConfig) {
        this.cfg = cfg;
    }

    get isEnabled(): boolean {
        return this.enabled;
    }

    /** 每帧 / 状态变更时调用：根据 state 决策启用、更新或停用。 */
    update(state: EnvState, scene: Scene): void {
        const quality = this.cfg.getQuality(state);
        const blend = this.cfg.getBlend(state);
        const shouldEnable = quality !== 'off' && blend > 0;
        if (!shouldEnable) {
            this.disable();
            return;
        }
        if (!this.rt) {
            // 被互斥强制停用时禁止主动重建（由 releaseExclusive 清除标志后恢复）
            if (this._mutexDisabled) {
                return;
            }
            this.create(scene, state);
        }
        if (!this.rt) {
            return; // 创建失败（理论上不会）
        }

        // 强度实时更新（不重建 RT）
        this.cfg.setBlend(this.cfg.getBlend(state));

        // renderList 脏标记：mesh 集合或反射面高度变化
        const level = this.cfg.getSurfaceLevel(state);
        const meshCount = scene.meshes.length;
        if (level !== this.lastLevel || meshCount !== this.lastMeshCount) {
            this.renderListDirty = true;
            this.lastLevel = level;
            this.lastMeshCount = meshCount;
        }

        this.frameCount++;
        const skip = FRAME_SKIP[this.cfg.getQuality(state)] ?? 999;
        if (this.frameCount % (skip + 1) !== 0) {
            return;
        }

        if (this.cfg.mode === 'mirrorTexture') {
            // Babylon 随材质自动渲染 MirrorTexture；此处仅每帧刷新镜像平面（跟随倾斜）
            (this.rt as MirrorTexture).mirrorPlane = this.cfg.getMirrorPlane(state, scene);
            if (this.renderListDirty) {
                this.populateRenderList(scene, state);
                this.renderListDirty = false;
            }
            return;
        }

        // screenSpace 模式：手动渲染（ShaderMaterial 采样不会触发自动渲染）
        if (this.cfg.skipWhenUnderwater && scene.activeCamera) {
            const camY = scene.activeCamera.globalPosition.y;
            if (camY < level) {
                return; // 入水跳过，避免反射失效仍耗 GPU
            }
        }
        if (this.cfg.getMirrorCameraMatrix) {
            const m = this.cfg.getMirrorCameraMatrix(state, scene);
            if (m && this.mirrorCam) {
                const cam = this.mirrorCam as unknown as FrozenCamera;
                cam._worldMatrix = m;
                cam._isWorldMatrixFrozen = true;
            }
        }
        if (this.renderListDirty) {
            this.populateRenderList(scene, state);
            this.renderListDirty = false;
        }
        try {
            this.rt.render();
        } catch (e) {
            logWarn('planar-reflection', `${this.cfg.name} 反射 RT 渲染异常，已跳过本帧：`, e);
        }
    }

    private populateRenderList(scene: Scene, state: EnvState): void {
        if (!this.rt) {
            return;
        }
        const level = this.cfg.getSurfaceLevel(state);
        const list: AbstractMesh[] = [];
        for (const mesh of scene.meshes) {
            if (this.cfg.predicate(mesh, level)) {
                list.push(mesh);
            }
        }
        this.rt.renderList = list;
    }

    private create(scene: Scene, state: EnvState): void {
        const q = this.cfg.getQuality(state);
        const resolution = this.cfg.resolutionMap[q] ?? 256;
        const skip = FRAME_SKIP[q] ?? 999;
        if (!resolution) {
            return;
        }

        const bfcSave = (rt: MirrorTexture | RenderTargetTexture) => {
            for (const mesh of rt.renderList ?? []) {
                if (mesh.material) {
                    this.bfcMap.set(mesh.material.uniqueId, mesh.material.backFaceCulling);
                    mesh.material.backFaceCulling = false;
                }
            }
        };
        const bfcRestore = (rt: MirrorTexture | RenderTargetTexture) => {
            for (const mesh of rt.renderList ?? []) {
                if (mesh.material && this.bfcMap.has(mesh.material.uniqueId)) {
                    mesh.material.backFaceCulling = this.bfcMap.get(mesh.material.uniqueId)!;
                }
            }
            this.bfcMap.clear();
        };

        if (this.cfg.mode === 'mirrorTexture') {
            const genMips = this.cfg.generateMipMaps ?? false;
            const rt = new MirrorTexture(`${this.cfg.name}RT`, resolution, scene, genMips);
            rt.clearColor = new Color4(0, 0, 0, 0);
            rt.refreshRate = skip + 1; // high=1(每帧), medium=2, low=4 — Babylon 按此频率自动重渲染
            rt.mirrorPlane = this.cfg.getMirrorPlane(state, scene);
            // ADR-114 Phase 2: mipmap + 三线性采样驱动反射模糊（PBR roughness 自动选 mip LOD）
            if (genMips) {
                rt.updateSamplingMode(Texture.TRILINEAR_SAMPLINGMODE);
            }
            rt.onBeforeRenderObservable.add(() => bfcSave(rt));
            rt.onAfterRenderObservable.add(() => bfcRestore(rt));
            this.rt = rt;
            // 注意：MirrorTexture 挂在材质 reflectionTexture 后由 Babylon 自动渲染，
            // 不 push customRenderTargets、不手动 .render()（根除旧实现的双重驱动）。
        } else {
            const rt = new RenderTargetTexture(`${this.cfg.name}RT`, resolution, scene, false);
            rt.clearColor = new Color4(0, 0, 0, 0);
            rt.refreshRate = RT_REFRESH_ONCE;
            const cam = new FreeCamera(`${this.cfg.name}Cam`, Vector3.Zero(), scene);
            cam.minZ = 0.5;
            cam.maxZ = 5000; // 继承主相机 maxZ，避免远端角色反射被截断（修复旧 maxZ=200）
            rt.activeCamera = cam;
            rt.onBeforeRenderObservable.add(() => bfcSave(rt));
            rt.onAfterRenderObservable.add(() => bfcRestore(rt));
            scene.customRenderTargets.push(rt);
            this.rt = rt;
            this.mirrorCam = cam;
        }

        this.populateRenderList(scene, state);
        const mat = this.cfg.getMaterial();
        if (mat) {
            this.cfg.mount(this.rt);
        }
        this.enabled = true;
        requestExclusive(this);
    }

    /** 停用并释放 RT（互斥时由协调器调用，或自身 shouldEnable=false 时调用）。 */
    disable(): void {
        if (!this.rt && !this.mirrorCam) {
            if (this.enabled) {
                this.enabled = false;
                releaseExclusive(this);
            }
            return;
        }
        const scene = this.rt?.getScene();
        if (scene && this.rt) {
            scene.customRenderTargets = scene.customRenderTargets.filter((t) => t !== this.rt);
        }
        // 清理材质上的反射纹理引用（避免悬空指针指向已 dispose 的 RT）
        const mat = this.cfg.getMaterial();
        if (mat) {
            this.cfg.mount(null);
            this.cfg.setBlend(0); // 清零反射强度（水面 planarReflectBlend / 地面 level）
        }
        this.cfg.onDisable?.();
        this.rt?.dispose();
        this.rt = null;
        this.mirrorCam?.dispose();
        this.mirrorCam = null;
        this.bfcMap.clear();
        this.frameCount = 0;
        this.renderListDirty = true;
        const wasEnabled = this.enabled;
        this.enabled = false;
        if (wasEnabled) {
            releaseExclusive(this);
        }
    }

    /** 彻底销毁（供模块 dispose 调用，不等状态）。 */
    dispose(): void {
        this.disable();
    }
}
