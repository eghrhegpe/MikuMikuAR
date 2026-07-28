import { executeActionById } from '../action-executor';
import type { ActionResult } from '../action-executor';

export type { ActionResult };

const CONTROL_NAMESPACE = 'ai:control:';

function _tryParse(text: string): { action: string; params: Record<string, unknown> } | null {
    try {
        const parsed = JSON.parse(text);
        if (typeof parsed.action !== 'string') {
            return null;
        }
        const actionId = parsed.action.startsWith(CONTROL_NAMESPACE)
            ? parsed.action
            : `${CONTROL_NAMESPACE}${parsed.action}`;
        return { action: actionId, params: parsed.params ?? {} };
    } catch {
        return null;
    }
}

export function parseActionFromLLM(text: string): {
    action: string;
    params: Record<string, unknown>;
} | null {
    let result: ReturnType<typeof _tryParse>;

    // Priority 1: 如果全文就是合法 JSON，直接解析
    result = _tryParse(text);
    if (result) {
        return result;
    }

    // Priority 2: 提取 ```json 代码块
    const codeBlockMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (codeBlockMatch) {
        result = _tryParse(codeBlockMatch[1].trim());
        if (result) {
            return result;
        }
    }

    // Priority 3: 正则回退 —— 匹配含 action + params 的 JSON 对象
    const jsonMatch = text.match(/\{[\s\S]*?"action"[\s\S]*?"params"[\s\S]*?\}/);
    if (jsonMatch) {
        result = _tryParse(jsonMatch[0]);
        if (result) {
            return result;
        }
    }

    return null;
}

export async function executeAction(
    actionId: string,
    rawParams: Record<string, unknown>
): Promise<ActionResult> {
    return executeActionById(actionId, rawParams);
}
