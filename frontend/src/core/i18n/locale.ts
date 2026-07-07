// [doc:adr-059] i18n 语言状态 —— signal + localStorage 持久化（镜像 setMmdRuntimeType）
import { reactive, scheduleRefresh } from '../reactivity';

export type LangCode = 'zh-CN' | 'en' | 'ja' | 'ko' | 'zh-TW';

/** 受支持语言清单（与竞品 DanceXR 对齐：简/繁中、英、日、韩） */
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

function loadLang(): LangCode {
    try {
        const v = localStorage.getItem(LANG_KEY) as LangCode | null;
        if (v && SUPPORTED.includes(v)) {
            return v;
        }
    } catch {
        /* localStorage 不可用：回落基准语言 */
    }
    return FALLBACK;
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
        /* 忽略 localStorage 写入失败 */
    }
    applyHtmlLang();
    scheduleRefresh();
}

function applyHtmlLang(): void {
    try {
        document.documentElement.lang = state.lang;
    } catch {
        /* ignore */
    }
}

// [doc:adr-059] 启动期调用：在菜单渲染前确定语言并同步 <html lang>。
// 语言已在模块加载期读取 localStorage，此处仅做 a11y 同步。
export function initI18n(): void {
    applyHtmlLang();
}
