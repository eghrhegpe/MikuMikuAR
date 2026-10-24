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

/** [audit P3] 从 start 处（必须为 '{'）起按括号配对提取完整 JSON 对象，跳过字符串字面量内的括号。
 *  未配对（片段残缺）返回 null——宁可交回 null，不猜补。 */
function _extractBalancedJson(text: string, start: number): string | null {
    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let i = start; i < text.length; i++) {
        const c = text.charAt(i);
        if (inString) {
            if (escaped) {
                escaped = false;
            } else if (c === '\\') {
                escaped = true;
            } else if (c === '"') {
                inString = false;
            }
            continue;
        }
        if (c === '"') {
            inString = true;
        } else if (c === '{') {
            depth++;
        } else if (c === '}') {
            depth--;
            if (depth === 0) {
                return text.slice(start, i + 1);
            }
        }
    }
    return null;
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
    // 优先级 3：正则回退 —— 提取含 action + params 的 JSON 对象
    // [audit P3] 旧 lazy 正则 /\{[\s\S]*?"action"..."params"[\s\S]*?\}/ 在第一个 '}' 处截断，
    // 嵌套 params（{"action":...,"params":{"a":1}}）会静默失败（测试曾将其钉死为 null）。
    // 改为括号平衡提取：定位 "action" 后从前面最近的 '{' 起配对到闭括号（跳过字符串内括号）。
    const actionIdx = text.indexOf('"action"');
    if (actionIdx !== -1) {
        const open = text.lastIndexOf('{', actionIdx);
        if (open !== -1) {
            const snippet = _extractBalancedJson(text, open);
            if (snippet) {
                result = _tryParse(snippet);
                if (result) {
                    return result;
                }
            }
        }
    }

    // P1/P2/P3 均未命中 → 无匹配
    return null;
}

export async function executeAction(
    actionId: string,
    rawParams: Record<string, unknown>
): Promise<ActionResult> {
    return executeActionById(actionId, rawParams);
}
