// [doc:architecture] Menu Declarative Schema — ADR-093
// 单一数据源 + 单渲染器，消除命令式 builder 膨胀。
// 当前状态：P0+P1+P2 全量落地（57 面板），P3 类型化增强中。

import { envState } from '@/core/config';
import { setEnvState, getRenderState, setRenderState } from '@/scene/scene';
import { getLightState, setLightState } from '@/scene/render/lighting';
import { uiState, setUIState, focusedModelId, modelRegistry } from '@/core/state';
import {
    getPerceptionState,
    getPerceptionStateFor,
    setPerceptionState,
    setPerceptionStateFor,
} from '@/scene/motion/perception';
import { getModuleDefaultParam, getModuleState, setModuleParam } from '@/scene/motion/motion-modules/registry';

// 状态路径：类型化字符串，由解析器按前缀映射到 reactive state 对象
export type StatePath =
    | `env.${string}`
    | `render.${string}`
    | `light.${string}`
    | `ui.${string}`
    | `perception.${string}`
    | `motionModule.${string}`;

export interface ActionMenuCtx {
    /** 通知 toast */
    toast: (message: string) => void;
    /** 设置状态栏文本 */
    setStatus: (message: string) => void;
    /** 关闭所有覆盖层 */
    closeAllOverlays: () => void;
}

export type MenuKind =
    | 'folder'
    | 'slider'
    | 'colorSlider'
    | 'toggle'
    | 'modeSlider'
    | 'modeRow'
    | 'sectionTitle'
    | 'action'
    | 'divider'
    | 'custom';

export interface ControlSpec {
    bind: StatePath;
    min?: number;
    max?: number;
    step?: number;
    icon?: string;
    options?: Array<{ value: string; label: string }>; // modeSlider 用
    /** 衍生控件：从状态值转控件显示值（如 windDirection→角度，或 frameCapEnabled 默认值→boolean） */
    get?: (v: unknown) => unknown;
    /** 衍生控件：从控件值转状态值（如 角度→[sin,y,cos]，或 boolean→状态值） */
    set?: (v: unknown) => unknown;
    /** 控件值变更后的副作用（如 reflectionQuality 变化后重建水体） */
    onChange?: (v: unknown) => void;
}

export interface MenuNode {
    id: string;
    kind: MenuKind;
    label?: string; // i18n key，folder/divider 不需要
    icon?: string;
    defaultOpen?: boolean; // 仅 folder
    headerToggle?: {
        bind: StatePath;
        /** 将状态值转为 boolean（如 groundType='terrain'→true） */
        get?: (v: unknown) => boolean;
        /** 将 toggle boolean 转为状态值（如 true→'terrain'） */
        set?: (v: boolean) => unknown;
        /** 切换后的额外回调（如 activatePerception + triggerAutoSave） */
        onChange?: (v: unknown) => void;
    };
    children?: MenuNode[]; // 仅 folder
    control?: ControlSpec; // slider/colorSlider/toggle
    /** 逃生舱：无法数据化的内容直接渲染。返回值（可选）为 dispose 函数，由 renderMenu 收集并级联释放 */
    renderCustom?: (container: HTMLElement) => (() => void) | void;
    /** 条件守卫：返回 false 时该节点不渲染（如 groundType !== 'terrain' 时隐藏 pitch/roll） */
    visibleWhen?: () => boolean;
    /** action 类型节点的回调（含 toast/setStatus/closeOverlays 上下文） */
    action?: (ctx: ActionMenuCtx) => void | Promise<void>;
    /** [doc:adr-163] 冲突提示：对应感知层/模块层 moduleId，渲染时若该模块骨骼被抢占则显示警告图标 */
    conflictHint?: string;
    /** [doc:adr-166] 模型 ID 覆写：感知层 path 时优先读/写指定模型的 ctx.state，而非焦点模型 */
    modelId?: string;
    /** [fix:P2] 查看的动作 id：motionModule path 时读写指定动作的模块配置，缺省回退激活动作 */
    actionId?: string;
}

// ======== 状态路径解析器 ========

