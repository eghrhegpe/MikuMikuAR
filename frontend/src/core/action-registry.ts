// action-registry.ts — ADR-197 统一动作注册表
// 纯叶子模块，零依赖。所有功能型动作（settings/scene/motion/env/library）统一定义于此，
// 供菜单渲染、NL catalog（ADR-155）、快捷键、E2E testid 共享同一真相源。

export type ParamType = 'string' | 'enum' | 'color' | 'range' | 'entity' | 'boolean' | 'toggle';

export interface ParamDef {
    name: string;
    type: ParamType;
    /** enum 类型：代码侧合法值数组 */
    enum?: readonly string[];
    /** NL 同义词映射（可选，供 ADR-155 param-adapters 消费） */
    synonyms?: Record<string, string>;
    /** range 类型：数值范围 */
    min?: number;
    max?: number;
    step?: number;
    /** entity 类型：按名称解析为实体对象（如 LibraryModel） */
    resolve?: (name: string) => Promise<unknown>;
}

export interface ActionDef {
    /** 命名空间化 ID，如 'light:dirIntensity' */
    id: string;
    /**
     * 显示文本。推荐填 i18n key（如 'ai.actions.control.setLightIntensity'），
     * 消费端（action-catalog 发给 LLM 的 description、pending 卡 UI、撤销 hint）均过 t()。
     * 过渡期兼容：未迁移的硬编码中文仍可用（t() 对非 key 字符串回退返回原文），
     * 但新增动作应统一使用 ai.actions.<domain>.<name> 命名的 i18n key。
     */
    label: string;
    /** 所属域 */
    domain: 'settings' | 'scene' | 'motion' | 'env' | 'library';
    /** 显示图标（lucide 名） */
    icon?: string;
    /** 参数定义，无参动作为空数组 */
    params: ParamDef[];
    /** 执行函数。注意：destructive 动作的确认 UI 由调用方自行处理。
     *  可返回可选数据对象（{data?: unknown}），供只读工具传递结构化结果。 */
    execute: (params: Record<string, unknown>) => void | Promise<void> | { data?: unknown } | Promise<{ data?: unknown }>;
    /** 是否为破坏性操作（清除/删除等），由调用方决定是否 showConfirm */
    destructive?: boolean;
    /** 只读操作（读取状态/日志/快照），自动执行跳过 pending 确认队列（ADR-205） */
    readonly?: boolean;
}

/** 注册表内部存储 */
const registry = new Map<string, ActionDef>();

/** 严格模式开关（测试/开发用）——重复 id 抛 Error */
let strictMode = false;

/**
 * 注册一条动作。遇重复 id 时 console.warn + 覆盖（默认）。
 * 返回值：unregister 函数，供 HMR/测试 teardown 使用。
 */
export function registerAction(def: ActionDef): () => void {
    const { id } = def;
    if (registry.has(id)) {
        const msg = `[action-registry] 重复注册动作 "${id}"，将被覆盖`;
        if (strictMode) {
            throw new Error(msg);
        }
        console.warn(msg);
    }
    registry.set(id, def);
    return () => {
        registry.delete(id);
    };
}

/** 批量注册 */
export function registerActions(defs: ActionDef[]): (() => void)[] {
    return defs.map((d) => registerAction(d));
}

/** 按 id 获取动作定义 */
export function getAction(id: string): ActionDef | undefined {
    return registry.get(id);
}

/** 列出全部或指定域的动作 */
export function listActions(domain?: string): ActionDef[] {
    if (domain) {
        return Array.from(registry.values()).filter((a) => a.domain === domain);
    }
    return Array.from(registry.values());
}

/** 按 id 撤销注册 */
export function unregisterAction(id: string): void {
    registry.delete(id);
}

/** 清空注册表（测试/重置用） */
export function _resetActionRegistry(): void {
    registry.clear();
}

/** 设置严格模式 */
export function _setStrictMode(strict: boolean): void {
    strictMode = strict;
}
