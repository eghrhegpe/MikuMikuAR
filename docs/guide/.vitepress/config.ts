import { defineConfig } from 'vitepress';
import fs from 'node:fs';
import path from 'node:path';

// ============================================================
// MikuMikuAR 文档站（docs/ 全量）—— 部署于 /MikuMikuAR/guide/
// 主应用 web 入口保持根路径不动；本站产物由 web-pages.yml 拷入 dist-web/guide/。
// ============================================================

const docsRoot = path.resolve(__dirname, '../..'); // docs/（srcDir 根）
const asPosix = (p) => p.split(path.sep).join('/');

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

// ---------- 1. 用户指南（guide/，固定序，首页 index 独立） ----------
const GUIDE_ORDER = [
  'import-model', 'motion-playback', 'proc-motion', 'camera-control',
  'outfit', 'props', 'stage-lights',
  'sky', 'ground', 'env-water', 'env-atmosphere', 'env-presets',
  'wind-particles', 'physics', 'scene-save',
  'ai-assistant', 'settings',
];
const guideItems = GUIDE_ORDER.filter((n) => fs.existsSync(path.join(docsRoot, 'guide', n + '.md')))
  .map((n) => ({ text: n, link: link(`guide/${n}.md`) }));

// ---------- 2. 架构与规范（docs 根散 md，固定序） ----------
const ARCH_ORDER = [
  'architecture', 'design', 'terminology', 'menu-how-to', 'function-map',
  'status', 'targets', 'dep-graph', 'grand-blueprint', 'maintenance-plan',
  'competitive-analysis', 'multi-end-maturity-matrix', 'outfits-spec',
  'security-audit-CVE', 'web-data-origin-isolation',
];
const archItems = ARCH_ORDER.filter((n) => fs.existsSync(path.join(docsRoot, n + '.md')))
  .map((n) => ({ text: n, link: link(n + '.md') }));

// ---------- 3. 决策记录（adr/，按编号数字排序） ----------
const adrItems = mdNames('adr')
  .map((f) => ({ f, num: Number((f.match(/^adr-(\d+)/) || [])[1] || 0) }))
  .sort((a, b) => a.num - b.num)
  .map(({ f }) => {
    const text = fs.readFileSync(path.join(docsRoot, 'adr', f), 'utf8');
    const title = (text.match(/^#\s+(.+)$/m) || [])[1] || f.replace(/\.md$/, '');
    return { text: title, link: link('adr/' + f) };
  });

// ---------- 4. 知识卡（knowledge/，按 category 分组折叠） ----------
const KNOWLEDGE_CATEGORIES = ['env', 'scene', 'physics', 'rendering', 'motion', 'ui', 'core', 'backend'];
const knowledgeItems = KNOWLEDGE_CATEGORIES.map((cat) => {
  const items = mdNames('knowledge')
    .filter((f) => {
      const text = fs.readFileSync(path.join(docsRoot, 'knowledge', f), 'utf8');
      return fmField(text, 'category') === cat;
    })
    .map((f) => ({ text: f.replace(/\.md$/, ''), link: link('knowledge/' + f) }));
  return items.length ? { text: cat, collapsed: true, items } : null;
}).filter(Boolean);

// ---------- 5. 开发运维（buglog/ 日期倒序 + releases/ 版本倒序） ----------
const buglogItems = mdNames('buglog')
  .sort((a, b) => b.localeCompare(a)) // 日期倒序（文件名以 YYYY-MM-DD 开头）
  .map((f) => ({ text: f.replace(/\.md$/, ''), link: link('buglog/' + f) }));
const releasesItems = mdNames('releases')
  .sort((a, b) => b.localeCompare(a))
  .map((f) => ({ text: f.replace(/\.md$/, ''), link: link('releases/' + f) }));

export default defineConfig({
  // 子路径部署：与主应用 base=/MikuMikuAR/ 保持一致，仅追加 /guide/
  base: '/MikuMikuAR/guide/',
  lang: 'zh-CN',
  title: 'MikuMikuAR 文档',
  description: 'MikuMikuAR 用户指南 + 架构文档 + 决策记录 + 知识卡',
  // 内容源 = docs/ 根（全量文档）；排除内部/未定稿目录
  srcDir: '..',
  srcExclude: [
    'guide/README.md',
    'guide/index.md', // 旧首页残留(srcDir 扩展前);文档中心首页由 docs/index.md 承担
    'guide/img/**',
    'knowledge/.archive/**',
    'audit/**',
    'research/**',
    'superpowers/**',
    'ai-new/**',
    'upstream/**',
    '_writetest.txt',
    'AGENTS.md',
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
      { text: '用户指南', link: '/guide/env-water' },
      { text: '决策记录', link: '/adr/adr-001-project-infrastructure' },
      { text: 'GitHub', link: 'https://github.com/eghrhegpe/MikuMikuAR' },
    ],
    sidebar: [
      { text: '用户指南', items: guideItems },
      { text: '架构与规范', items: archItems },
      { text: '决策记录 (ADR)', collapsed: true, items: adrItems },
      { text: '知识卡', items: knowledgeItems },
      { text: '开发运维', items: [
        { text: 'Bug 日志', collapsed: true, items: buglogItems },
        { text: '发版记录', collapsed: true, items: releasesItems },
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
