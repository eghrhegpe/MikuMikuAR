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
import { causticsController, isCausticsHost, CAUSTIC_WORLD_SCALE } from './env-caustics';
import { setUnderwaterFog } from './env-water';
import { envState } from '@/core/config';

// 水下雾色基准（浅青色，配合 env-water 的 colorCurves 共同营造水下视觉）。
// 实际雾色会再与天空底色（skyColorBot）混合 —— 从水下往上看即天空，
// 雾色理应跟随天空色（见 computeUnderwaterFogColor）。
const UNDERWATER_FOG_BASE = new Color3(0.35, 0.58, 0.72);
// 焦散色（淡蓝白，模拟阳光经水折射后颜色）
const CAUSTIC_TINT = new Color3(0.78, 0.92, 1.0);

// 雾距离单位说明：场景坐标用的是 babymmd unit（1 unit = 0.1 米，见 AGENTS.md）。
// groundSize 默认 500 unit = 50 米，所以以下数值都是 unit。
// Babylon FOGMODE_LINEAR 真实语义（已核对 public/lib/babylon.js）：
//   真实 fragment shader：
//     float fog = (fogEnd - distance) / (fogEnd - fogStart);  // distance 即到相机的 unit 距离
//     color.rgb = mix(vFogColor, color.rgb, fog);   // fog=0 → fogColor(满雾), fog=1 → 原色(无雾)
//   所以：
//     - distance ≤ fogStart → fog ≥ 1 → 完全无雾（显示原色）
//     - distance ≥ fogEnd   → fog ≤ 0 → 完全满雾（显示 fogColor）
//     - 命名直觉相反：fogStart 实际是"无雾阈值"，fogEnd 实际是"满雾阈值"
//   "近处清晰、远处雾" 是 fogStart < fogEnd 的常规方向。
const FOG_NEAR_CLEAR = 40.0; // 对应 Babylon fogStart：距离 ≤ 40 unit(4m) 完全无雾（角色约 2-3m 永远清晰）
const FOG_FAR_OPAQUE = 500.0; // 对应 Babylon fogEnd：距离 ≥ 500 unit(50m) 完全满雾（远景褪入深蓝，远处地面隐约可见）

/** 计算水下雾色：基准浅青与天空底色（skyColorBot）混合，让雾色随天空变化（用户反馈"未察觉天空色影响"）。 */
function computeUnderwaterFogColor(): Color3 {
    const sky = envState.skyColorBot ?? [0.3, 0.5, 0.8];
    const skyCol = new Color3(sky[0], sky[1], sky[2]);
    // 冷化天空底色后轻混基色，保留水下辨识度（不至于被天空色完全同化）。
    return Color3.Lerp(UNDERWATER_FOG_BASE, skyCol.scale(0.85), 0.4);
}

