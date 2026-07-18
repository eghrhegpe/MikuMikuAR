// [doc:architecture] Shared types for MikuMikuAR.
// Extracted from config.ts — pure type definitions only, zero runtime code.

import type { IMmdModel } from 'babylon-mmd/esm/Runtime/IMmdModel';
import type { IMmdRuntimeBone } from 'babylon-mmd/esm/Runtime/IMmdRuntimeBone';
import type { IkSolver } from 'babylon-mmd/esm/Runtime/ikSolver';
import type { IMmdBindableModelAnimation } from 'babylon-mmd/esm/Runtime/Animation/IMmdBindableAnimation';
import type { IMmdRuntimeModelAnimation } from 'babylon-mmd/esm/Runtime/Animation/IMmdRuntimeAnimation';
import type { MmdRuntimeAnimationHandle } from 'babylon-mmd/esm/Runtime/mmdRuntimeAnimationHandle';
import type { Nullable } from '@babylonjs/core/types';
import type { Mesh } from '@babylonjs/core/Meshes/mesh';
import type { Texture } from '@babylonjs/core/Materials/Textures/texture';
import type { UIState as GoUIState } from './wails-bindings';
import type { TrailingAction } from './ui-slide-row';

export type { GoUIState };

// ======== Bone Override Types ========

/** [doc:adr-061] Motion Override — 持久化的单条骨骼覆盖配置 */
export type BoneOverrideEntry = {
    boneName: string;
    /** 欧拉角（度），[pitch, yaw, roll] */
    euler: [number, number, number];
    /** 混合权重 0–1，1=硬覆盖 */
    weight: number;
    /** 启用/禁用 */
    enabled: boolean;
};

// ======== Motion Override Module Types (ADR-116) ========

/** [doc:adr-116] 动作覆盖模块语义参数值 */
export type ParamValue = number | boolean | string;

/** [doc:adr-116] 模块语义状态（per-motion，随动作走） */
export type MotionModuleState = {
    id: string;
    enabled: boolean;
    params: Record<string, ParamValue>;
};

// ======== Procedural Motion Config (ADR-XX per-motion) ========

import type { ProcMotionState } from '@/motion-algos/procedural-motion';

/** [doc:adr-XX] 程序化动作配置（per-motion，随动作走）
 *  参数存 SceneMotionIntent.procMotion（多角色共享），
 *  启用/分配权在每角色 ModelInstance.motionSlots。*/
export type ProcMotionConfig = ProcMotionState;

// ======== Feet Adjustment (ADR-085) Types ========

/** [doc:adr-085] 脚部地面跟随（按模型）状态 */
export type FeetState = {
    /** 总开关 */
    enabled: boolean;
    /** 总体强度 0–1，0=禁用 */
    intensity: number;
    /** 脚底高度（世界单位），默认 0，脚尖与地面间隙 */
    soleHeight: number;
    /** 跳跃阈值：脚踝 Y 超过此值暂停校正（允许踢腿/跳跃），默认 0.5 */
    jumpThreshold: number;
    /** 身体响应平滑 0–1，默认 0.5 */
    bodySmooth: number;
    /** 脚部响应平滑 0–1，默认 0.5 */
    footSmooth: number;
    /** 最大足倾角（度），默认 30，限制单帧垂直修正幅度 */
    maxAngle: number;
    /** 触及倾角（度），默认 15，腿够不到时趾尖额外下沉 */
    reachAngle: number;
};

// ======== Model Types ========

export type ModelKind = 'actor' | 'stage';

/** VMD 动画图层 — 支持多 VMD 叠加（Motion Layers） */
export type VmdLayer = {
    id: string;
    name: string;
    kind: 'vmd' | 'gaze';
    data: ArrayBuffer;
    path: string | null;
    weight: number;
    enabled: boolean;
    /** 骨骼过滤：空数组=全部骨骼，非空=仅这些骨骼受此层影响 */
    boneFilter: string[];
};

