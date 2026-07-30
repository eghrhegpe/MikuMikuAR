// [doc:adr-059] i18n 语言状态 —— signal + localStorage 持久化（镜像 setMmdRuntimeType）
import { reactive, scheduleRefresh } from '../reactivity';

export type LangCode = 'zh-CN' | 'en' | 'ja' | 'ko' | 'zh-TW';

/**
 * 规划支持的语言清单（与竞品 DanceXR 对齐：简/繁中、英、日、韩）。
 * 这是「声明/规划」清单，不代表都已翻译完成。真正可切换的语言由
 * core/i18n/t.ts 的 AVAILABLE_LANGS（有 bundle 的语言）决定；语言菜单只
 * 展示 AVAILABLE_LANGS，避免列出无 bundle 的语言导致「切换无效」。
 * 新增 ja/ko/zh-TW 时：先补 locales/*.ts bundle，AVAILABLE_LANGS 自动纳入。
 */
export const SUPPORTED_LANGS: { code: LangCode; key: string }[] = [
    { code: 'zh-CN', key: 'lang.zh-CN' },
    { code: 'en', key: 'lang.en' },
    { code: 'ja', key: 'lang.ja' },
    { code: 'ko', key: 'lang.ko' },
    { code: 'zh-TW', key: 'lang.zh-TW' },
];

const LANG_KEY = 'uiLang';
const FALLBACK: LangCode = 'zh-CN';
const SUPPORTED: LangCode[] = SUPPORTED_LANGS.map((l) => l.code);

/**
 * [doc:adr-059] 从浏览器/WebView 语言偏好推断首选语言。
 * 仅在 localStorage 无显式记录时调用；用户手选优先级永远高于系统语言。
 * 匹配规则（按 navigator.languages 顺序，取首个命中）：
 *   - zh-Hant / zh-TW / zh-HK / zh-MO → 繁体 zh-TW
 *   - 其余 zh 变体（zh / zh-CN / zh-SG …）→ 简体 zh-CN
 *   - en / ja / ko 及其地区变体 → 对应基准语言
 * 全部未命中时返回 null，由调用方回落 FALLBACK。
 */
export function detectSystemLang(): LangCode | null {
    try {
        const nav = typeof navigator !== 'undefined' ? navigator : undefined;
        const prefs: string[] =
            nav && Array.isArray(nav.languages) && nav.languages.length > 0
                ? nav.languages
                : nav && nav.language
                  ? [nav.language]
                  : [];
        for (const raw of prefs) {
            const tag = raw.toLowerCase();
            if (tag.startsWith('zh')) {
                // 繁体标识：Hant 脚本，或港澳台地区码
                if (/\bhant\b/.test(tag) || /-(tw|hk|mo)\b/.test(tag)) {
                    return 'zh-TW';
                }
                return 'zh-CN';
            }
            const base = tag.split('-')[0];
            if (base === 'en' || base === 'ja' || base === 'ko') {
                return base as LangCode;
            }
        }
    } catch {
        /* navigator 不可用：交由调用方回落基准语言 */
    }
    return null;
}

// 语言决策优先级：用户手选（localStorage）> 系统语言（navigator）> 基准 zh-CN
function loadLang(): LangCode {
    try {
        const v = localStorage.getItem(LANG_KEY) as LangCode | null;
        if (v && SUPPORTED.includes(v)) {
            return v;
        }
    } catch {
        /* localStorage 不可用：继续尝试系统语言 */
    }
    return detectSystemLang() ?? FALLBACK;
}

// 模块加载即确定语言，确保菜单首帧即正确；reactive 使任意赋值自动触发刷新
const state = reactive({ lang: loadLang() });

export function getLang(): LangCode {
    return state.lang;
}

// [doc:adr-059] 切换语言 → 持久化 + 刷新所有已开菜单（scheduleRefresh）+ 更新 <html lang>
export function setLang(lang: LangCode): void {
    if (!SUPPORTED.includes(lang) || lang === state.lang) {
        return;
    }
    state.lang = lang;
    try {
        localStorage.setItem(LANG_KEY, lang);
    } catch {
        /* expected failure when localStorage is unavailable */
    }
    applyHtmlLang();
    scheduleRefresh();
}

function applyHtmlLang(): void {
    try {
        document.documentElement.lang = state.lang;
    } catch {
        /* expected failure when document.documentElement is inaccessible */
    }
}

// [doc:adr-059] 启动期调用：在菜单渲染前确定语言并同步 <html lang>。
// 语言已在模块加载期读取 localStorage，此处仅做 a11y 同步。
export function initI18n(): void {
    applyHtmlLang();
}
