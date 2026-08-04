#!/usr/bin/env node
/**
 * gen-routes.mjs
 * AI 知识库路由表自动生成器 —— 从知识卡 frontmatter 的 `use_when` 字段生成
 * 「意图 → 首选卡 → 其次阅读」路由表，替代手工维护的 routes.md。
 *
 * 背景：routes.md 此前手维护 75 条意图映射，新增子系统易遗漏。
 * 知识卡 `use_when` 字段覆盖率 100%（233/233），是天然的路由数据源：
 *   - 首选卡 = 卡片本身（use_when 关键词 → 本卡）
 *   - 其次阅读 = 共享 ADR 的关联卡（与 graph.md 同一数据源，全自动推导）
 *
 * 用法：
 *   node scripts/gen-routes.mjs            # 写入 docs/knowledge/routes.md
 *   node scripts/gen-routes.mjs --check    # 只校验不写入（CI）
 *
 * 零依赖（仅 node:fs / node:path）。
 * 设计意图：路由表生成器
 * 退出码：1（失败）
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from './_lib/parse-args.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const KNOW_DIR = path.join(ROOT, 'docs', 'knowledge');
const OUT_PATH = path.join(KNOW_DIR, 'routes.md');

const BANNER =
  '<!-- 本文件由 scripts/gen-routes.mjs 自动生成，请勿手改。重跑：npm run gen:routes -->';

/** 非知识卡文件 */
const NON_CARDS = new Set([
  'README.md', 'index.md', 'routes.md', 'menu-map.md', 'graph.md', 'tier-review.md',
]);

/** 提取 frontmatter 块。 */
function fmBlock(text) {
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  return m ? m[1] : '';
}

/** 提取 frontmatter 单字段。 */
function fm(text, key) {
  const m = fmBlock(text).match(new RegExp('^' + key + '\\s*:\\s*(.+)$', 'm'));
  return m ? m[1].trim() : undefined;
}