// [doc:adr-121] 全局动作意图类型

/** 用户选择的「原始动作来源类型」——仅描述意图来源性质，不描述广播后的运行时产物。 */
export type MotionSource = 'vmd' | 'retargeted';

/** 场景级动作意图（「场上在跳什么」） */
export interface SceneMotionIntent {
    vmdPath: string | null;
    vmdName: string;
    vmdLayers: VmdLayer[];
    source: MotionSource;
    /** [doc:adr-129] 动作覆盖模块配置（随动作走） */
    motionModules?: MotionModuleState[];
    /** [doc:adr-XX] 程序化动作参数（随动作走，多角色共享参数；启用权在角色层） */
    procMotion?: ProcMotionConfig;
    // vmdData 为运行时缓存，不持久化
}

/** 槽位来源 */
export type SlotSource = 'inherit' | 'pinned' | 'procedural';

/** 单个槽位的配置 */
export interface MotionSlotConfig {
    source: SlotSource;
    /** source==='pinned' 时有效；须 structuredClone(activeMotion) 冻结快照 */
    pinned?: SceneMotionIntent;
    /** source==='procedural' 时选预设角色 */
    procRole?: 'idle' | 'autodance' | 'gesture' | 'expression';
    /** 运行时派生状态，不持久化 */
    status: 'compatible' | 'incompatible' | 'idle' | 'overridden';
}

/** 双槽位：槽位1 基础 + 槽位2 叠加 */
export interface ModelMotionSlots {
    primary: MotionSlotConfig;
    overlay: MotionSlotConfig;
}

/**
 * IMmdModel 接口不含 setRuntimeAnimation / createRuntimeAnimation
 * （这两个方法在 MmdModel 和 MmdWasmModel 具体类上）。
 * 此扩展类型补上运行时动画相关方法，供 ModelInstance.mmdModel 使用。
 * 类型签名与 MmdModel / MmdWasmModel 实际实现一致。
 * 待 ADR-110 上游 PR 合并后移除此本地 augmentation。
 */
export type RuntimeModel = IMmdModel & {
    setRuntimeAnimation(
        handle: Nullable<MmdRuntimeAnimationHandle>,
        updateMorphTarget?: boolean
    ): void;
    createRuntimeAnimation(
        animation: IMmdBindableModelAnimation,
        retargetingMap?: { [key: string]: string }
    ): MmdRuntimeAnimationHandle;
    currentAnimation?: Nullable<IMmdRuntimeModelAnimation>;
};

export type ModelInstance = {
    id: string;
    name: string;
    filePath: string;
    /** 库引用绝对路径（=LibraryModel.file_path）。zip 内模型为 zip 包路径，与解压临时 filePath 不同；
     * 详情面板元数据缓存以该路径为 key 命中。非库模型（拖拽/导入）为 undefined，回退 filePath。 */
    libraryPath?: string;
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
    /** [doc:adr-121] 双槽位动作分配：primary=基础, overlay=叠加 */
    motionSlots?: ModelMotionSlots;
    kind: ModelKind;
    visible: boolean;
    opacity: number;
    wireframe: boolean;
    showBoneLines: boolean;
    showBoneJoints: boolean;
    physicsEnabled: boolean;
    scaling: number;
    rotationY: number;
    /** [doc:adr-126] 全自由度旋转（欧拉角，弧度）：[x, y, z]；与 rotationY 同步（rotation[1] = rotationY） */
    rotation: [number, number, number];
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
    /** overlay 加载 token：防止快速切换变体时旧 loadOverlay 完成后覆盖新状态 */
    _overlayLoadToken?: symbol;
    /** 原始材质可见性快照（hideMaterials 前保存，用于 restore） */
    _origMaterialVisibility?: Map<number, boolean>;
    /** [doc:adr-061] Motion Override — 逐骨骼覆盖条目 */
    boneOverrides: BoneOverrideEntry[];
    /** [doc:adr-116] 动作覆盖模块语义状态（per-model） */
    motionOverrideModules?: MotionModuleState[];
    /** [doc:adr-085] 脚部地面跟随状态（按模型） */
    feet: FeetState;
    /** [doc:adr-049] 球面坐标轨道控制：坐标模式，默认 'cartesian' */
    positionMode?: 'cartesian' | 'orbit';
    /** [doc:adr-049] 水平方位角（度，-180~180），仅 positionMode==='orbit' 时生效 */
    orbitAzimuth?: number;
    /** [doc:adr-049] 垂直仰角（度，-90~90），仅 positionMode==='orbit' 时生效 */
    orbitElevation?: number;
    /** [doc:adr-049] 距原点距离（>0），仅 positionMode==='orbit' 时生效 */
    orbitDistance?: number;
};

