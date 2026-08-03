// scene-action-bridge.ts — [doc:adr-238] 场景动作注入桥（纯叶子，零依赖）。
// 切断 core/action-defs → scene/* 反向依赖：
//   - scene 侧（scene/actions-init.ts）启动时注册场景基础操作
//   - core/action-defs 的 execute 闭包经本桥调用，不静态 import scene
// 与 ui-action-bridge 同模式：core 持注入点，scene 层注册，方向单向。
// 分字段注册（registerSceneAction），支持各场景模块独立注册。

export interface SceneActions {
    /** 更新环境状态（env-actions 的 bind-* 纹理绑定） */
    setEnvState: (partial: Record<string, unknown>) => void;
    /** 灯光状态写入（control 动作 light:*） */
    setLightState: (partial: Record<string, unknown>) => boolean;
    /** 相机模式切换（control 动作 camera:mode） */
    setCameraMode: (mode: string) => void;
    /** 环境预设应用（control 动作 env:preset） */
    applyEnvPreset: (preset: string) => boolean;
    /** 性能模式切换（control 动作 render:performance） */
    setPerformanceMode: (mode: string) => void;
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
