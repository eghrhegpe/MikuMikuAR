import { t } from './t';

// [doc:adr-117] 与 Go 端 internal/i18nerr.EnvelopeMarker 保持一致。
// Wails v3 把 Go error stringify 成纯文本跨桥，结构化数据只能编码进
// .Error() 文本，前端按此哨兵提取 JSON 信封。
const MARKER = '@@GOERR@@';

interface GoErrEnvelope {
    code: string;
    params?: Record<string, string>;
    msg?: string;
}

/**
 * [doc:adr-117] 将 Go 端返回的 error 翻译为当前语言。
 *
 * Go 端将 UserError 编码为 `<可读msg>\n@@GOERR@@<json信封>`。
 * 此处按哨兵提取信封，用 t('goerr.<code>', params) 翻译；
 * 若无可解析信封（旧式 fmt.Errorf 中文错误），回退原始文本。
 *
 * 注意：传入的 e 通常是前端 runtime 抛出的 Error（message 为
 * "Binding call failed: ...: <msg>\n@@GOERR@@<json>"），哨兵位于末尾，
 * 用 lastIndexOf 提取即可，前缀包裹文本被忽略。
 */
export function translateGoError(e: unknown): string {
    const raw = toText(e);
    const idx = raw.lastIndexOf(MARKER);
    if (idx !== -1) {
        try {
            const env = JSON.parse(raw.slice(idx + MARKER.length)) as GoErrEnvelope;
            if (env && env.code) {
                const key = `goerr.${env.code}`;
                const translated = t(key, env.params ?? {});
                // [doc:adr-059] t() 缺失 key 时返回 key 本身 → 视为未翻译，回退到信封内中文 msg
                if (translated !== key) {
                    return translated;
                }
                return env.msg ?? raw;
            }
        } catch {
            // 信封解析失败（理论上不会，Go 端 json.Marshal 保证合法），回退原始文本
        }
    }
    return raw;
}

function toText(e: unknown): string {
    if (e instanceof Error) {
        return e.message;
    }
    if (typeof e === 'string') {
        return e;
    }
    if (e && typeof (e as { message?: unknown }).message === 'string') {
        return (e as { message: string }).message;
    }
    return String(e);
}