/** [doc:architecture] PropInstance — 场景道具实例（独立于模型库，不参与 VMD/物理/排列） */
export type PropInstance = {
    id: string;
    name: string;
    filePath: string;
    meshes: Mesh[];
    rootMesh: Mesh;
    container?: import('@babylonjs/core/Meshes/transformNode').TransformNode;
    position: [number, number, number];
    rotationY: number;
    scaling: number;
    visible: boolean;
    /** [doc:adr-061] 骨骼锚定：目标骨骼名（非空=已锚定到骨骼） */
    boneName?: string;
    /** [doc:adr-061] 骨骼锚定：目标模型 ID */
    targetModelId?: string;
    /** [doc:adr-061] 骨骼锚定：相对骨骼的偏移 (x, y, z) */
    boneOffset?: [number, number, number];
    /** [doc:adr-061] 骨骼锚定：相对骨骼的旋转 (pitch, yaw, roll) */
    boneRotation?: [number, number, number];
    /** [doc:adr-049] 球面坐标轨道控制：坐标模式，默认 'cartesian' */
    positionMode?: 'cartesian' | 'orbit';
    /** [doc:adr-049] 水平方位角（度，-180~180），仅 positionMode==='orbit' 时生效 */
    orbitAzimuth?: number;
    /** [doc:adr-049] 垂直仰角（度，-90~90），仅 positionMode==='orbit' 时生效 */
    orbitElevation?: number;
    /** [doc:adr-049] 距原点距离（>0），仅 positionMode==='orbit' 时生效 */
    orbitDistance?: number;
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
    kind:
        | 'folder'
        | 'model'
        | 'action'
        | 'divider'
        | 'slider'
        | 'toggle'
        | 'modeSlider'
        | 'chips'
        | 'sectionTitle';
    label: string;
    icon: string;
    target: string;
    sublabel?: string;
    model?: LibraryModel;
    editable?: boolean;
    favRef?: string;
    onAddClick?: () => void;
    onDetailClick?: () => void;
    /** 统一尾部行为区：设置第二点击事件+图标后，装饰性 `>` 会被替换为该可点击按钮。
     *  与装饰 `>` 及 `+`(onAddClick) 互斥——从构造上杜绝误渲染 `>`。 */
    trailing?: TrailingAction;
    /** 统一左侧行为区：设置后，左侧图标（如 radio 指示）被渲染为可点击按钮，
     *  点击 stopPropagation 后触发该动作（如切焦点），与整行 onClick 解耦。
     *  视觉上复用 .slide-icon 尺寸（非 22px 盒装），保持指示图标一致性。 */
    leading?: TrailingAction;
    /** 选中态（radio/单选行）：渲染时附加 slide-focused 类。 */
    focused?: boolean;
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
    /** label 允许双行显示（用于长文件名等场景） */
    wrapLabel?: boolean;
};

