// SssPBRMaterial — SSS (次表面散射) 封装
//
// 基于 Babylon.js 9.19 原生 PBRSubSurfaceConfiguration 插件。
// 提供简化的 API，自动管理 SSS 插件的生命周期。
//
// 参数说明（对应 PBRSubSurfaceConfiguration 内部参数）：
// - sssPower:             总开关强度（0=关闭，0.1~1.5 常用），映射到 translucencyIntensity
// - sssColor:             SSS 散射颜色，映射到 tintColor
// - sssDistance:          散射距离/深度（0=浅，1=深），映射到 tintColorAtDistance
// - sssDiffusion:         扩散距离（R/G/B 三色独立），映射到 diffusionDistance
// - isTranslucencyEnabled: 启用/禁用 SSS 透光效果
// - isScatteringEnabled:   启用/禁用 SSS 散射效果
//
// 使用方式：
//   const mat = new SssPBRMaterial('skin', scene);
//   mat.sssPower = 0.8;
//   mat.sssColor = new Color3(1.0, 0.6, 0.4);  // 皮肤偏橙
//   mat.sssDistance = 0.6;

import { Color3 } from '@babylonjs/core/Maths/math.color';
import { PBRMaterial } from '@babylonjs/core/Materials/PBR/pbrMaterial';
import { PBRSubSurfaceConfiguration } from '@babylonjs/core/Materials/PBR/pbrSubSurfaceConfiguration';
import type { Nullable } from '@babylonjs/core/types';
import type { Scene } from '@babylonjs/core/scene';

export class SssPBRMaterial extends PBRMaterial {
    private _sssEnabled: boolean = false;
    private _sssPower: number = 0.0;
    private _sssColor: Color3 = Color3.White();
    private _sssDistance: number = 0.5;
    private _sssDiffusion: Color3 = Color3.White();
    private _sssDiffusionProfile: Nullable<Color3> = null;

    // 底层 PBRSubSurfaceConfiguration 实例引用
    private _subSurface: Nullable<PBRSubSurfaceConfiguration> = null;

    constructor(name: string, scene?: Scene, forceGLSL?: boolean) {
        super(name, scene, forceGLSL);
        // [fix P1] Babylon 9.x PBRBaseMaterial 公开只读 subSurface（pbrBaseMaterial.pure.js
        // 构造时赋值 this.subSurface = new PBRSubSurfaceConfiguration(this)），直接读取；
        // 不再桥接访问 plugins 数组（9.x 插件注册于私有 pluginManager._plugins，无 plugins 成员）。
        this._subSurface = this.subSurface;
    }

    // ========== SSS 启用/禁用 ==========

    public get isSssEnabled(): boolean {
        return this._sssEnabled;
    }
    public set isSssEnabled(value: boolean) {
        if (this._sssEnabled === value) {
            return;
        }
        this._sssEnabled = value;
        this._syncSubSurface();
        this.markDirty();
    }

    // ========== SSS 强度（对应 translucencyIntensity） ==========

    /** SSS 强度乘子，0=关闭，0.1~1.5 常用范围 */
    public get sssPower(): number {
        return this._sssPower;
    }
    public set sssPower(value: number) {
        // [fix P4] NaN 守卫：Math.max/min 对 NaN 返回 NaN 且 NaN !== NaN 恒真，会污染 shader uniform
        if (!Number.isFinite(value) || this._sssPower === value) {
            return;
        }
        this._sssPower = Math.max(0.0, Math.min(2.0, value));
        this._syncSubSurface();
        this.markDirty();
    }

    // ========== SSS 颜色（对应 tintColor） ==========

    /** SSS 散射颜色（皮肤偏橙红，蜡/橡胶偏白，玉石偏绿） */
    public get sssColor(): Color3 {
        return this._sssColor;
    }
    public set sssColor(value: Color3) {
        if (this._sssColor.equals(value)) {
            return;
        }
        this._sssColor = value.clone();
        this._syncSubSurface();
        this.markDirty();
    }

    // ========== SSS 距离（对应 tintColorAtDistance） ==========

    /** SSS 散射距离/深度，0=浅（表面），1=深（通透材质） */
    public get sssDistance(): number {
        return this._sssDistance;
    }
    public set sssDistance(value: number) {
        // [fix P4] NaN 守卫
        if (!Number.isFinite(value) || this._sssDistance === value) {
            return;
        }
        this._sssDistance = Math.max(0.0, Math.min(1.0, value));
        this._syncSubSurface();
        this.markDirty();
    }

    // ========== SSS 扩散（对应 diffusionDistance） ==========

