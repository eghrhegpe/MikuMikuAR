// [doc:architecture] Menu Declarative Schema — ADR-093
// 单一数据源 + 单渲染器，消除命令式 builder 膨胀。
// 当前状态：PoC，仅地面面板「基础设置」试点。

import { envState } from '@/core/config';
import { setEnvState, getRenderState, setRenderState } from '@/scene/scene';
import { getLightState, setLightState } from '@/scene/render/lighting';
import { uiState, setUIState, focusedModelId, modelRegistry } from '@/core/state';
import { getPerceptionState, setPerceptionState } from '@/scene/motion/perception';

// 状态路径：类型化字符串，由解析器按前缀映射到 reactive state 对象
export type StatePath =
    | `env.${string}`
    | `render.${string}`
    | `light.${string}`
    | `ui.${string}`
    | `perception.${string}`
    | `motionModule.${string}`;

export type MenuKind =
    | 'folder'
    | 'slider'
    | 'colorSlider'
    | 'toggle'
    | 'modeSlider'
    | 'modeRow'
    | 'sectionTitle'
    | 'divider'
    | 'custom';

export interface ControlSpec {
    bind: StatePath;
    min?: number;
    max?: number;
    step?: number;
    icon?: string;
    options?: Array<{ value: string; label: string }>; // modeSlider 用
    /** 衍生控件：从状态值转控件显示值（如 windDirection→角度，或 vsync 默认值→boolean） */
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
}

// ======== 状态路径解析器 ========

/** 按 StatePath 获取当前值 */
export function getStateValue(path: StatePath): unknown {
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
        case 'perception':
            return (getPerceptionState() as unknown as Record<string, unknown>)[key];
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
            const mid = focusedModelId;
            if (!mid) {
                return undefined;
            }
            const inst = modelRegistry.get(mid);
            const modState = inst?.motionOverrideModules?.find((m) => m.id === moduleId);
            return modState?.params[paramKey];
        }
        default:
            return undefined;
    }
}

/** 按 StatePath 设置值 */
export function setStateValue(path: StatePath, value: unknown): void {
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
        case 'perception':
            setPerceptionState({ [key]: value });
            break;
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
            const mid = focusedModelId;
            if (!mid) {
                return;
            }
            const inst = modelRegistry.get(mid);
            if (!inst) {
                return;
            }
            if (!inst.motionOverrideModules) {
                inst.motionOverrideModules = [];
            }
            let modState = inst.motionOverrideModules.find((m) => m.id === moduleId);
            if (!modState) {
                modState = { id: moduleId, enabled: false, params: {} };
                inst.motionOverrideModules.push(modState);
            }
            modState.params[paramKey] = value as number | boolean;
            break;
        }
    }
}

/** 按 StatePath 获取 bind 函数（用于 registerControl 自更新） */
export function getBindFn(path: StatePath): () => unknown {
    return () => getStateValue(path);
}
