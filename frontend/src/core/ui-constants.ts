// [adr-143] 主题 7：UI 与场景常量收敛
// 集中定义滑块四分位步进分数、环境默认值、场景事件字面量，消除魔法数值

// ======== 滑块四分位步进分数 ========

/** 左区大幅减步进：全范围 15% */
export const SLIDER_QUARTER_LARGE_STEP = 0.15;
/** 中左/中右微调步进：全范围 5% */
export const SLIDER_QUARTER_SMALL_STEP = 0.05;

// ======== 场景默认值 ========

/** 默认重力（m/s²） */
export const DEFAULT_GRAVITY = -98;
/** 环境光强度上限 */
export const ENV_LIGHT_MAX = 0.5;
/** time-of-day 与 lighting 联动判定阈值（度） */
export const AUTO_LINK_THRESHOLD_DEG = 0.5;

// ======== 场景事件枚举 ========

/** 场景级事件字面量。使用此枚举替代散落的 'scene:xxx' 字面量。 */
export const SCENE_EVENTS = {
    /** 场景保存事件 */
    SAVE: 'scene:save',
    /** 场景重加载事件 */
    RELOAD: 'scene:reload',
    /** 场景重置事件 */
    RESET: 'scene:reset',
    /** 场景切换事件 */
    SWITCH: 'scene:switch',
} as const;

/** SCENE_EVENTS 各取值的联合类型 */
export type SceneEventKey = typeof SCENE_EVENTS[keyof typeof SCENE_EVENTS];
