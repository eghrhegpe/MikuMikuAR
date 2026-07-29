// action-executor.ts — 通用动作执行器（ADR-197 Phase 1 补完）
// 纯叶子模块，不依赖 ai:control: 命名空间。供菜单/NL/快捷键统一调用。

import { getAction } from './action-registry';
import { adaptParam } from './ai/param-adapters';

export interface ActionResult {
    success: boolean;
    message: string;
    /** 只读工具的执行结果结构化数据（ADR-205），供诊断上下文注入 */
    data?: unknown;
}

export async function executeActionById(
    id: string,
    rawParams: Record<string, unknown>
): Promise<ActionResult> {
    const def = getAction(id);
    if (!def) {
        return { success: false, message: `不支持的操作: ${id}` };
    }

    const translated: Record<string, unknown> = {};
    for (const paramDef of def.params) {
        const raw = rawParams[paramDef.name];
        if (raw === undefined) {
            if (paramDef.type !== 'boolean' && paramDef.type !== 'toggle') {
                return { success: false, message: `缺少必要参数: ${paramDef.name}` };
            }
            translated[paramDef.name] = false;
            continue;
        }
        const result = await adaptParam(paramDef, raw);
        if (!result.ok) {
            const errMsg = (result as { ok: false; error: string }).error;
            return { success: false, message: `参数"${paramDef.name}"无效: ${errMsg}` };
        }
        translated[paramDef.name] = result.value;
    }

    try {
        const execResult = await def.execute(translated);
        const paramsDesc = def.params.length
            ? ` (${def.params.map((p) => `${p.name}=${JSON.stringify(translated[p.name])}`).join(', ')})`
            : '';
        const data = (execResult as { data?: unknown } | undefined)?.data;
        return { success: true, message: `✓ ${def.label}${paramsDesc}`, data };
    } catch (err) {
        return {
            success: false,
            message: `执行失败: ${err instanceof Error ? err.message : String(err)}`,
        };
    }
}