// ======== Resource Browse Selection Outcome (ADR-131) ========
// 资源浏览「选中后行为」统一契约：取代散落的全局绑定标志位（layerBindingTargetId /
// motionBindingTargetId / modelReplaceTargetId）与硬编码 closeAllOverlays，使所有资源
// 类型（模型 / 动作 / 音频 / 相机 VMD）具备一致的「选中后该干嘛」能力。
export type BrowseOutcome =
    | { mode: 'close' } // 默认：加载即完成，关闭浏览器（一次性绑定 / 加载即完成）
    | { mode: 'stay'; modelId?: string } // 连续预览：加载后保持浏览器打开
    | { mode: 'jumpToDir'; modelId?: string; dir?: string } // 加载后回到指定目录（模型替换，旧 ADR-094 自动跳转）
    | { mode: 'bindLayer'; modelId: string } // 绑定到图层（一次性，关闭）
    | { mode: 'bindMotion'; modelId: string }; // 绑定到动作槽（一次性，关闭）

export type PopupLevel = {
    label: string;
    dir: string;
    items: PopupRow[];
    renderCustom?: (container: HTMLElement) => void | Promise<void>;
    reRenderCustom?: (container: HTMLElement) => void;
    /**
     * [doc:adr-065] 纯 items 层级的语言热刷新：提供 items 重建器。
     * updateControls() 在遍历 _controls 后，若存在则重建 items 并增量 patchPanel。
     * 仅用于「无 registerControl 的纯导航/动作行」层级；含 renderCustom 的层级不会因此重建自定义内容。
     */
    itemBuilder?: () => PopupRow[];
    /** [doc:adr-066] 保留 filter 供视图切换时传递 */
    filter?: (m: LibraryModel) => boolean;
    /**
     * 弹窗标题旁的 headerToggle 开关。
     * 用于替代「弹窗标题 + 内部独立开关」的重复模式。
     */
    headerToggle?: {
        value: boolean;
        onChange: (v: boolean) => void;
        /** 自更新回调，updateControls() 时自动同步 toggle 状态 */
        bind?: () => boolean;
    };
    /**
     * [doc:adr-131] 资源浏览选中结果契约。由浏览入口（buildLevel 第 6 参）声明，
     * activateItem / onModelRowClick 据此派发选中后行为，取代全局绑定标志位反推。
     */
    outcome?: BrowseOutcome;
};

// ======== UI State ========
//
// 前端 UIState — 全字段可选，支持增量 setUIState(partial)。
// Go 端 UIState 是持久化完整结构（必选字段），两者语义不同。
// 下方类型断言测试保证：Go 端新增字段时，TS 编译会报错提醒前端同步更新。

