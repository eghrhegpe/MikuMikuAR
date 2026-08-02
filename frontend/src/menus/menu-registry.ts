// [doc:architecture] Menu Schema Registry — ADR-093 元测试基础设施
// 收集各面板的 MenuNode[] schema，供 menu-schema.integrity.test.ts 做静态分析。
// 注册是自愿的：各 *-levels.ts 提取 getXxxSchema() 后在此注册。

import type { MenuNode } from './menu-schema';

/**
 * 面板导航元数据（ADR-229 §2.1）。
 * 常规 env/motion 面板由快照生成器默认推导（零声明）；
 * 仅特例（跨域挂载 / settings 二级 folder）在注册处显式覆写。
 */
export interface PanelNav {
    /** 导航域：env/motion/settings/scene。特例覆写用（如 scene:postprocess-* 实际挂 env 域） */
    domain?: 'env' | 'motion' | 'settings' | 'scene';
    /** 入口按钮 testid，由 deriveNav 从 domain 映射表推导 */
    entryTestId?: string;
    /** 一级子面板 testid，如 folder:env:postprocess */
    subLevelTestId?: string;
    /** settings 域二级 folder testid，如 folder:settings:controls */
    subLevel2TestId?: string;
    /** 可读中文标签（仅元数据，不参与定位） */
    subLevelLabel?: string;
}

export interface RegisteredSchema {
    panelId: string;
    nodes: MenuNode[];
    nav?: PanelNav;
}

type RegistryEntry = { builder: () => MenuNode[]; nav?: PanelNav };

const registry = new Map<string, RegistryEntry>();

/** 注册一个面板的 schema 构建函数（nav 可选，特例面板覆写导航元数据） */
export function registerSchema(
    panelId: string,
    builder: () => MenuNode[],
    nav?: PanelNav
): void {
    if (registry.has(panelId)) {
        if (import.meta.env.DEV) {
            console.warn(`[menu-registry] panelId "${panelId}" 已注册，覆盖`);
        }
    }
    registry.set(panelId, { builder, nav });
}

/** 收集所有已注册 schema，执行 builder 返回快照 */
export function collectAllSchemas(): RegisteredSchema[] {
    const result: RegisteredSchema[] = [];
    for (const [panelId, entry] of registry) {
        try {
            result.push({ panelId, nodes: entry.builder(), nav: entry.nav });
        } catch (e) {
            // builder 可能依赖运行时状态（envState 等），失败时跳过
            if (import.meta.env.DEV) {
                console.warn(`[menu-registry] panelId "${panelId}" builder 失败:`, e);
            }
        }
    }
    return result;
}

/** 递归展开 schema 树（含 children），返回扁平节点列表 */
export function flattenNodes(nodes: MenuNode[]): MenuNode[] {
    const result: MenuNode[] = [];
    function walk(list: MenuNode[]): void {
        for (const node of list) {
            result.push(node);
            if (node.children) {
                walk(node.children);
            }
        }
    }
    walk(nodes);
    return result;
}

/** 清空注册表（仅测试用） */
export function _clearRegistry(): void {
    registry.clear();
}