// 焦散 UV 在地面上的重复次数（Babylon Texture.uScale/vScale）。
// 从共享的 world→UV 尺度系数派生：uScale = groundSize * CAUSTIC_WORLD_SCALE，
// 使地面光斑与世界空间锚定的水面焦散（water.frag `camXZ * 0.15`）同尺度。
// 旧版写死常量 8 不随 groundSize 变：groundSize 默认 500 unit 时 8 令单 cell≈62.5 unit，
// 而水面为 6.67 unit，地水焦散差 ~9 倍（地面光斑过粗）——本次改为派生后对齐。
// 水面 shader 不依赖 Babylon Texture.uScale（直接用 camXZ 世界坐标采样），改此值仅影响地面。

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

    /** [adr-230 P1-fix] 当前是否处于水下（焦散已注入状态）。
     *  applyGroundMaterialSpec 据此判断：emissive 同步后
     *  是否需要重放焦散，避免 _syncGroundEmissive 覆盖焦散（见 ADR-231 §3.2）。 */
    isCausticsActive(): boolean {
        return this._wasUnderwater;
    }

    /** [adr-230 P1-fix] 给单个已安装材质重放焦散 emissive。仅当当前在水下时生效；
     *  供 _syncGroundEmissive 之后的调用方使用。与 update 入水分支同一逻辑——
     *  重复调用幂等（重复设置同值 emissive 不触发着色器重编译）。 */
    applyCausticsTo(mat: PBRMaterial | StandardMaterial, scene: Scene): void {
        if (!this._wasUnderwater || !isCausticsHost(mat)) {
            return;
        }
        const causticTex = causticsController.getTexture(scene);
        // 给 causticTex 在地面上设置与水面同尺度的 UV 缩放（从 groundSize 派生，
        // 锚定世界空间）。水面 shader 用 camXZ 世界坐标自采样，不读 Babylon Texture.uScale，
        // 所以在共享纹理上改 uScale 只影响地面。
        const groundCausticScale = (envState.groundSize ?? 500) * CAUSTIC_WORLD_SCALE;
        causticTex.uScale = groundCausticScale;
        causticTex.vScale = groundCausticScale;
        mat.emissiveTexture = causticTex;
        mat.emissiveColor = CAUSTIC_TINT;
    }

    /** [adr-230 P1-fix] 自发光同步后调用：刷新已安装材质的还原快照，避免出水时还原到
     *  安装时刻的陈旧 emissive（用户在水下改过发光设置的情形）。 */
    noteGroundEmissiveChanged(mat: PBRMaterial | StandardMaterial): void {
        for (const entry of this._installed) {
            if (entry.mat === mat) {
                entry.origEmissiveTex = mat.emissiveTexture;
                entry.origEmissiveColor = mat.emissiveColor.clone();
                return;
            }
        }
    }

    /** 给一个地面材质注册水下修饰（焦散 emissive）。幂等：同一 mat 只存一次。 */
    install(mat: PBRMaterial | StandardMaterial | null | undefined): void {
        if (!isCausticsHost(mat)) {
            return;
        }
        if (this._installed.size > 0 && [...this._installed].some((x) => x.mat === mat)) {
            return;
        }
        this._installed.add({
            mat,
            origEmissiveTex: mat.emissiveTexture,
            origEmissiveColor: mat.emissiveColor.clone(),
        });
    }

    /** [fix P1] 材质销毁时移除已安装条目，避免 update() 对已 dispose 材质写 emissive（泄漏 + 僵尸写入）。 */
    uninstall(mat: PBRMaterial | StandardMaterial): void {
        for (const entry of this._installed) {
            if (entry.mat === mat) {
                this._installed.delete(entry);
            }
        }
    }

    /** 每帧调用：根据相机 Y 与水面关系切换场景雾 + 焦散 emissive。
     *  关键性能约束：仅在"穿越水面边界"时切换一次材质（set emissiveColor / fogMode），
     *  绝不每帧赋值——否则 Babylon 会因材质脏标记每帧重编译着色器。
     *  焦散动感由 causticsController.update(dt) 推进纹理 uOffset 提供（改纹理 offset 不触发重编译）。 */
    update(_dt: number, scene: Scene): void {
        const cam = scene.activeCamera;
        if (!cam) {
            return;
        }
        // [fix P1] 仅相机低于水面不足以触发水下效果：须受 waterEnabled / underwaterEnabled 门控
        // （与 env-water.ts:1150 一致），否则关闭水面后相机潜入仍注入蓝雾 + 焦散 emissive。
        const gate = envState.waterEnabled && (envState.underwaterEnabled ?? true);
        const depth = this._waterLevel - cam.globalPosition.y;
        const isUnderwater = gate && depth > 0;

        if (isUnderwater === this._wasUnderwater) {
            return;
        } // 状态未变，无需任何操作
        this._wasUnderwater = isUnderwater;

        if (isUnderwater) {
            // 入水：启用场景雾（远处地面褪入深蓝）+ 给地面注入焦散 emissive
            const fogColor = computeUnderwaterFogColor();
            scene.fogMode = Scene.FOGMODE_LINEAR;
            scene.fogColor = fogColor;
            scene.fogStart = FOG_NEAR_CLEAR; // 距离 ≤ 40 unit(4m) 完全无雾
            scene.fogEnd = FOG_FAR_OPAQUE; // 距离 ≥ 500 unit(50m) 完全满雾
            // 同步水下雾给水面对应的 ShaderMaterial（它不参与 Babylon scene.fog，需手动注入），
            // 让水面与地面/角色用同一套雾参数，远处水面也褪入雾色。
            setUnderwaterFog(true, fogColor, FOG_NEAR_CLEAR, FOG_FAR_OPAQUE);
            for (const entry of this._installed) {
                this.applyCausticsTo(entry.mat, scene);
            }
        } else {
            // 出水：关闭场景雾 + 还原地面原始 emissive
            scene.fogMode = Scene.FOGMODE_NONE;
            setUnderwaterFog(false, UNDERWATER_FOG_BASE, FOG_NEAR_CLEAR, FOG_FAR_OPAQUE);
            for (const entry of this._installed) {
                entry.mat.emissiveTexture = entry.origEmissiveTex;
                entry.mat.emissiveColor = entry.origEmissiveColor;
            }
        }
    }

    /** 场景销毁 / HMR 重入时清理。 */
    reset(scene?: Scene): void {
        // 先还原已安装地面材质的 emissive（即便在水下清场，也避免焦散 emissive 永久残留）
        for (const entry of this._installed) {
            entry.mat.emissiveTexture = entry.origEmissiveTex;
            entry.mat.emissiveColor = entry.origEmissiveColor;
        }
        this._installed.clear();
        if (scene) {
            scene.fogMode = Scene.FOGMODE_NONE;
        }
        setUnderwaterFog(false, UNDERWATER_FOG_BASE, FOG_NEAR_CLEAR, FOG_FAR_OPAQUE);
        this._wasUnderwater = false;
        this._waterLevel = 0;
    }
}

export const underwaterFogController = new UnderwaterFogControllerImpl();
