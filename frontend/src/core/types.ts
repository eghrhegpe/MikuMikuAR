// [doc:architecture] Shared types for MikuMikuAR.
// Extracted from config.ts — pure type definitions only, zero runtime code.

import type { IMmdModel } from 'babylon-mmd/esm/Runtime/IMmdModel';
import type { Mesh } from '@babylonjs/core/Meshes/mesh';
import type { Texture } from '@babylonjs/core/Materials/Textures/texture';
import type { ClothConfig } from '../physics/xpbd-cloth';

// ======== Model Types ========

export type ModelKind = 'actor' | 'stage';

/** VMD 动画图层 — 支持多 VMD 叠加（Motion Layers） */
export type VmdLayer = {
    id: string;
    name: string;
    data: ArrayBuffer;
    path: string | null;
    weight: number;
    enabled: boolean;
    /** 骨骼过滤：空数组=全部骨骼，非空=仅这些骨骼受此层影响 */
    boneFilter: string[];
};

/**
 * IMmdModel 接口不含 setRuntimeAnimation / createRuntimeAnimation
 * （这两个方法在 MmdModel 和 MmdWasmModel 具体类上）。
 * 此扩展类型补上运行时动画相关方法，供 ModelInstance.mmdModel 使用。
 */
export type RuntimeModel = IMmdModel & {
    setRuntimeAnimation(animation: unknown): void;
    createRuntimeAnimation(animation: unknown): unknown;
};

export type ModelInstance = {
    id: string;
    name: string;
    filePath: string;
    port: number;
    modelDir: string;
    meshes: Mesh[];
    rootMesh: Mesh;
    mmdModel?: RuntimeModel;
    vmdData: ArrayBuffer | null;
    vmdName: string;
    vmdPath: string | null;
    animationDuration: number;
    /** 多 VMD 图层（Motion Layers），空数组=单 VMD 模式 */
    vmdLayers: VmdLayer[];
    kind: ModelKind;
    visible: boolean;
    opacity: number;
    wireframe: boolean;
    showBoneLines: boolean;
    showBoneJoints: boolean;
    physicsEnabled: boolean;
    scaling: number;
    rotationY: number;
    outfitFile?: OutfitFile;
    activeVariant?: string;
    _origTextures?: Map<
        number,
        {
            diffuse?: Texture | null;
            toon?: Texture | null;
            spa?: Texture | null;
            normal?: Texture | null;
            emissive?: Texture | null;
        }
    >;
    _origParams?: Map<
        number,
        {
            diffuseR: number;
            diffuseG: number;
            diffuseB: number;
            specularR: number;
            specularG: number;
            specularB: number;
            specularPower: number;
            ambientR: number;
            ambientG: number;
            ambientB: number;
        }
    >;
    /** FBX overlay mesh 列表（切换变体时加载/释放） */
    _overlayMeshes?: Mesh[];
    /** 原始材质可见性快照（hideMaterials 前保存，用于 restore） */
    _origMaterialVisibility?: Map<number, boolean>;
};

/** [doc:architecture] PropInstance — 场景道具实例（独立于模型库，不参与 VMD/物理/排列） */
export type PropInstance = {
    id: string;
    name: string;
    filePath: string;
    port: number;
    modelDir: string;
    meshes: Mesh[];
    rootMesh: Mesh;
    container?: import('@babylonjs/core/Meshes/transformNode').TransformNode;
    position: [number, number, number];
    rotationY: number;
    scaling: number;
    visible: boolean;
};

// ======== Outfit System Types ========

export type OutfitSlot = {
    diffuse?: string;
    toon?: string;
    spa?: string;
    normal?: string;
    emissive?: string;
    params?: { diffuseMul?: number; specularMul?: number; shininess?: number; ambientMul?: number };
    tint?: [number, number, number];
};

export type OutfitVariant = {
    name: string;
    byCategory?: Record<string, OutfitSlot>;
    byMaterial?: Record<string, OutfitSlot>;
    all?: OutfitSlot;
    /** FBX overlay 文件路径（相对模型目录），有此字段时加载 mesh 叠加层 */
    meshFile?: string;
    /** 切换此变体时隐藏的 PMX 材质名列表 */
    hideMaterials?: string[];
};

export type OutfitFile = {
    version: number;
    variants: OutfitVariant[];
};

// ======== Library Types ========

export type LibraryModel = {
    dir: string;
    file_path: string;
    name_jp: string;
    name_en: string;
    comment: string;
    has_thumb: boolean;
    type: string;
    format: string;
    container: string;
    zip_inner: string;
    category: string;
    source: string;
};

// ======== Popup/Menu Types ========

