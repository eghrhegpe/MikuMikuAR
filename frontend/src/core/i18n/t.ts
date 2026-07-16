// [doc:adr-059] 翻译函数 —— 缺失 key 回退链：当前语言 → zh-CN 基准 → key 本身（开发期可见）
import { getLang } from './locale';
import { zhCN } from './locales/zh-CN';
import { en } from './locales/en';
import { ja } from './locales/ja';
import { ko } from './locales/ko';
import { zhTW } from './locales/zh-TW';

type Bundle = Record<string, string>;

const bundles: Record<string, Bundle> = {
    'zh-CN': zhCN,
    en,
    ja,
    ko,
    'zh-TW': zhTW,
};

/**
 * [doc:adr-059] 当前已补全语言包的语言列表。
 * 语言菜单只应展示这些语言；ja/ko/zh-TW 等仅声明于 SUPPORTED_LANGS、
 * 但尚无 bundle 的语言，在 bundle 补齐前不得作为可选项，否则选中后
 * t() 静默回退中文，造成「切换无效」的误导。
 */
export const AVAILABLE_LANGS: string[] = Object.keys(bundles);

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
    const langBundle = bundles[lang];
    const hasLang = langBundle && key in langBundle;
    const hasBase = key in zhCN;
    let s: string;
    if (hasLang) {
        s = langBundle[key];
    } else if (hasBase) {
        s = zhCN[key];
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
            s = s.replace(new RegExp(`\\{${k}\\}`, 'g'), String(params[k]));
        }
    }
    return s;
}
