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

// 水下雾色（浅青色，配合 env-water 的 colorCurves 共同营造水下视觉；
// 不能太深，否则会和 colorCurves 全屏色调旋转叠加成"重墨蓝"，看不清角色）
const UNDERWATER_FOG_COLOR = new Color3(0.35, 0.58, 0.72);
// 焦散色（淡蓝白，模拟阳光经水折射后颜色）
const CAUSTIC_TINT = new Color3(0.78, 0.92, 1.0);

// Babylon FOGMODE_LINEAR 真实语义（已核对 public/lib/babylon.js）：
//   真实 fragment shader：
//     float fog = CalcFogFactor();          // fog = (fogEnd - distance) / (fogEnd - fogStart)
//     color.rgb = mix(vFogColor, color.rgb, fog);   // fog=0 → fogColor, fog=1 → 原色
//   所以：
//     - distance ≤ fogStart → fog ≥ 1 → clamp 1 → 完全无雾（显示原色）
//     - distance ≥ fogEnd   → fog ≤ 0 → clamp 0 → 完全满雾（显示 fogColor）
//     - 命名直觉相反：fogStart 实际是"无雾阈值"，fogEnd 实际是"满雾阈值"
//   "近处清晰、远处雾" 是 fogStart < fogEnd 的常规方向。
const FOG_NEAR_CLEAR = 5.0;  // 对应 Babylon fogStart：距离 ≤ 5m 完全无雾（角色 2-3m 永远清晰）
const FOG_FAR_OPAQUE = 80.0; // 对应 Babylon fogEnd：距离 ≥ 80m 完全满雾（远景褪入深蓝）

// 焦散 UV 在地面上的重复次数。
// 共享 causticTex 默认 uScale/vScale=1 → 128×128 整张图直接贴到 60m 地面，
// 每个 Voronoi cell 覆盖约 15m → 视觉上是一个巨型光斑，看不出"光斑纹路"。
// 设为 8 后每个 cell 约 1.875m（接近参考图密度）。
// 水面 shader 不依赖 Babylon Texture.uScale（用自家 uCausticScale uniform），
// 因此改这一值只影响地面材质，不影响水面焦散。
const GROUND_CAUSTIC_UV_SCALE = 8;

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
            scene.fogStart = FOG_NEAR_CLEAR; // 距离 ≤ 5m 完全无雾
            scene.fogEnd = FOG_FAR_OPAQUE;   // 距离 ≥ 80m 完全满雾
            const causticTex = causticsController.getTexture(scene);
            // 给 causticTex 在地面上设置合理 UV 缩放（共享纹理的 uScale/vScale 默认 1，
            // 在 60m 地面上单 cell ≈ 15m，巨大到看不出"光斑"；水面 shader 用自家
            // uCausticScale uniform，不依赖 Babylon 的 Texture.uScale，所以改这一值安全）。
            causticTex.uScale = GROUND_CAUSTIC_UV_SCALE;
            causticTex.vScale = GROUND_CAUSTIC_UV_SCALE;
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