export interface UIState {
    scale?: number;
    popupWidth?: number;
    accent?: string;
    fontFamily?: string;
    animations?: boolean;
    blurBg?: boolean;
    performanceMode?: 'auto' | 'quality' | 'balanced' | 'performance' | 'custom';
    /** 帧率上限（0=不限） */
    fpsLimit?: number;
    /** 垂直同步：开启时按显示器刷新率渲染（默认）；关闭时解除人为限帧。undefined 视为 true */
    vsync?: boolean;
    /** 默认物理开关：新加载的 actor 模型是否默认启用物理模拟（WASM 版）。undefined 视为 true */
    defaultPhysicsEnabled?: boolean;
    /** 渲染分辨率缩放倍数（1=原生，<1 降分辨率提速，>1 超采样更清晰） */
    renderScale?: number;
    /** 鼠标/触控相机灵敏度倍数（1=默认，越大越灵敏） */
    cameraSensitivity?: number;
    /** 反转 Y 轴：垂直拖拽方向取反（ArcRotate 相机）。undefined 视为 false */
    invertYAxis?: boolean;
    /** 默认模型自动缩放：新加载模型按统一目标高度归一化（仅 actor） */
    autoScaleModel?: boolean;
    /** 默认模型自动居中：新加载模型时相机自动对准取景（仅 actor）。undefined 视为 true */
    autoCenterModel?: boolean;
    materialCategoryMap?: Record<string, string>;
    screenshotFormat?: 'image/png' | 'image/jpeg' | 'image/webp';
    screenshotQuality?: number;
    /** 缩略图分辨率（最长边 px），默认 512 */
    thumbnailResolution?: number;
    /** 截图默认保存目录（用户选择后持久化） */
    screenshotDir?: string;
    autoCameraEnabled?: boolean;
    autoCameraBeatsPerSwitch?: number;
    /** 自动检查更新：启动时自动查询 GitHub 最新发布（默认关） */
    autoUpdateEnabled?: boolean;
    /** [doc:adr-066] 资源库视图模式：'list' | 'grid' */
    resourceViewMode?: 'list' | 'grid';
    /** 默认音量 0-1 */
    volume?: number;
    /** 音频偏移（秒） */
    audioOffset?: number;
    /** BPM 量化开关 */
    bpmQuantizeEnabled?: boolean;
    /** 自动加载伴音 */
    autoLoadCompanionAudio?: boolean;
    /** SFX 开关 */
    sfxEnabled?: boolean;
    /** SFX 音量 0-1 */
    sfxVolume?: number;
    /** 脚步声开关 */
    footstepEnabled?: boolean;
    /** 脚步声音量 0-1 */
    footstepVolume?: number;
    /** 音乐循环模式：none=不循环, one=单曲循环, all=列表循环, shuffle=随机播放 */
    audioRepeatMode?: 'none' | 'one' | 'all' | 'shuffle';
    /** 快捷键自定义绑定 */
    keyBindings?: Record<string, { key: string; ctrl?: boolean; shift?: boolean; alt?: boolean }>;
    /** 顶部 HUD：帧率时钟显隐；undefined/null=显示 */
    showFpsClock?: boolean | null;
    /** 顶部 HUD：多线程（MPR/SPR）徽标显隐；undefined/null=显示 */
    showRuntimeBadge?: boolean | null;
}

