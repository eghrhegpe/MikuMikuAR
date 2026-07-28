import { executeActionById } from '../action-executor';
import type { ActionResult } from '../action-executor';

export type { ActionResult };

const CONTROL_NAMESPACE = 'ai:control:';

export function parseActionFromLLM(text: string): {
    action: string;
    params: Record<string, unknown>;
} | null {
    const jsonMatch = text.match(/\{[\s\S]*?"action"[\s\S]*?"params"[\s\S]*?\}/);
    if (!jsonMatch) return null;

    try {
        const parsed = JSON.parse(jsonMatch[0]);
        if (typeof parsed.action !== 'string') return null;
        const actionId = parsed.action.startsWith(CONTROL_NAMESPACE)
            ? parsed.action
            : `${CONTROL_NAMESPACE}${parsed.action}`;
        return { action: actionId, params: parsed.params ?? {} };
    } catch {
        return null;
    }
}

export async function executeAction(
    actionId: string,
    rawParams: Record<string, unknown>
): Promise<ActionResult> {
    return executeActionById(actionId, rawParams);
}
