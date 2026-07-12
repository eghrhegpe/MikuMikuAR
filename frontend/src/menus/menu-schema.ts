// [doc:architecture] Menu Declarative Schema — ADR-093
// 单一数据源 + 单渲染器，消除命令式 builder 膨胀。
// 当前状态：PoC，仅地面面板「基础设置」试点。

import type { EnvState } from '@/core/config';
import { envState, setEnvState } from '@/core/config';
import { getRenderState } from '@/scene/scene';

// 状态路径：类型化字符串，由解析器按前缀映射到 reactive state 对象
export type StatePath = `env.${string}` | `render.${string}`;

export type MenuKind = 'folder' | 'slider' | 'colorSlider' | 'toggle' | 'divider';

export interface ControlSpec {
    bind: StatePath;
    min?: number;
    max?: number;
    step?: number;
    icon?: string;
}

export interface MenuNode {
    id: string;
    kind: MenuKind;
    label?: string;         // i18n key，folder/divider 不需要
    icon?: string;
    defaultOpen?: boolean;  // 仅 folder
    headerToggle?: {
        bind: StatePath;
    };
    children?: MenuNode[];  // 仅 folder
    control?: ControlSpec;  // slider/colorSlider/toggle
}

// ======== 状态路径解析器 ========

/** 按 StatePath 获取当前值 */
export function getStateValue(path: StatePath): unknown {
    const [prefix, key] = path.split('.') as [string, string];
    switch (prefix) {
        case 'env':
            return (envState as Record<string, unknown>)[key];
        case 'render':
            return (getRenderState() as Record<string, unknown>)[key];
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
    }
}

/** 按 StatePath 获取 bind 函数（用于 registerControl 自更新） */
export function getBindFn(path: StatePath): () => unknown {
    return () => getStateValue(path);
}