// [doc:test-strategy] Go↔TS UIState 字段同步哨兵
// Go 端新增字段时，GoUIState 会多出该字段，导致 UIState 无法赋值给 GoUIState，tsc 报错。
// 修复方式：在上方 UIState 中添加对应可选字段。
type _UIStateCoversGo = UIState extends Partial<GoUIState> ? true : false;
const _uiStateCoversGo: _UIStateCoversGo = true;

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
    starsTexture: string;
    envIntensity: number;

    groundVisible: boolean;
    groundType: 'flat' | 'terrain'; // 几何类型：平面 / 程序化地形（原 heightmap）
    groundStyle: 'solid' | 'grid' | 'checker' | 'texture'; // 仅 flat 时有效（外观样式）
    groundDecoStyle: 'none' | 'grid' | 'checker'; // 装饰叠加层，独立于基础色/贴图
    groundColor: [number, number, number];
    groundAlpha: number;
    groundTexture: string;
    groundTextureEnabled: boolean;
    groundTextureScale: number;
    groundTextureRotation: number; // 纹理旋转角度 (0-360)
    groundGridSize: number; // 网格/棋盘格大小 (0.5-5)
    groundLineColor: [number, number, number]; // 网格线颜色 / 棋盘格第二色

    // 地形（heightmap 模式）参数
    groundTerrainHeight: number; // 地形总起伏高度（峰谷差 = 世界单位；网格绕 groundLevel 上下各 ±height/2）
    groundTerrainScale: number; // 噪声频率（越大特征越小越密）
    groundTerrainSeed: number; // 随机种子（同一种子同地形）
    groundTerrainOctaves: number; // FBM 倍频层数（1-8）

    // Phase A: 地面增强
    groundPitch: number; // X 轴旋转（度），默认 0，范围 -45..45（所有模式均支持，地形模式采用坐标变换补偿高度查询）
    groundRoll: number; // Z 轴旋转（度），默认 0，范围 -45..45（所有模式均支持，地形模式采用坐标变换补偿高度查询）
    groundScrollSpeedX: number; // 纹理 X 方向滚动速度，默认 0，范围 -2..2
    groundScrollSpeedZ: number; // 纹理 Z 方向滚动速度，默认 0，范围 -2..2
    groundPattern: 'checker' | 'dots' | 'stripes' | 'radial'; // 程序化图案类型，默认 'checker'

    // Phase B: 地面增强（反射/法线/高程/跟随）
    groundReflectionBlend: number; // 镜面反射混合度，0=无，1=全反射，默认 0
    groundReflectionQuality: 'high' | 'medium' | 'low' | 'off'; // 反射质量，默认 'off'
    groundNormalTexture: string; // 法线贴图路径，默认 ''
    groundNormalStrength: number; // 法线强度，默认 1
    groundElevationColoring: boolean; // 高度图按高程着色开关，默认 false
    groundFollowCamera: boolean; // 网格模式跟随相机，默认 false

    // ADR-114: PBR 材质 + 程序化纹理
    groundPbrEnabled: boolean; // PBR 材质开关，默认 false（回退 StandardMaterial）
    groundProceduralTexture: 'none' | 'wood' | 'marble' | 'concrete'; // 程序化纹理类型，默认 'none'
    groundProceduralSeed: number; // 程序化纹理随机种子，默认 42
    groundProceduralScale: number; // 程序化纹理平铺缩放，默认 1.0
    groundRoughness: number; // 基础粗糙度（PBR 生效时），默认 0.6
    groundMetallic: number; // 金属度（PBR 生效时），默认 0.0
    // ADR-114 Phase 2: 反射模糊 + 法线扭曲
    groundReflectionBlur: number; // 反射模糊强度 0–1（mipmap LOD 偏移），默认 0.0
    groundReflectionDistort: number; // 法线扭曲强度 0–1（bumpTexture 扰动反射方向），默认 0.3
    // ADR-114 Phase 3: 接触阴影（屏幕空间 ray marching 后处理）
    groundContactShadowEnabled: boolean; // 接触阴影开关，默认 false
    groundContactShadowIntensity: number; // 接触阴影强度 0–1，默认 0.5
    groundContactShadowDistance: number; // 光线步进最大距离（视图空间单位），默认 0.5

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
    groundSize: number; // 地面范围（边长，世界单位），所有模式通用
    groundEdgeFade: number; // 边缘淡出：0=硬边（默认），1=最大径向淡出，消除方块硬边

    waterEnabled: boolean;
    waterLevel: number;
    waterFlip: boolean;
    waterColor: [number, number, number];
    waterTransparency: number;
    waterWaveHeight: number; // 全局振幅乘子（P4 升级语义：旧字段保留，向后兼容）
    bigWaveHeight: number; // ADR-115 P4: 大波高度（Gerstner 低频 2 层振幅缩放），默认 1.0
    smallWaveHeight: number; // ADR-115 P4: 小波纹高度（Gerstner 高频 2 层振幅缩放），默认 1.0
    waterSize: number;
    waterAnimSpeed: number;

    planarReflectBlend: number;
    reflectionQuality: 'high' | 'medium' | 'low' | 'off';

    waterFogColor: [number, number, number];
    waterFogDensity: number;
    waterFogOpacityInfluence: number;
    // ADR-115 P3: 地平线淡出 + 天空-水面颜色联动
    waterHorizonFade: number; // 地平线淡出强度，0=关闭（硬边），1=完全淡出，默认 0
    waterSkyColorBlend: number; // 天空-水色联动，0=不联动，1=完全跟随天空，默认 0

    fresnelBias: number;
    fresnelPower: number;
    diffuseStrength: number;
    ambientStrength: number;
    rippleNormalStrength: number;
    rippleGlintStrength: number;
    waterNormalStrength: number; // ADR-115 P1: 高频法线扰动层强度，默认 0.3
    waterGlintStrength: number; // ADR-115 P1: Sun Glitter 闪烁强度，默认 0
    causticIntensity: number;
    causticColor1: [number, number, number];
    causticColor2: [number, number, number];
    causticScrollX: number;
    causticScrollY: number;
    fresnelAlphaInfluence: number;

    underwaterFogDensity: number;
    underwaterChromaticAmount: number;
    underwaterToneIntensity: number;
    underwaterFogMultiplier: number;
    underwaterTintStrength: number;

    cloudsEnabled: boolean;
    debugClouds: boolean;
    cloudCover: number;
    cloudScale: number;
    cloudHeight: number;
    cloudThickness: number;
    cloudVisibility: number;
    cloudGap: number;
    cloudErosion: number;
    cloudWeatherStrength: number;
    cloudBacklight: number; // Phase C: 双瓣 HG 后向瓣混合比 (0=纯前向, 1=纯后向)
    cloudPowder: number; // Phase C: powder 糖粉效应强度 (0=关闭, 2=强)
    cloudQuality: 'standard' | 'high'; // Phase D: blue-noise dither 开关

    mirrorEnabled: boolean;

    fogEnabled: boolean;
    fogMode: 'exp' | 'exp2' | 'linear';
    fogColor: [number, number, number];
    fogDensity: number;
    fogStart: number;
    fogEnd: number;

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

