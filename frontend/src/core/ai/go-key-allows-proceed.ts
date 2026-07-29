// [doc:adr-196] Go 桌面端 key 不可回读辅助函数
// 纯函数，零 side-effect 导入。直接从 config-store 取 validateAiConfig 类型。
import { validateAiConfig } from './config-store';

/**
 * Go 桌面端 key 不可回读，当 isGo=true && keyConfigured=true 时，
 * missingKey 不应阻止前端发起请求（key 由 Go 后端持有）。
 *
 * @returns true 表示验证放行（后面的请求可继续）。
 */
export function goKeyAllowsProceed(
    validation: ReturnType<typeof validateAiConfig>,
    isGo: boolean,
    keyConfigured: boolean
): boolean {
    if (validation.ok) {
        return true;
    }
    if (isGo && keyConfigured) {
        const nonKey = validation.errors?.filter((e) => e.kind !== 'missingKey') ?? [];
        return nonKey.length === 0;
    }
    return false;
}
