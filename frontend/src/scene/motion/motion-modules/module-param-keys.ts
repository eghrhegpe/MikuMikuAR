// module-param-keys.ts — 动作模块参数键的类型声明（纯类型叶：零运行时依赖、零 import）。
// [doc:adr-272] 为什么这一层必须存在：
//   bind: `motionModule.${MODULE_ID}.tilt` —— 在 TS 眼里会退化成 `string`（模块 id 是 const 字面量、
//   参数键是裸字面量，但拼接结果被 StatePath 的 `motionModule.${string}` 兜住）。于是模块 id 拼错、
//   参数键改名，只有拖到滑块没反应时才暴露，tsc / vitest / check:coupling 三方静默。
//   这里把 6 个模块 id 与各自参数键声明成字面量联合，StatePath 由它分布展开，
//   24 处 bind 的排版错误从此是 TS2820。
//
// 这不是第四份镜像——它被双向钉在运行时真源 DEFAULTS 上：
//   各模块的 DEFAULTS 用 `satisfies Record<XxxParamKey, ParamValue>` 校验，
//   多一个键（无默认值 → 运行时 undefined）或少一个键（菜单 bind 到不存在的参数）都编译失败。
//
// 方向：本叶（类型声明） ← 各模块（satisfies 反向校验） → menu-node-types（StatePath 分布展开）。

export type BodyPostureParamKey = 'tilt' | 'bend' | 'twist' | 'bodyHeight' | 'bodyDepth';

export type RidingModelParamKey =
    'preset' | 'saddleHeight' | 'pedalAngle' | 'autoPedal' | 'pedalSpeed';

/** 左右手共用同一套参数键（工厂函数按 side 生成，moduleId 是唯一的变量） */
export type HandModuleId = 'left-hand' | 'right-hand';
/** 左右足同上 */
export type FootModuleId = 'left-foot' | 'right-foot';

export type HandParamKey =
    | 'pitch'
    | 'yaw'
    | 'roll'
    | 'handPosX'
    | 'handPosY'
    | 'handPosZ'
    | 'fingerPreset'
    | 'fingerIntensity';

export type FootParamKey = 'pitch' | 'yaw' | 'roll' | 'footPosX' | 'footPosY' | 'footPosZ';

/** 模块 id → 参数键。新增动作模块必须在此登记，否则该模块的 bind 编译不过（漏登记即报错，不静默）。 */
export interface MotionModuleParamKeys {
    'body-posture': BodyPostureParamKey;
    'riding-model': RidingModelParamKey;
    'left-hand': HandParamKey;
    'right-hand': HandParamKey;
    'left-foot': FootParamKey;
    'right-foot': FootParamKey;
}

export type MotionModuleId = keyof MotionModuleParamKeys;

/**
 * 全部合法的 `motionModule.<moduleId>.<paramKey>` 路径。
 * 分布展开（而非 `${MotionModuleId}.${AllParamKeys}` 的笛卡尔积）：
 * 错配组合如 `motionModule.riding-model.handPosX` 不会混进合法集合。
 */
export type MotionModuleStatePath = {
    [K in MotionModuleId]: `motionModule.${K}.${MotionModuleParamKeys[K]}`;
}[MotionModuleId];
