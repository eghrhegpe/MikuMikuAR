// [doc:adr-271] i18n 语言包存储 — 与翻译函数解耦的叶子模块
// 职责: 保存运行时加载的语言包缓存 + 负责 fetch。
// 拆出理由: locale.ts（语言状态）需要 loadLocale，而 t.ts（翻译函数）需要 getLang，
// 两者互指构成 size=2 强连通分量。语言包缓存本身不依赖任何语言状态，
// 抽成叶子后 locale → bundle-store ← t，环消失；t.ts 转发 bundles/loadLocale 保持对外 API 不变
// （20+ 个测试直接 `import { bundles } from '.../t'` 并赋值，不能改路径）。

type Bundle = Record<string, string>;

/** 运行时加载的语言包缓存。生产环境由 fetch 填充，测试环境可直接赋值。 */
export const bundles: Record<string, Bundle> = {};

/**
 * 异步加载指定语言包，从 public/locales/{lang}.json fetch。
 * 幂等：已加载过的语言不会重复 fetch。
 */
export async function loadLocale(lang: string): Promise<void> {
    if (bundles[lang]) {
        return;
    }
    try {
        const resp = await fetch(`${import.meta.env.BASE_URL}locales/${lang}.json`);
        if (!resp.ok) {
            console.warn(`[i18n] 加载语言包失败: ${lang} (HTTP ${resp.status})`);
            bundles[lang] = {};
            return;
        }
        bundles[lang] = await resp.json();
    } catch (err) {
        console.warn(`[i18n] 加载语言包失败: ${lang}`, err);
        bundles[lang] = {};
    }
}