export type PopupRow = {
    kind: 'folder' | 'model' | 'action' | 'divider'
        | 'slider' | 'toggle' | 'modeSlider' | 'chips';
    label: string;
    icon: string;
    target: string;
    sublabel?: string;
    model?: LibraryModel;
    catTag?: string;
    editable?: boolean;
    favRef?: string;
    onAddClick?: () => void;
    onDetailClick?: () => void;
    rowKey?: string;
    headerToggle?: {
        value: boolean;
        onChange: (v: boolean) => void;
        disabled?: boolean;
        disabledHint?: string;
        onDisabledClick?: () => void;
        bind?: () => boolean;
    };
    sliderValue?: number;
    sliderMin?: number;
    sliderMax?: number;
    sliderStep?: number;
    onSliderChange?: (v: number) => void;
    onSliderDragEnd?: (v: number) => void;
    toggleValue?: boolean;
    onToggleChange?: (v: boolean) => void;
    modeOptions?: { value: string | number; label: string }[];
    modeValue?: string | number;
    onModeChange?: (v: string | number) => void;
    chips?: { label: string; active?: boolean; onClick: () => void }[];
};

export type PopupLevel = {
    label: string;
    dir: string;
    items: PopupRow[];
    renderCustom?: (container: HTMLElement) => void | Promise<void>;
    reRenderCustom?: (container: HTMLElement) => void;
};

// ======== UI State ========

export interface UIState {
    scale?: number;
    popupWidth?: number;
    accent?: string;
    fontFamily?: string;
    animations?: boolean;
    blurBg?: boolean;
    performanceMode?: 'auto' | 'quality' | 'balanced' | 'performance';
    /** 帧率上限（0=不限） */
    fpsLimit?: number;
    materialCategoryMap?: Record<string, string>;
    screenshotFormat?: 'image/png' | 'image/jpeg' | 'image/webp';
    screenshotQuality?: number;
    autoCameraEnabled?: boolean;
    autoCameraBeatsPerSwitch?: number;
}

// ======== Environment State ========

export interface EnvState {
    skyMode: 'color' | 'texture' | 'procedural';
    skyColorTop: [number, number, number];
    skyColorMid: [number, number, number];
    skyColorBot: [number, number, number];
    skyTexture: string;
    skyRotationY: number;
    skyRotationSpeed: number;
    skyBrightness: number;
    starsEnabled: boolean;
    envIntensity: number;

    groundVisible: boolean;
    groundMode: 'solid' | 'grid' | 'checker' | 'texture';
    groundColor: [number, number, number];
    groundAlpha: number;
    groundTexture: string;
    groundTextureEnabled: boolean;
    groundTextureScale: number;

    windEnabled: boolean;
    windDirection: [number, number, number];
    windSpeed: number;

    particleEnabled: boolean;
    particleType: 'none' | 'sakura' | 'rain' | 'snow' | 'fireworks' | 'fireflies' | 'leaves';
    particleEmitRate: number;
    particleSize: number;
    particleSpeed: number;
    particleSplash: boolean;
    particleCustomTexture: string; // 自定义粒子纹理 data URL，空=默认

    groundLevel: number;

    waterEnabled: boolean;
    waterLevel: number;
    waterColor: [number, number, number];
    waterTransparency: number;
    waterWaveHeight: number;
    waterSize: number;
    waterAnimSpeed: number;

    foamThreshold: number;
    foamIntensity: number;

    fresnelBias: number;
    fresnelPower: number;
    diffuseStrength: number;
    ambientStrength: number;
    foamTransitionRange: number;
    rippleNormalStrength: number;
    rippleGlintStrength: number;
    causticColor1: [number, number, number];
    causticColor2: [number, number, number];
    causticScrollX: number;
    causticScrollY: number;
    fresnelAlphaInfluence: number;
    foamAlphaInfluence: number;

    underwaterFogColor: [number, number, number];
    underwaterFogDensity: number;
    underwaterChromaticAmount: number;
    underwaterToneIntensity: number;
    underwaterFogMultiplier: number;

    cloudsEnabled: boolean;
    debugClouds?: boolean;
    cloudCover: number;
    cloudScale: number;
    cloudHeight: number;
    cloudThickness: number;
    cloudVisibility: number;
    cloudGap: number;

    fogEnabled: boolean;
    fogMode: 'exp' | 'exp2' | 'linear';
    fogColor: [number, number, number];
    fogDensity: number;
    fogStart: number;
    fogEnd: number;

    clothEnabled: boolean;
    clothConfig: ClothConfig;
    clothDebugParticles: boolean;
    clothDebugConstraints: boolean;
    clothDebugColliders: boolean;
    solverSubsteps: number;
    solverTimeScale: number;
    collisionEnabled: boolean;
    bodyCollisionEnabled: boolean;
    groundCollisionEnabled: boolean;

    sunAngle: number;
    azimuth: number;

    lightingPresetName?: string;

    timeOfDayActive: boolean;
    timeOfDaySpeed: number;
}

// ======== Miscellaneous Types ========

export type MmdRuntimeType = 'wasm' | 'js';

export type PendingVmd = { data: ArrayBuffer; name: string };

export interface OverridePaths {
    pmx?: string;
    vmd?: string;
    audio?: string;
    stage?: string;
    prop?: string;
    environment?: string;
    md_dress?: string;
    setting?: string;
}

export type DisplayNamePriority = 'name_jp' | 'name_en' | 'filename';

export type PhysicsCategory = 'skirt' | 'chest' | 'hair' | 'accessory';

export type CameraMode = 'orbit' | 'freefly' | 'oneshot' | 'concert';

export type LibrarySortMode = 'default' | 'name';

export interface RecentMotion {
    path: string;
    name: string;
    timestamp: number;
}
