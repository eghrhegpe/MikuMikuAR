// [doc:adr-059] 翻译函数 —— 缺失 key 回退链：当前语言 → zh-CN 基准 → key 本身（开发期可见）
import { getLang } from './locale';
import { zhCN } from './locales/zh-CN';
import { en } from './locales/en';

type Bundle = Record<string, string>;

const bundles: Record<string, Bundle> = {
    'zh-CN': zhCN,
    en,
};

/**
 * [doc:adr-059] 当前已补全语言包的语言列表。
 * 语言菜单只应展示这些语言；ja/ko/zh-TW 等仅声明于 SUPPORTED_LANGS、
 * 但尚无 bundle 的语言，在 bundle 补齐前不得作为可选项，否则选中后
 * t() 静默回退中文，造成「切换无效」的误导。
 */
export const AVAILABLE_LANGS: string[] = Object.keys(bundles);

/**
 * 翻译一个 key。
 * @param key 形如 'settings.appearance' 的命名空间 key
 * @param params 可选占位符，用于动态字符串，如 t('status.modelsLoaded', { n: 3 })
 *               bundle 中用 {n} 表示占位符。
 */
export function t(key: string, params?: Record<string, string | number>): string {
    const lang = getLang();
    let s = (bundles[lang] && bundles[lang][key]) || zhCN[key] || key;
    if (params) {
        for (const k of Object.keys(params)) {
            s = s.replace(new RegExp(`\\{${k}\\}`, 'g'), String(params[k]));
        }
    }
    return s;
}
