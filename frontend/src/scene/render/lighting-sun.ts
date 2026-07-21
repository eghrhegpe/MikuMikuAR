// [doc:architecture] Lighting — 太阳圆盘可视化（参考方向光来源方向）
// 状态集中于 lightingState，本文件不再持有任何模块级可变状态。

import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { lightingState, SUN_DISC_DISTANCE, SUN_DISC_MIN_INTENSITY } from './lighting-state';
import { safeDispose } from '@/core/dispose-helpers';

function _ensureSunDisc(): Mesh {
    if (!lightingState.scene || lightingState.sunDisc) {
        return lightingState.sunDisc!;
    }
    lightingState.sunDisc = MeshBuilder.CreateSphere(
        'sunDisc',
        { diameter: 30, segments: 16 },
        lightingState.scene
    );
    const mat = new StandardMaterial('sunDiscMat', lightingState.scene);
    mat.emissiveColor = new Color3(1, 0.9, 0.7);
    mat.disableLighting = true;
    lightingState.sunDisc.material = mat;
    lightingState.sunDisc.isPickable = false;
    return lightingState.sunDisc;
}

/** 更新方向光参考圆盘位置和颜色。圆盘始终在光线来源方向（视线反方向）。
 *  仅作为调光参照，不参与光照计算。 */
export function _updateSunDisc(): void {
    if (!lightingState.dirLight) {
        return;
    }
    const disc = _ensureSunDisc();
    const d = lightingState.dirLight.direction;
    const aboveHorizon = d.y < 0;
    const hasIntensity = lightingState.dirLight.intensity > SUN_DISC_MIN_INTENSITY;
    disc.setEnabled(aboveHorizon && hasIntensity);
    if (aboveHorizon && hasIntensity) {
        disc.position.set(
            -d.x * SUN_DISC_DISTANCE,
            -d.y * SUN_DISC_DISTANCE,
            -d.z * SUN_DISC_DISTANCE
        );
        const b = Math.max(0.05, lightingState.dirLight.intensity);
        const mat = disc.material as StandardMaterial;
        mat.emissiveColor.set(b, b * 0.9, b * 0.7);
    }
}

export function _disposeSunDisc(): void {
    if (lightingState.sunDisc) {
        lightingState.sunDisc.material?.dispose();
        lightingState.sunDisc = safeDispose(lightingState.sunDisc);
    }
}
