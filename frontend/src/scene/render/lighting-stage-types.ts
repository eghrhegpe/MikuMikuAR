// [doc:adr-271] 舞台灯光的状态类型与默认值（纯数据叶子）
// 从 lighting.ts 抽出。原因：lighting.ts → lighting-stage.ts 而 stage 又要从
// lighting.ts 取这三样 → size=4 强连通分量（lighting / stage / shadow / tween）。
// 类型与默认值下移后，stage 直连本叶子，lighting 仍可 re-export 保持对外 API。
// 本文件不得 import 任何 lighting 子系统（它必须是叶子）。

export type StageLightType = 'spot' | 'point' | 'directional';

/**
 * 主光/半球光/阴影的「菜单可绑定视图」（`getLightState()` 的返回形状）。
 * [doc:adr-271] 从 lighting.ts 下移：`menus` 的 `bind: 'light.xxx'` 需要一个纯类型叶来
 * 派生键集合，若指向 551 行的 lighting.ts 会把整条渲染链的类型图拖进每个菜单的检查。
 */
export interface LightState {
    hemiIntensity: number;
    dirIntensity: number;
    dirX: number;
    dirY: number;
    dirZ: number;
    dirColor: [number, number, number];
    hemiColor: [number, number, number];
    groundColor: [number, number, number];
    shadowEnabled: boolean;
    shadowType: 'hard' | 'soft' | 'pcf';
    shadowCascades: number;
    shadowResolution: number;
    shadowBias: number;
}

export interface StageLightState {
    id: string; // 唯一标识
    name: string; // 显示名
    enabled: boolean;
    type: StageLightType; // 灯光类型
    intensity: number;
    color: [number, number, number];
    // SpotLight 专属
    angle: number; // 锥角（弧度）
    exponent: number; // 衰减指数
    // PointLight 专属
    range: number; // 衰减距离
    // 阴影投射
    shadowEnabled: boolean;
    shadowType: 'hard' | 'soft' | 'pcf';
    shadowResolution: number;
    shadowBias: number;
    // 位置
    posX: number;
    posY: number;
    posZ: number;
    // 目标点（spot 用；directional 用其反推方向）
    targetX: number;
    targetY: number;
    targetZ: number;
    // 轨道控制参数（从 posX/Y/Z 实时推导，写回时反算）
    orbitAzimuth: number; // -180~180 度，水平绕 Y 轴
    orbitElevation: number; // -90~90 度，垂直仰角
    orbitDistance: number; // 距原点距离
    // 指示球体缩放/透明度（UI 大统一 — 与模型/道具共享 buildTransformCard）
    indicatorScale: number;
    indicatorOpacity: number;
    // 真实光锥（锥形光柱可视化）
    coneEnabled: boolean;
    coneIntensity: number; // 0-2, default 0.5
    coneLength: number; // 1-50, default 30
    coneSoftness: number; // 0-1, default 0.5
    // [doc:adr-168] 跟随目标（null = 静态模式，向后兼容）
    followTarget: {
        modelId: string;
        boneName: string | null;
        offset: [number, number, number];
        smoothing: number; // 0-1, default 0.15
        moveWithTarget: boolean; // default false
        // P3-fix: 缓存自动匹配的腰骨名，避免 tickStageLightFollow 每帧 find
        // boneName 非 null 时此字段不使用；boneName=null 首次匹配后缓存
        cachedWaistBone: string | null;
    } | null;
}

export function _defaultStageLightState(id: string, name: string): StageLightState {
    return {
        id,
        name,
        enabled: false,
        type: 'spot',
        intensity: 0.8,
        color: [1, 1, 1],
        angle: 0.8,
        exponent: 2,
        range: 50,
        shadowEnabled: false,
        shadowType: 'soft',
        shadowResolution: 1024,
        shadowBias: 0.0001,
        posX: 0,
        posY: 35,
        posZ: 0,
        targetX: 0,
        targetY: 0,
        targetZ: 0,
        orbitAzimuth: 180,
        orbitElevation: 90,
        orbitDistance: 35,
        indicatorScale: 1,
        indicatorOpacity: 1,
        // 光锥默认关闭
        coneEnabled: false,
        coneIntensity: 0.5,
        coneLength: 30,
        coneSoftness: 0.5,
        // [doc:adr-168] 默认静态模式
        followTarget: null, // 注意：创建 followTarget 时须初始化 cachedWaistBone: null
    };
}
