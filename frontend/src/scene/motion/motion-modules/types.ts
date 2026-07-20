// [doc:adr-116] Motion Override Module — 模块层接口定义
// 职责: 声明 MotionOverrideModule 接口，模块层通过实现此接口将语义参数烘焙为骨骼覆盖
// 复用 ADR-093 MenuNode schema，UI 由 renderMenu 自动渲染

import type { MenuNode } from '@/menus/menu-schema';
import type { MotionModuleState, ParamValue } from '@/core/types';

/** 模块元信息 */
export interface ModuleMeta {
    labelKey: string;
    icon?: string;
    advanced?: boolean;
    /** 模块参数的默认值，注册时传入。getModuleState 新建状态时会种入 params，
     *  确保 schema 渲染首次读取即有确定值（避免 undefined 流入 addSliderRow 崩溃）。 */
    defaults?: Record<string, ParamValue>;
}

/**
 * [doc:adr-116] 动作覆盖模块接口
 *
 * 模块是无状态转换器的壳：状态存储在 ModelInstance.motionOverrideModules 中，
 * 模块实例负责「语义参数 → setBoneOverride」的烘焙转换。
 */
export interface MotionOverrideModule {
    readonly id: string;
    readonly meta: ModuleMeta;
    /** 优先级（1=最高，用于冲突仲裁） */
    readonly priority: number;
    /** 该模块管理的骨骼列表（静态，用于 disable 时精确清除） */
    readonly managedBones: string[];

    /** 返回该模块的 MenuNode[] schema，由 renderMenu 自动渲染参数 UI */
    buildSchema(): MenuNode[];
    /** 读取当前语义参数（含默认值兜底） */
    getState(): MotionModuleState;
    /** 整体恢复（反序列化用） */
    setState(s: MotionModuleState): void;
    /** 单参数变更：重新烘焙到引擎 + 写回 state */
    setParam(name: string, value: ParamValue): void;
    /** 启用模块：烘焙所有参数到引擎 */
    enable(): void;
    /** 禁用模块：清除 managedBones 的覆盖 */
    disable(): void;
}

/** 模块工厂函数：接受 modelId，返回绑定到该模型的模块实例 */
export type ModuleFactory = (modelId: string) => MotionOverrideModule;

/** 模块注册定义（工厂 + 元信息 + 优先级），用于 BUILTIN_MODULE_DEFS 批量注册 */
export interface ModuleDef {
    id: string;
    meta: ModuleMeta;
    priority: number;
    factory: ModuleFactory;
}