/** 提取 frontmatter 列表字段（`key:` 后逐行 `- 项`，兼容单行）。 */
function fmList(text, key) {
  const lines = fmBlock(text).split(/\r?\n/);
  const out = [];
  let inList = false;
  for (const line of lines) {
    const head = line.match(new RegExp('^' + key + '\\s*:\\s*(.*)$'));
    if (head) {
      inList = true;
      const inline = head[1].replace(/#.*$/, '').trim();
      if (inline && !inline.startsWith('<')) out.push(inline);
      continue;
    }
    if (!inList) continue;
    const item = line.match(/^\s*-\s*(.+)$/);
    if (item) {
      const v = item[1].replace(/#.*$/, '').trim();
      if (v && !v.startsWith('<')) out.push(v);
    } else if (/^\S/.test(line)) {
      inList = false;
    }
  }
  return out;
}

/** 单元格转义。 */
function cell(s) {
  return String(s).replace(/\|/g, '\\|').replace(/\r?\n/g, ' ').trim();
}

/** 提取 frontmatter 里的 ADR 引用编号（adr: 列表 → [138, 148]）。 */
function adrNumbers(text) {
  return fmList(text, 'adr')
    .map((a) => (String(a).match(/ADR-(\d+)/i) || [])[1])
    .filter(Boolean)
    .map(Number)
    .filter((n) => Number.isFinite(n));
}

function renderRoutes(cards) {
  const out = [];
  out.push(BANNER);
  out.push('');
  out.push('# AI 知识库路由表');
  out.push('');
  out.push(
    '本表把用户的自然语言意图映射到首张知识卡。AI 应先命中首选卡，再沿卡片的 `source_files`、API 和子系统关系继续追踪；不要直接扫描整个 `frontend/src/`。'
  );
  out.push('');
  out.push('> 由 `scripts/gen-routes.mjs` 自动生成：首选卡按卡片 `use_when` 关键词命中，其次阅读为共享 ADR 的关联卡。');
  out.push('');
  out.push('## 路由规则');
  out.push('');
  out.push('| 用户意图或关键词 | 首选知识卡 | 其次阅读 |');
  out.push('|---|---|---|');
  for (const c of cards) {
    const keywords = c.useWhen.join('、');
    const primary = `[${cell(c.name)}](./${c.file})`;
    const secondary = c.related.length
      ? c.related.map((r) => `[${cell(r.name)}](./${r.file})`).join('、')
      : '—';
    out.push(`| ${cell(keywords)} | ${primary} | ${secondary} |`);
  }
  out.push('');
  out.push('## 标准执行模板');
  out.push('');
  out.push('```text');
  out.push('先按 docs/knowledge/routes.md 判断首选知识卡。');
  out.push('读取 docs/knowledge/README.md 和首选卡片，再按 source_files 阅读源码。');
  out.push('grep docs/adr/ 查找相关决策和状态，检查 symbols、invariants、tests、use_when。');
  out.push('以源码为最终事实来源；如果卡片过时，先报告漂移，再决定是否同步更新。');
  out.push('修改后运行最小相关测试和 npm run check:docs。');
  out.push('```');
  out.push('');
  out.push('## 维护规则');
  out.push('');
  out.push('- 本文件自动生成，**请勿手改**；重跑 `npm run gen:routes` 重新生成。');
  out.push('- 新增/修改知识卡：更新 frontmatter 的 `use_when`（意图关键词）与 `adr`（关联决策）后重跑即可自动入列。');
  out.push('- `use_when` 为空或不含关键词的卡不会出现在路由表（但仍可经索引/关联图抵达）。');
  out.push('');
  return out.join('\n');
}

function main() {
  const args = parseArgs(process.argv.slice(2), {
    bools: ['check'],
    strings: [],
    defaults: {},
  });
  const isCheck = args.check;

  if (!fs.existsSync(KNOW_DIR)) {
    console.error('❌ docs/knowledge/ 不存在，请确认在仓库根目录运行');
    process.exit(1);
  }

  // 1. 收集 architecture 卡 + use_when + adr
  const cards = [];
  for (const f of fs.readdirSync(KNOW_DIR).filter((f) => f.endsWith('.md'))) {
    if (NON_CARDS.has(f)) continue;
    const text = fs.readFileSync(path.join(KNOW_DIR, f), 'utf8');
    if (!fmBlock(text)) continue;
    const tier = fm(text, 'tier');
    if (tier !== 'architecture') continue;
    cards.push({
      file: f,
      name: fm(text, 'name') || f.replace(/\.md$/, ''),
      useWhen: fmList(text, 'use_when'),
      adrs: adrNumbers(text),
    });
  }
  // 只保留有 use_when 关键词的卡
  const routable = cards.filter((c) => c.useWhen.length > 0);

  // 2. 其次阅读：共享 ≥1 个 ADR 的其他卡（按共享数降序取前 3）
  const byAdr = new Map(); // adr 编号 → [卡]
  for (const c of routable) {
    for (const n of c.adrs) {
      if (!byAdr.has(n)) byAdr.set(n, []);
      byAdr.get(n).push(c);
    }
  }
  for (const c of routable) {
    const score = new Map(); // 卡 file → 共享 adr 数
    for (const n of c.adrs) {
      for (const other of byAdr.get(n) || []) {
        if (other.file === c.file) continue;
        score.set(other.file, (score.get(other.file) || 0) + 1);
      }
    }
    c.related = [...score.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, 3)
      .map(([file]) => cards.find((k) => k.file === file))
      .filter(Boolean);
  }

  // 按文件名排序（稳定输出）
  routable.sort((a, b) => a.file.localeCompare(b.file));

  // 3. use_when 关键词冲突检测：同一关键词被 ≥2 张卡使用时，AI 路由有歧义，告警提示消歧
  const kwToCards = new Map(); // 关键词 → [卡]
  for (const c of routable) {
    for (const kw of c.useWhen) {
      if (!kwToCards.has(kw)) kwToCards.set(kw, []);
      kwToCards.get(kw).push(c);
    }
  }
  const conflicts = [...kwToCards.entries()]
    .filter(([, list]) => list.length > 1)
    .sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]));
  if (conflicts.length) {
    console.warn(`⚠️  ${conflicts.length} 个 use_when 关键词被多张卡共用（路由有歧义，建议人工消歧）:`);
    for (const [kw, list] of conflicts.slice(0, 15)) {
      console.warn(`   - 「${kw}」→ ${list.map((c) => c.file).join(', ')}`);
    }
    if (conflicts.length > 15) console.warn(`   … 其余 ${conflicts.length - 15} 个省略`);
  } else {
    console.error('✅ use_when 关键词无冲突');
  }

  const output = renderRoutes(routable);
  console.error(`📄 ${routable.length} 张 architecture 卡可路由（${cards.length - routable.length} 张无 use_when 关键词）`);

  if (isCheck) {
    const existing = fs.existsSync(OUT_PATH) ? fs.readFileSync(OUT_PATH, 'utf8') : '';
    if (existing !== output) {
      console.error(`❌ ${OUT_PATH} 未同步，请运行：npm run gen:routes`);
      process.exit(1);
    }
    console.log(`✅ ${OUT_PATH} 已同步`);
    return;
  }

  fs.writeFileSync(OUT_PATH, output, 'utf8');
  console.log(`✅ 已写入 ${OUT_PATH}`);
}

main();
