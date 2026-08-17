// [doc:adr-059] 翻译函数 —— 缺失 key 回退链：当前语言 → zh-CN 基准 → key 本身（开发期可见）
// [doc:perf] 语言包不再静态导入（避免全部打包进主 bundle），改为运行时 fetch JSON。
// 调用方需在启动时 await loadLocale(getLang()) 预加载当前语言。
// [doc:adr-271] bundles 已下移到 ./bundle-store（语言包缓存不依赖语言状态），
// 本文件转发 bundles 以保持既有 `import { bundles } from '.../t'`（20+ 个测试）不变；
// loadLocale 不转发——它只在 locale.ts 内部使用，转发只会进 deadcode 基线。
import { getLang } from './locale';
import { bundles } from './bundle-store';

export { bundles } from './bundle-store';

type Bundle = Record<string, string>;

/**
 * [doc:adr-059] 当前已补全语言包的语言列表。
 * 语言菜单只应展示这些语言；ja/ko/zh-TW 等仅声明于 SUPPORTED_LANGS、
 * 但尚无 bundle 的语言，在 bundle 补齐前不得作为可选项，否则选中后
 * t() 静默回退中文，造成「切换无效」的误导。
 */
export const AVAILABLE_LANGS: string[] = ['zh-CN', 'en', 'ja', 'ko', 'zh-TW'];

/**
 * [doc:adr-059] dev-only 缺失 key 告警去重集合。
 * 同一 (lang,key) 组合在一次会话内只 warn 一次，避免列表渲染时刷屏。
 * 生产构建（import.meta.env.DEV === false）下整个 warn 逻辑被 tree-shake 移除。
 */
const _warnedMissing = new Set<string>();

/**
 * 翻译一个 key。
 * @param key 形如 'settings.appearance' 的命名空间 key
 * @param params 可选占位符，用于动态字符串，如 t('status.modelsLoaded', { n: 3 })
 *               bundle 中用 {n} 表示占位符。
 */
export function t(key: string, params?: Record<string, string | number>): string {
    const lang = getLang();
    const zhCNBundle = bundles['zh-CN'];
    const langBundle = bundles[lang];
    const hasLang = langBundle && key in langBundle;
    const hasBase = zhCNBundle && key in zhCNBundle;
    let s: string;
    if (hasLang) {
        s = langBundle[key];
    } else if (hasBase) {
        s = zhCNBundle[key];
    } else {
        s = key;
    }
    // [doc:adr-059] dev-only：缺失 key 告警，帮助发现翻译缺口与拼写错误
    if (import.meta.env.DEV) {
        if (!hasLang && lang !== 'zh-CN') {
            // 当前语言缺该 key（回退到 zh-CN 或 key 本身）
            const sig = `${lang}:${key}`;
            if (!_warnedMissing.has(sig)) {
                _warnedMissing.add(sig);
                if (hasBase) {
                    console.warn(`[i18n] missing key "${key}" for "${lang}" — fell back to zh-CN`);
                } else {
                    console.warn(
                        `[i18n] missing key "${key}" for "${lang}" — key not in any bundle (typo?)`
                    );
                }
            }
        } else if (!hasBase && lang === 'zh-CN') {
            // zh-CN 基准语言也缺该 key —— 极可能是拼写错误
            const sig = `zh-CN:${key}`;
            if (!_warnedMissing.has(sig)) {
                _warnedMissing.add(sig);
                console.warn(`[i18n] key "${key}" not found in zh-CN base bundle — possible typo`);
            }
        }
    }
    if (params) {
        for (const k of Object.keys(params)) {
            // [audit:P2] 转义正则特殊字符，防 param key 含 $ . 等导致替换异常
            const escaped = k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            s = s.replace(new RegExp(`\\{${escaped}\\}`, 'g'), String(params[k]));
        }
    }
    return s;
}