    /** SSS 扩散距离（R/G/B 三色独立，控制 RGB 在材质中的传播距离） */
    public get sssDiffusion(): Color3 {
        return this._sssDiffusion;
    }
    public set sssDiffusion(value: Color3) {
        if (this._sssDiffusion.equals(value)) {
            return;
        }
        this._sssDiffusion = value.clone();
        this._syncSubSurface();
        this.markDirty();
    }

    // ========== SSS 扩散剖面（对应 scatteringDiffusionProfile） ==========

    /** 扩散剖面颜色，用于更真实的皮肤/树叶散射效果（可选） */
    public get sssDiffusionProfile(): Nullable<Color3> {
        return this._sssDiffusionProfile;
    }
    public set sssDiffusionProfile(value: Nullable<Color3>) {
        this._sssDiffusionProfile = value;
        this._syncSubSurface();
        this.markDirty();
    }

    // ========== SSS 厚度 ==========

    /** 最小厚度值，用于模拟材质厚度（无厚度贴图时使用） */
    public get sssMinThickness(): number {
        return this._getSubSurface()?.minimumThickness ?? 0.0;
    }
    public set sssMinThickness(value: number) {
        // [fix P4] NaN 守卫
        if (!Number.isFinite(value)) {
            return;
        }
        const ss = this._getSubSurface();
        if (!ss) {
            return;
        }
        ss.minimumThickness = Math.max(0.0, value);
        this.markDirty();
    }

    /** 最大厚度值 */
    public get sssMaxThickness(): number {
        return this._getSubSurface()?.maximumThickness ?? 1.0;
    }
    public set sssMaxThickness(value: number) {
        // [fix P4] NaN 守卫
        if (!Number.isFinite(value)) {
            return;
        }
        const ss = this._getSubSurface();
        if (!ss) {
            return;
        }
        ss.maximumThickness = Math.max(0.001, value);
        this.markDirty();
    }

    // ========== 内部：同步 SSS 参数到 PBRSubSurfaceConfiguration ==========

    private _getSubSurface(): Nullable<PBRSubSurfaceConfiguration> {
        return this._subSurface;
    }

    /** 同步 SSS 参数到底层 PBRSubSurfaceConfiguration */
    private _syncSubSurface(): void {
        const ss = this._getSubSurface();
        if (!ss) {
            return;
        }

        // 启用/禁用 SSS
        ss.isTranslucencyEnabled = this._sssEnabled && this._sssPower > 0.0;
        ss.isScatteringEnabled = this._sssEnabled && this._sssPower > 0.0;

        // 强度
        ss.translucencyIntensity = this._sssEnabled ? this._sssPower : 0.0;

        // 颜色
        ss.tintColor = this._sssColor;

        // 距离
        ss.tintColorAtDistance = this._sssEnabled ? this._sssDistance : 0.0;

        // 扩散
        ss.diffusionDistance = this._sssDiffusion;

        // 扩散剖面
        ss.scatteringDiffusionProfile = this._sssDiffusionProfile;

        // 厚度
        ss.useThicknessAsDepth = this._sssEnabled;
    }

    // ========== 生命周期 ==========

    /** 标记材质需要重新编译 effect */
    public markDirty(): void {
        super.markDirty();
    }

    /** 释放 SSS 资源 */
    public dispose(forceExhaustive?: boolean): void {
        this._subSurface = null;
        super.dispose?.(forceExhaustive);
    }

    // ========== 克隆 ==========

    public clone(name: string, cloneTexturesOnlyOnce?: boolean, rootUrl?: string): SssPBRMaterial {
        // [fix P1] super.clone 创建的是普通 PBRMaterial（原型链 PBRMaterial.prototype），
        // 用 setPrototypeOf 恢复 SssPBRMaterial 原型，否则 _syncSubSurface 等方法不存在，
        // 且返回实例的 SSS setter 不会生效。纹理/alpha/透明度等 PBR 状态由基类完整克隆。
        const result = Object.setPrototypeOf(
            super.clone(name, cloneTexturesOnlyOnce, rootUrl),
            SssPBRMaterial.prototype
        ) as unknown as SssPBRMaterial;
        result._sssEnabled = this._sssEnabled;
        result._sssPower = this._sssPower;
        result._sssColor = this._sssColor.clone();
        result._sssDistance = this._sssDistance;
        result._sssDiffusion = this._sssDiffusion.clone();
        result._sssDiffusionProfile = this._sssDiffusionProfile;
        result._subSurface = result.subSurface ?? null;
        result._syncSubSurface();
        return result;
    }
}
