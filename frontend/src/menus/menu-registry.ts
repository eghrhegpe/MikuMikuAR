// [doc:architecture] Menu Schema Registry — ADR-093 元测试基础设施
// 收集各面板的 MenuNode[] schema，供 menu-schema.integrity.test.ts 做静态分析。
// 注册是自愿的：各 *-levels.ts 提取 getXxxSchema() 后在此注册。

import type { MenuNode } from './menu-schema';

export interface RegisteredSchema {
    panelId: string;
    nodes: MenuNode[];
}

const registry = new Map<string, () => MenuNode[]>();

/** 注册一个面板的 schema 构建函数 */
export function registerSchema(panelId: string, builder: () => MenuNode[]): void {
    if (registry.has(panelId)) {
        if (import.meta.env.DEV) {
            console.warn(`[menu-registry] panelId "${panelId}" 已注册，覆盖`);
        }
    }
    registry.set(panelId, builder);
}

/** 收集所有已注册 schema，执行 builder 返回快照 */
export function collectAllSchemas(): RegisteredSchema[] {
    const result: RegisteredSchema[] = [];
    for (const [panelId, builder] of registry) {
        try {
            result.push({ panelId, nodes: builder() });
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
