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