/** 按 StatePath 获取当前值 */
export function getStateValue(path: StatePath, modelId?: string, actionId?: string): unknown {
    const [prefix, key] = path.split('.') as [string, string];
    switch (prefix) {
        case 'env':
            return (envState as unknown as Record<string, unknown>)[key];
        case 'render':
            return (getRenderState() as unknown as Record<string, unknown>)[key];
        case 'light':
            return (getLightState() as unknown as Record<string, unknown>)[key];
        case 'ui':
            return (uiState as unknown as Record<string, unknown>)[key];
        case 'perception': {
            const mid = modelId ?? focusedModelId;
            return (
                (mid ? getPerceptionStateFor(mid) : getPerceptionState()) as unknown as Record<
                    string,
                    unknown
                >
            )[key];
        }
        case 'motionModule': {
            // 格式: motionModule.${moduleId}.${paramKey}
            // 注: 解构只取前两段，需从 path 重新解析剩余部分以支持 moduleId.paramKey 结构
            const rest = path.slice('motionModule.'.length);
            const dotIdx = rest.indexOf('.');
            if (dotIdx === -1) {
                return undefined;
            }
            const moduleId = rest.substring(0, dotIdx);
            const paramKey = rest.substring(dotIdx + 1);
            const mid = modelId ?? focusedModelId;
            if (!mid) {
                return undefined;
            }
            // [fix:P2] 改走 registry 单源（intent.motionModules + actionId）：
            // 此前读 inst.motionOverrideModules（per-model 旧源），与 registry 实际生效的
            // per-motion 新源脱节 → 滑块显示值 ≠ 生效值。缺省 actionId 回退激活动作。
            const modState = getModuleState(mid, moduleId, actionId);
            const v = modState.params[paramKey];
            // [doc:adr-116] 未 seed 时回退到模块注册默认值，避免滑块显示成负值 min（Q2 修复）
            if (v === undefined) {
                return getModuleDefaultParam(moduleId, paramKey);
            }
            return v;
        }
        default:
            return undefined;
    }
}

/** 按 StatePath 设置值 */
export function setStateValue(
    path: StatePath,
    value: unknown,
    modelId?: string,
    actionId?: string
): void {
    const [prefix, key] = path.split('.') as [string, string];
    switch (prefix) {
        case 'env':
            setEnvState({ [key]: value });
            break;
        case 'light':
            setLightState({ [key]: value });
            break;
        case 'render':
            setRenderState({ [key]: value });
            break;
        case 'ui':
            setUIState({ [key]: value });
            break;
        case 'perception': {
            const mid = modelId ?? focusedModelId;
            if (mid) {
                setPerceptionStateFor(mid, { [key]: value });
            } else {
                setPerceptionState({ [key]: value });
            }
            break;
        }
        case 'motionModule': {
            // 格式: motionModule.${moduleId}.${paramKey}
            // 注: 解构只取前两段，需从 path 重新解析剩余部分
            const rest = path.slice('motionModule.'.length);
            const dotIdx = rest.indexOf('.');
            if (dotIdx === -1) {
                return;
            }
            const moduleId = rest.substring(0, dotIdx);
            const paramKey = rest.substring(dotIdx + 1);
            const mid = modelId ?? focusedModelId;
            if (!mid) {
                return;
            }
            // [fix:P2] 改走 registry 单源（intent.motionModules + actionId）：
            // 此前写 inst.motionOverrideModules（per-model 旧源），与 registry 生效源脱节。
            setModuleParam(mid, moduleId, paramKey, value as number | boolean, actionId);
            break;
        }
    }
}

/** 按 StatePath 获取 bind 函数（用于 registerControl 自更新） */
export function getBindFn(path: StatePath): () => unknown {
    return () => getStateValue(path);
}

// [doc:adr-238] E2E 状态读取器注入：core/dev-hooks 的 window.__state 钩子经
// core/e2e-state-bridge 获取 getStateValue（零依赖叶，不拖 scene 链），
// 本模块不再被 core 静态 import（切断 core→menus 反向边）。模块加载即注册。
import { setE2EStateReader } from '../core/e2e-state-bridge';
setE2EStateReader((path: string, modelId?: string): unknown =>
    getStateValue(path as StatePath, modelId)
);
