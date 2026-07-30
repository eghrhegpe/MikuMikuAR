// env-underwater-fog.ts — 水下视觉系统（场景雾 + 焦散投影）
//
// 设计目标：解决"水下视角直接看到地面"和"水底没有白蓝交替的泳池光斑"两个体验问题。
// 之前水下只有 colorCurves 后处理（色调偏暗），没有距离衰减、地面也没有任何 caustic 通道。
//
// 本控制器做两件事，且都只在"穿越水面边界"或"潜水深度变化"时改材质/场景，不每帧重编译：
//   1. 入水时给地面材质注入焦散 emissive（不依赖光照，天然附加"水底光斑"），出水时按缓存还原；
//      焦散强度按潜水深度衰减（越深越暗）。
//   2. 入水时启用 scene.fog（LINEAR 蓝色），让远处地面自然褪入深蓝；出水时关闭。
//
// 用户明确"不搞入水动画"：所有切换即时无渐变（入水瞬间生效，出水瞬间失效）。
//
// 性能：每帧只做 O(已安装材质数) 的 emissiveColor 赋值 + 一次边界检测；fogMode 仅在
// 穿越水面时切换（避免每帧触发 Babylon 着色器重编译）。

import { Color3, PBRMaterial, Scene, StandardMaterial } from '@babylonjs/core';
import { causticsController, isCausticsHost } from './env-caustics';

// 水下雾色（深海蓝青，对应"白蓝交替"泳池远处的深色）
const UNDERWATER_FOG_COLOR = new Color3(0.04, 0.28, 0.40);
// 焦散色（淡蓝白，模拟阳光经水折射后颜色）
const CAUSTIC_TINT = new Color3(0.78, 0.92, 1.0);

// 场景雾起止距离（米）：近处清晰、远处褪蓝
const FOG_START = 1.5;
const FOG_END = 28;

interface InstalledMat {
    mat: PBRMaterial | StandardMaterial;
    origEmissiveTex: PBRMaterial['emissiveTexture'] | StandardMaterial['emissiveTexture'] | null;
    origEmissiveColor: Color3;
}

class UnderwaterFogControllerImpl {
    private _waterLevel = 0;
    private _installed = new Set<InstalledMat>();
    private _wasUnderwater = false;

    /** 通知控制器"水面 Y 已经变化"（env-impl 在 state.waterLevel 变化时调用）。 */
    setWaterLevel(level: number): void {
        this._waterLevel = level;
    }

    /** 给一个地面材质注册水下修饰（焦散 emissive）。幂等：同一 mat 只存一次。 */
    install(mat: PBRMaterial | StandardMaterial | null | undefined): void {
        if (!isCausticsHost(mat)) return;
        if (this._installed.size > 0 && [...this._installed].some((x) => x.mat === mat)) return;
        this._installed.add({
            mat,
            origEmissiveTex: mat.emissiveTexture,
            origEmissiveColor: mat.emissiveColor.clone(),
        });
    }

    /** 每帧调用：根据相机 Y 与水面关系切换场景雾 + 焦散 emissive。
     *  关键性能约束：仅在"穿越水面边界"时切换一次材质（set emissiveColor / fogMode），
     *  绝不每帧赋值——否则 Babylon 会因材质脏标记每帧重编译着色器。
     *  焦散动感由 causticsController.update(dt) 推进纹理 uOffset 提供（改纹理 offset 不触发重编译）。 */
    update(_dt: number, scene: Scene): void {
        const cam = scene.activeCamera;
        if (!cam) return;
        const depth = this._waterLevel - cam.globalPosition.y;
        const isUnderwater = depth > 0;

        if (isUnderwater === this._wasUnderwater) return; // 状态未变，无需任何操作
        this._wasUnderwater = isUnderwater;

        if (isUnderwater) {
            // 入水：启用场景雾（远处地面褪入深蓝）+ 给地面注入焦散 emissive
            scene.fogMode = Scene.FOGMODE_LINEAR;
            scene.fogColor = UNDERWATER_FOG_COLOR;
            scene.fogStart = FOG_START;
            scene.fogEnd = FOG_END;
            const causticTex = causticsController.getTexture(scene);
            for (const entry of this._installed) {
                entry.mat.emissiveTexture = causticTex;
                entry.mat.emissiveColor = CAUSTIC_TINT;
            }
        } else {
            // 出水：关闭场景雾 + 还原地面原始 emissive
            scene.fogMode = Scene.FOGMODE_NONE;
            for (const entry of this._installed) {
                entry.mat.emissiveTexture = entry.origEmissiveTex;
                entry.mat.emissiveColor = entry.origEmissiveColor;
            }
        }
    }

    /** 场景销毁 / HMR 重入时清理。 */
    reset(scene?: Scene): void {
        if (scene) scene.fogMode = Scene.FOGMODE_NONE;
        this._wasUnderwater = false;
        this._waterLevel = 0;
        this._installed.clear();
    }
}

export const underwaterFogController = new UnderwaterFogControllerImpl();