// babylon-mmd 的 IMmdRuntimeBone 接口未声明 worldMatrix 和 updateWorldMatrix，
// 但 WASM 与 JS 运行时在运行时均提供这些成员。
export interface MmdRuntimeBoneExtended extends IMmdRuntimeBone {
    worldMatrix: Float32Array;
    updateWorldMatrix(updateAbsoluteTransform: boolean, updateLocalTransform: boolean): void;
    /** babylon-mmd MmdRuntimeBone 实有：该骨骼挂载的 IK 求解器（无 IK 时为 null） */
    ikSolver: IkSolver | null;
}

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

/**
 * @deprecated ADR-100：单枚举混淆「控制方案」与「运动行为」两条正交轴。
 * 保留为兼容别名（存档 / 旧调用点），新代码请用 {@link CameraControl} × {@link CameraBehavior}。
 * 双写于 `scene/camera/camera.ts`，改动须两处同步。
 */
export type CameraMode = 'orbit' | 'freefly' | 'surround' | 'concert' | 'oneshot' | 'vmd' | 'ar';

/**
 * ADR-100 轴 A — 控制方案：决定相机类 + 输入方式。
 * - `orbit`   : ArcRotateCamera + 指针输入（可拖拽 / 缩放）
 * - `freefly` : UniversalCamera + 键鼠飞行
 * - `ar`      : AR 相机 + 设备传感器
 * 双写于 `scene/camera/camera.ts`。
 */
export type CameraControl = 'orbit' | 'freefly' | 'ar';

/**
 * ADR-100 轴 B — 运动行为：相机如何自动运动，仅当控制轴为 `orbit`(ArcRotate) 时生效。
 * 初版互斥（同一时刻仅一个活动行为）。
 * - `none`      : 纯手动（今 orbit 基座，无内建自转）
 * - `turntable` : 整圈匀速自转（今 surround）
 * - `concert`   : 扫掠 + 上下摆动（今 concert，ADR-070 语义不变）
 * - `beatcut`   : 节拍切镜（今 自动运镜）
 * - `scripted`  : VMD 脚本（今 vmd / oneshot，子态见 {@link ScriptedSubMode}）
 * 双写于 `scene/camera/camera.ts`。
 */
export type CameraBehavior = 'none' | 'turntable' | 'concert' | 'beatcut' | 'scripted';

/**
 * ADR-100 §6.4 — `scripted` 行为的子模式。
 * - `loop`    : VMD 相机脚本随播放循环驱动（今 vmd）
 * - `oneshot` : 加载 VMD 后仅取首帧定格，不随播放推进（今 oneshot）
 */
export type ScriptedSubMode = 'loop' | 'oneshot';

export type LibrarySortMode = 'default' | 'name';

export interface RecentMotion {
    path: string;
    name: string;
    timestamp: number;
}
