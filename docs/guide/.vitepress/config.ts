import { defineConfig } from 'vitepress';
import fs from 'node:fs';
import path from 'node:path';

// ============================================================
// MikuMikuAR 文档站（docs/ 全量）—— 部署于 /MikuMikuAR/（Pages 根）
// 主应用 web 入口降为 /MikuMikuAR/app/ 子路径；本站产物由 web-pages.yml 拷入 dist-web/（根）。
// ============================================================

const docsRoot = path.resolve(__dirname, '../..'); // docs/（srcDir 根）

/**
 * docs 根级「不发布」清单 —— 单一真相源。
 * 下方 srcExclude（阻止页面构建）与 ARCH_EXCLUDE（阻止 sidebar 收录）均从此派生，
 * 避免两处手工同步漏排（dep-graph 曾因此生成指向不存在路由的死链条目）。
 */
const ROOT_NOBUILD = ['AGENTS.md', 'dep-graph.md'];
const asPosix = (p) => p.split(path.sep).join('/');

/**
 * 文件内容缓存：sidebar 构建期多个分组会反复读同一批文件
 * （知识卡尤甚：原实现为 O(分类数 × 卡片数) 次 readFileSync，实测 235 卡 / 8 分类 = 1880 次 / 243ms）。
 * 单遍缓存后降为 O(N)，实测 235 次 / 29ms。
 */
const fileCache = new Map();
function readMd(absPath) {
  let text = fileCache.get(absPath);
  if (text === undefined) {
    text = fs.readFileSync(absPath, 'utf8');
    fileCache.set(absPath, text);
  }
  return text;
}

/** 读某目录下所有 .md 文件名（不含子目录），按文件名排序。 */
function mdNames(relDir) {
  const dir = path.join(docsRoot, relDir);
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.md'))
    .sort((a, b) => a.localeCompare(b));
}

/** 从 frontmatter 提取单个字段值。 */
function fmField(text, key) {
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!m) return undefined;
  const line = m[1].match(new RegExp('^' + key + '\\s*:\\s*(.+)$', 'm'));
  return line ? line[1].trim() : undefined;
}

/** link 路径：相对 docs/ 根、去 .md 扩展。 */
const link = (rel) => '/' + asPosix(rel).replace(/\.md$/, '');

/**
 * 扫描目录生成 sidebar items（自动收录，无需手写数组）：
 * - 取该目录下所有 .md（不含子目录），排除 exclude 列表
 * - 显示名取页面首个 `# 标题`（读文件），回退文件名
 * - 按文件名排序；新增页面自动入列，删除/归档后自动消失
 */
