// env-water-reflect.ts — 水面平面反射（ADR-239 拆分）
// 自 env-water.ts 迁出。叶子模块：不依赖 material/fx，回调经 _envSys.water.material 与材质间接通信。
import { Plane } from '@babylonjs/core/Maths/math.plane';
import { Matrix } from '@babylonjs/core/Maths/math.vector';
import { ShaderMaterial } from '@babylonjs/core/Materials/shaderMaterial';
import { Texture } from '@babylonjs/core/Materials/Textures/texture';
import { Scene } from '@babylonjs/core/scene';

import { EnvState, envState } from '@/core/config';
import { _envSys, getScene } from './_shared/env-context';
import { PlanarReflection, registerReflectionSurface } from './planar-reflection';
import { getPlanarQualityOverride } from './env-reflection';

// P3-fix: 水面镜像反射平面复用，避免每帧 new Plane 造成的 GC 压力
const _waterMirrorPlane = new Plane(0, 1, 0, 0);

// === 平面反射（统一平面反射引擎，ADR-092）===
// 水面用 screenSpace 模式：RenderTargetTexture + 镜像相机（_worldMatrix 镜像矩阵）+ ShaderMaterial 屏空采样。
// 互斥可恢复：启用地面反射时本引擎自动停用，地面关闭后由协调器触发重建（关地即开水）。
export const waterReflection = new PlanarReflection({
    name: 'water',
    mode: 'screenSpace',
    resolutionMap: { high: 2048, medium: 1024, low: 512, off: 0 },
    getQuality: (s) => {
        // ADR-151: reflectionMode 全局覆盖（none→强关、planar→拔高到至少 low）
        const override = getPlanarQualityOverride(s);
        if (override === 'off') {
            return 'off';
        }
        let q: string;
        // reflectionQuality 显式指定（含 'off'）直接返回；仅当值不在合法列表时 fallback
        if (['high', 'medium', 'low', 'off'].includes(s.reflectionQuality)) {
            q = s.reflectionQuality;
        } else {
            const map: Record<string, string> = { high: 'high', medium: 'medium', low: 'low' };
            q = map[s.qualityProfile] ?? 'off';
        }
        if (override === 'low' && q === 'off') {
            return 'low';
        }
        return q;
    },
    getBlend: (s) => s.planarReflectionBlend ?? 0.5,
    getSurfaceLevel: (s) => s.waterLevel,
    getMirrorCameraMatrix: (s, scene) => {
        const cam = scene.activeCamera;
        if (!cam) {
            return null;
        }
        // P3-fix: 真正复用 Plane 对象，每帧仅更新 d 参数，避免 GC 压力
        _waterMirrorPlane.normal.set(0, 1, 0);
        _waterMirrorPlane.d = -s.waterLevel;
        return Matrix.Reflection(_waterMirrorPlane).multiply(cam.getWorldMatrix());
    },
    predicate: (mesh, level) =>
        !mesh.name.startsWith('envWater') &&
        mesh.isEnabled() &&
        mesh.getBoundingInfo().boundingBox.maximumWorld.y >= level,
    getMaterial: () => _envSys.water.material as ShaderMaterial | null,
    mount: (rt) => {
        const mat = _envSys.water.material as ShaderMaterial | null;
        if (mat) {
            if (rt) {
                mat.setTexture('reflectionTexture', rt as Texture);
            } else {
                // ADR-### P1: setTexture(name, null) 在 Babylon 中直接赋值 _textures[name]=null，
                // 导致 isReady() for…in 遍历时 null.isReady() 崩溃。改用 removeTexture 彻底删除 key。
                (mat as ShaderMaterial).removeTexture('reflectionTexture');
            }
        }
    },
    setBlend: (b) => {
        const mat = _envSys.water.material as ShaderMaterial | null;
        if (mat) {
            mat.setFloat('planarReflectionBlend', b);
        }
    },
    skipWhenUnderwater: true,
    onDisable: () => {
        // 停用时保留 RT（blend=0 时隐藏反射但不销毁 RT），避免 blend 从 0→正数时闪烁
        // 仅在 quality 真正变为 off 时才销毁 RT（由 disable() 处理）
    },
});
registerReflectionSurface('water', waterReflection, () =>
    waterReflection.update(envState, getScene())
);

/** 初始化/更新水面平面反射：委托给统一引擎（创建 RT、镜像相机、挂载、互斥）。 */
export function _setupMirrorRT(scene: Scene, state: EnvState): void {
    waterReflection.update(state, scene);
}
