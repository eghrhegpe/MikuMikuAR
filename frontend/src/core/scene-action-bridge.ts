// scene-action-bridge.ts — [doc:adr-238] 场景动作注入桥（纯叶子，零依赖）。
// 切断 core/action-defs → scene/* 反向依赖：
//   - scene 侧（scene/actions-init.ts）启动时注册场景基础操作
//   - core/action-defs 的 execute 闭包经本桥调用，不静态 import scene
// 与 ui-action-bridge 同模式：core 持注入点，scene 层注册，方向单向。
// 分字段注册（registerSceneAction），支持各场景模块独立注册。

export interface SceneActions {
    /** 灯光状态写入（control 动作 light:*） */
    setLightState: (partial: Record<string, unknown>) => boolean;
    /** 相机模式切换（control 动作 camera:mode） */
    setCameraMode: (mode: string) => void;
    /** 环境预设应用（control 动作 env:preset） */
    applyEnvPreset: (preset: string) => boolean;
    /** 模型替换（control 动作 model:load） */
    replaceModel: (model: unknown) => void | Promise<void>;
    /** 动作替换（control 动作 motion:load） */
    replaceMotion: (model: unknown) => void | Promise<void>;
    /** 按名称查找库模型（entity resolve） */
    findLibraryModelByName: (name: string) => unknown | Promise<unknown>;
    /** 按名称查找库动作（entity resolve） */
    findLibraryMotionByName: (name: string) => unknown | Promise<unknown>;
    /** 读取环境状态（toggleGround 判定） */
    getEnvGroundVisible: () => boolean;
    /** 弹出撤销快照（scene 动作） */
    popUndoSnapshot: () => unknown;
    /** 恢复撤销快照（scene 动作） */
    restoreUndoSnapshot: (snap: unknown) => Promise<boolean>;
    /** 获取全部已加载模型（scene 动作 list-models） */
    listModels: () => { id: string; name: string }[];
    /** 唇形同步开关（motion 动作） */
    setLipSyncEnabled: (enabled: boolean) => void;
    /** 读取唇形同步状态（motion 动作） */
    getLipSyncState: () => { enabled: boolean };
    /** 清空全部场景动作（motion 动作） */
    clearAllSceneMotions: () => void;
    /** 添加场景动作（motion 动作） */
    addSceneMotion: (opts: Record<string, unknown>) => void;
    /** 替换默认动作（motion 动作） */
    replaceDefaultMotion: (opts: Record<string, unknown>) => void;
    /** 推送撤销快照（motion 动作） */
    pushUndoSnapshot: () => unknown;
    /** 场景撤销后刷新（motion 动作） */
    offerSceneUndoAndRefresh: (
        label: string,
        snap: unknown,
        afterApply?: () => void
    ) => void;
    /** 更新播放 UI（motion 动作） */
    updatePlaybackUI: () => void;
    /** 设置程序化动作模式（motion 动作） */
    setProcMotionMode: (mode: string) => void;
    /** 重新生成程序化动作（motion 动作） */
    regenerateProcMotion: () => void;
    /** 加载 VPD 姿势（motion 动作） */
    loadVPDPose: (path: string) => void;
    /** 读取音频名（motion 动作） */
    getAudioName: () => string;
    /** 按名称模糊搜索场景内模型（entity resolve） */
    findSceneModelByName: (name: string) => Promise<unknown>;
    /** 设置模型编队（library 动作） */
    setModelFormation: (formation: string) => void;
    /** 刷新模型库（library 动作），由 menus/library-setup 注册 */
    refreshLibrary: () => Promise<void> | void;
    /** 导入文件（library 动作），由 menus/library-actions 注册 */
    importFile: () => void;
    /** 自动应用模型预设（scene 初始化回调），由 menus/model-preset 注册 */
    tryAutoApplyPreset: (id: string) => Promise<void>;
    /** 初始化模型库（core/init 启动调用），由 menus/library-setup 注册 */
    initLibrary: () => Promise<void>;
    /** AR 是否激活（perception-gaze 查询），由 scene/ar/ar-camera 注册 */
    isARActive: () => boolean;
    /** 音频是否播放中（scene/motion 查询），由 outfit/audio 注册 */
    isAudioPlaying: () => boolean;
    /** 读取音频路径（scene/motion 查询），由 outfit/audio 注册 */
    getAudioPath: () => string;
    /** 同步音频播放（scene/motion 调用），由 outfit/audio 注册 */
    syncAudioPlayback: (vmdTime: number, isPlaying: boolean, vmdDuration: number) => void;
    /** 加载音频文件（scene/motion 调用），由 outfit/audio 注册 */
    loadAudioFile: (filePath: string) => Promise<void>;
    /** 动画相机 VMD（scene/motion 调用），由 scene/camera 注册 */
    animateCameraVmd: (frameTime: number) => void;
    /** 加载相机 VMD（scene/motion 调用），由 scene/camera 注册 */
    loadCameraVmd: (mmdAnimation: unknown, vmdPath: string, vmdName: string) => void;
    /** 从事件 seek（events 调用），由 scene 注册 */
    seekFromEvent: (e: unknown) => void;
    /** 当前焦点 MMD 模型（events/快捷键 调用），由 scene 注册 */
    focusedMmdModel: () => unknown;
    /** 读取相机模式（events 调用），由 scene/camera 注册 */
    getCameraMode: () => string;
    /** 焦点模型读取（快捷键调用），由 scene/manager/model-ops 注册 */
    focusedModel: () => unknown;
    /** 动作历史撤销（快捷键调用），由 scene/motion/motion-history 注册 */
    undo: (modelId: string, applySnapshot: (snap: unknown) => void) => boolean;
    /** 动作历史重做（快捷键调用），由 scene/motion/motion-history 注册 */
    redo: (modelId: string, applySnapshot: (snap: unknown) => void) => boolean;
    /** 可否撤销（快捷键调用），由 scene/motion/motion-history 注册 */
    canUndo: (modelId: string) => boolean;
    /** 可否重做（快捷键调用），由 scene/motion/motion-history 注册 */
    canRedo: (modelId: string) => boolean;
    /** 应用模块快照（快捷键调用），由 scene/motion/module-base 注册 */
    applyModuleSnapshot: (moduleId: string, snap: unknown) => void;
    /** 初始化场景（core/init 启动调用），由 scene 注册 */
    initScene: () => Promise<void>;
    /** 尝试恢复上次场景（core/init 调用），由 scene 注册 */
    tryRestoreLastScene: () => Promise<void>;
    /** 设置环境状态（core/init 调用），由 scene/env 注册 */
    setEnvState: (partial: Record<string, unknown>, skipAutoSave?: boolean) => void;
    /** 设置抑制自动保存（core/init 调用），由 scene 注册 */
    setSuppressAutoSave: (suppress: boolean) => void;
    /** 取消环境持久化计时器（core/init 调用），由 scene 注册 */
    cancelEnvPersistTimer: () => void;
    /** 设置性能模式（core/init 调用），由 scene/render 注册 */
    setPerformanceMode: (mode: string) => void;
    /** 恢复自动相机状态（core/init 调用），由 scene/camera 注册 */
    restoreAutoCameraState: () => void;
    /** 从环境同步时段（core/init 调用），由 scene/env 注册 */
    syncTimeOfDayFromEnv: () => void;
    /** 立即保存场景（core/init 调用），由 scene 注册 */
    saveSceneImmediate: () => Promise<void>;
    /** 切换 AR 模式（scene/camera 调用），由 scene/ar 注册 */
    setARMode: (enabled: boolean) => Promise<boolean>;
    /** 释放换装 overlay（scene/manager 调用），由 outfit 注册 */
    disposeOverlay: (inst: unknown) => void;
    /** 恢复原始材质（scene/manager 调用），由 outfit 注册 */
    restoreMaterials: (inst: unknown) => void;
    /** 释放音频（scene/manager 调用），由 outfit 注册 */
    disposeAudio: () => void;
    /** 读取活跃动作（model-loader 调用），由 scene/motion 注册 */
    getActiveMotion: () => unknown;
    /** 读取场景动作列表（model-loader 调用），由 scene/motion 注册 */
    getSceneMotions: () => unknown[];
    /** 读取动作生成器（model-loader 调用），由 scene/motion 注册 */
    getMotionGen: () => number;
    /** 解析动作兼容性（model-loader 调用），由 scene/motion 注册 */
    resolveCompatibility: (bones: unknown, motion: unknown) => { compatible?: boolean };
    /** 读取骨骼覆写类型（model-manager 调用），由 scene/motion 注册 */
    getOverrideType: (boneName: string, modelId?: string) => unknown;
    /** 挂载节拍检测器（scene 初始化调用），由 outfit/audio 注册 */
    attachBeatDetector: (detector: unknown) => void;
    /** 读取流式播放器（scene 调用），由 outfit/audio 注册 */
    getStreamPlayer: () => unknown;
    /** 加载换装（scene 初始化调用），由 outfit/outfit 注册 */
    loadOutfits: (id: string) => Promise<void>;
    /** 应用换装变体（scene-serialize 调用），由 outfit/outfit 注册 */
    applyOutfitVariant: (id: string, variantName: string) => Promise<void>;
    /** 设置音量（scene-serialize 调用），由 outfit/audio 注册 */
    setVolume: (v: number) => void;
    /** 读取音量（scene-serialize 调用），由 outfit/audio 注册 */
    getVolume: () => number;
    /** 读取音频偏移（scene-serialize 调用），由 outfit/audio 注册 */
    getAudioOffset: () => number;
    /** 设置音频偏移（scene-serialize 调用），由 outfit/audio 注册 */
    setAudioOffset: (v: number) => void;
    /** 恢复音频（scene-serialize 调用），由 outfit/audio 注册 */
    resumeAudio: () => void;
}

const _sceneActions = new Map<keyof SceneActions, unknown>();

/** 注册单个场景操作（scene 侧启动时调用） */
export function registerSceneAction<K extends keyof SceneActions>(
    key: K,
    fn: SceneActions[K]
): void {
    _sceneActions.set(key, fn);
}

/** 读取单个场景操作（core/action-defs 侧调用；未注册返回 undefined） */
export function getSceneAction<K extends keyof SceneActions>(
    key: K
): SceneActions[K] | undefined {
    return _sceneActions.get(key) as SceneActions[K] | undefined;
}