function scanItems(relDir, exclude = []) {
  return mdNames(relDir)
    .filter((f) => !exclude.includes(f))
    .map((f) => {
      const text = readMd(path.join(docsRoot, relDir, f));
      const title = (text.match(/^#\s+(.+)$/m) || [])[1] || f.replace(/\.md$/, '');
      return { text: title, link: link(path.join(relDir, f)) };
    });
}

// ---------- 1. 用户指南（guide/，自动扫描，首页 index/README 独立） ----------
const guideItems = scanItems('guide', ['README.md', 'index.md']);

// ---------- 2. 架构与规范（docs 根散 md，自动扫描，排除首页/AGENTS） ----------
// 语义排序权重：核心规范置顶，能力矩阵次之，参考资料沉底；
// 表外文件按文件名字母序兜底（新增根 md 仍自动入列，无需回改此表）。
const ARCH_ORDER = [
  'architecture.md',
  'design.md',
  'terminology.md',
  'menu-how-to.md',
  'function-map.md',
  'status.md',
  'targets.md',
  'multi-end-maturity-matrix.md',
  'grand-blueprint.md',
  'outfits-spec.md',
  'competitive-analysis.md',
  'security-audit-CVE.md',
  'web-data-origin-isolation.md',
];
const archWeight = (rel) => {
  const i = ARCH_ORDER.indexOf(path.basename(rel));
  return i === -1 ? ARCH_ORDER.length : i; // 表外沉底
};
// index.md 是文档中心首页（要构建、但不入「架构与规范」列表），其余从 ROOT_NOBUILD 派生。
const ARCH_EXCLUDE = ['index.md', ...ROOT_NOBUILD];
const archItems = scanItems('.', ARCH_EXCLUDE).sort((a, b) => {
  const wa = archWeight(a.link);
  const wb = archWeight(b.link);
  return wa !== wb ? wa - wb : a.link.localeCompare(b.link);
});

// ---------- 3. 决策记录（adr/，按编号数字排序） ----------
const adrItems = mdNames('adr')
  .filter((f) => f !== 'index.md')
  .map((f) => ({ f, num: Number((f.match(/^adr-(\d+)/) || [])[1] || 0) }))
  .sort((a, b) => a.num - b.num)
  .map(({ f }) => {
    const text = readMd(path.join(docsRoot, 'adr', f));
    const title = (text.match(/^#\s+(.+)$/m) || [])[1] || f.replace(/\.md$/, '');
    return { text: title, link: link('adr/' + f) };
  });

// ---------- 4. 知识卡（knowledge/，按 category 聚合分组折叠） ----------
// 设计：从卡片聚合分类（groupBy），而非遍历白名单过滤卡片。
// 白名单仅决定分组「顺序」，表外/缺失/占位符 category 的卡落入「其他」组并告警，
// 绝不静默丢卡（旧的白名单投影实现曾吞掉 knowledge/README.md 与 routes.md 两张入口卡）。
const KNOWLEDGE_ORDER = ['env', 'scene', 'physics', 'rendering', 'motion', 'ui', 'core', 'backend'];
// 非知识卡目录成员（分区枢纽索引 / 导读 / 路由表），不参与按 category 分组
const KNOWLEDGE_NON_CARDS = new Set(['index.md', 'README.md', 'routes.md', 'menu-map.md', 'graph.md']);
const UNCATEGORIZED = '其他';
const knowledgeGroups = new Map();
for (const f of mdNames('knowledge')) {
  if (KNOWLEDGE_NON_CARDS.has(f)) continue;
  const raw = fmField(readMd(path.join(docsRoot, 'knowledge', f)), 'category');
  // 模板占位符（<rendering|env|...>）与空值一律视为未分类
  const cat = raw && !raw.startsWith('<') ? raw : UNCATEGORIZED;
  if (cat === UNCATEGORIZED) {
    console.warn(`[sidebar] knowledge/${f} 缺少有效 category，已归入「${UNCATEGORIZED}」组`);
  } else if (!KNOWLEDGE_ORDER.includes(cat)) {
    console.warn(`[sidebar] knowledge/${f} 使用了 KNOWLEDGE_ORDER 表外分类「${cat}」，已按字母序排在表内分组之后`);
  }
  if (!knowledgeGroups.has(cat)) knowledgeGroups.set(cat, []);
  // 显示名优先取 frontmatter name（卡片标题），无则回退文件名
  const cardName = fmField(readMd(path.join(docsRoot, 'knowledge', f)), 'name') || f.replace(/\.md$/, '');
  knowledgeGroups.get(cat).push({ text: cardName, link: link('knowledge/' + f) });
}
const knowledgeWeight = (cat) => {
  if (cat === UNCATEGORIZED) return KNOWLEDGE_ORDER.length + 1; // 未分类永远沉底
  const i = KNOWLEDGE_ORDER.indexOf(cat);
  return i === -1 ? KNOWLEDGE_ORDER.length : i; // 表外分类排在表内之后、未分类之前
};
const knowledgeItems = [...knowledgeGroups.entries()]
  .sort(([a], [b]) => {
    const wa = knowledgeWeight(a);
    const wb = knowledgeWeight(b);
    return wa !== wb ? wa - wb : a.localeCompare(b);
  })
  .map(([cat, items]) => ({ text: cat, collapsed: true, items }));

// ---------- 5. 开发运维（buglog/ 日期倒序 + releases/ 版本倒序） ----------
const buglogItems = mdNames('buglog')
  .filter((f) => f !== 'README.md' && f !== 'index.md')
  .sort((a, b) => b.localeCompare(a)) // 日期倒序（文件名以 YYYY-MM-DD 开头）
  .map((f) => ({ text: f.replace(/\.md$/, ''), link: link('buglog/' + f) }));
const releasesItems = mdNames('releases')
  .filter((f) => f !== 'index.md')
  .sort((a, b) => b.localeCompare(a))
  .map((f) => ({ text: f.replace(/\.md$/, ''), link: link('releases/' + f) }));

export default defineConfig({
  // 根路径部署：文档站即 Pages 根；主应用降为 /MikuMikuAR/app/ 子路径（ADR-177 路径重分配）
  base: '/MikuMikuAR/',
  lang: 'zh-CN',
  title: 'MikuMikuAR 文档',
  description: 'MikuMikuAR 用户指南 + 架构文档 + 决策记录 + 知识卡',
  // 内容源 = docs/ 根（全量文档）；排除内部/未定稿目录
  srcDir: '..',
  srcExclude: [
    'guide/README.md', // 编写规范/目录,落在 /guide/README;用户指南枢纽由 guide/index.md 承担
    'guide/img/**',
    'knowledge/.archive/**',
    'audit/**',
    'research/**',
    'superpowers/**',
    'ai-new/**',
    'upstream/**',
    '_writetest.txt',
    // AGENTS.md（AI 协作约定）+ dep-graph.md（开发自查产物，252 节点/1444 边依赖图）
    ...ROOT_NOBUILD,
  ],
  // 全量进站后：正文大量相对链接（../../AGENTS、./adr/xxx 等）是 GitHub 仓库浏览用途，
  // 在 VitePress 站内按路由解析必然死链；站内导航由 sidebar 数组保证。
  // 取舍：忽略全部死链；新增 guide 页必须同步更新 sidebar（见 P1 维护约定）。
  ignoreDeadLinks: true,

  // srcDir 指向 docs/ 后，页面模块位于 docs/adr/ 等子目录，Node 从页面目录向上找 node_modules
  // 找不到（依赖只在 docs/guide/node_modules）→ vue/server-renderer 解析失败。
  // 显式 alias 把 vue 相关解析指回 docs/guide/node_modules。
  vite: {
    resolve: {
      alias: [
        // 精确匹配 vue，避免前缀匹配把 vue/server-renderer 也替换成 vue.runtime.esm-bundler.js/server-renderer
        { find: /^vue$/, replacement: path.resolve(__dirname, '../node_modules/vue/dist/vue.runtime.esm-bundler.js') },
        { find: /^vue\/server-renderer$/, replacement: path.resolve(__dirname, '../node_modules/vue/server-renderer/index.mjs') },
        { find: /^vitepress$/, replacement: path.resolve(__dirname, '../node_modules/vitepress/dist/client/index.js') },
      ],
    },
    ssr: { noExternal: ['vue', 'vitepress'] },
  },

  // 知识卡/ADR 里大量泛型写法（如 AsyncGenerator<ChatChunk>、ReadableStream<Uint8Array>）
  // 会被 Vue 编译器误当 HTML 标签解析报错。统一转义不在白名单内的裸 <tag>，
  // 白名单内的真实 HTML（details/code/span 等）保留。
  markdown: {
    config(md) {
      const HTML_TAGS = new Set([
        // void 元素（单标签合法，Vue 不会要求闭合）
        'br', 'img', 'input', 'hr', 'source', 'track', 'embed', 'wbr', 'meta',
        // 成对使用才保留；单写即未闭合的（a/label/section/…）一律转义
        'details', 'summary', 'div', 'span', 'code', 'b', 'i', 'em',
        'strong', 'table', 'thead', 'tbody', 'tr', 'td', 'th', 'a', 'ul', 'ol', 'li',
        'p', 'blockquote', 'pre', 'button', 'select', 'option', 'sub',
        'sup', 'kbd', 'mark', 'small', 'del', 'ins', 'figure', 'figcaption', 'video',
        'iframe', 'center',
      ]);
      md.core.ruler.push('escape_bare_angles', (state) => {
        for (const token of state.tokens) {
          if (token.type !== 'inline' || !token.children) continue;
          for (const child of token.children) {
            // text: 泛型写法（AsyncGenerator<ChatChunk>）落在 text token
            // html_inline: <iconify-icon> 这类被 markdown-it 解析为 html_inline token
            if (child.type !== 'text' && child.type !== 'html_inline') continue;
            child.content = child.content.replace(
              /<([A-Za-z][A-Za-z0-9]*)(\s[^<>]*)?>/g,
              (m, tag) => (HTML_TAGS.has(tag.toLowerCase()) ? m : m.replace(/</g, '&lt;').replace(/>/g, '&gt;'))
            );
          }
        }
      });
    },
  },

  themeConfig: {
    nav: [
      { text: '首页', link: '/' },
      { text: '用户指南', link: '/guide/' },
      { text: '知识卡', link: '/knowledge/' },
      { text: '决策记录', link: '/adr/' },
      { text: '开发运维', link: '/buglog/' },
      { text: 'GitHub', link: 'https://github.com/eghrhegpe/MikuMikuAR' },
    ],
    sidebar: [
      { text: '用户指南', link: '/guide/', collapsed: true, items: guideItems },
      { text: '架构与规范', link: '/architecture', collapsed: true, items: archItems },
      { text: '决策记录 (ADR)', link: '/adr/', collapsed: true, items: adrItems },
      { text: '知识卡', link: '/knowledge/', items: knowledgeItems },
      { text: '开发运维', items: [
        { text: 'Bug 日志', link: '/buglog/', collapsed: true, items: buglogItems },
        { text: '发版记录', link: '/releases/', collapsed: true, items: releasesItems },
      ] },
    ],
    outline: { label: '本页导航', level: [2, 3] },
    search: {
      provider: 'local',
      options: {
        translations: {
          button: { buttonText: '搜索', buttonAriaLabel: '搜索' },
          modal: {
            noResultsText: '未找到相关结果',
            resetButtonTitle: '清除',
            footer: { selectText: '选择', navigateText: '切换', closeText: '关闭' },
          },
        },
      },
    },
  },
});
