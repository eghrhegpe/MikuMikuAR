#!/usr/bin/env node
/**
 * gen-knowledge-graph.mjs — 知识卡关联图生成器 —— 扫描 docs/knowledge/*.md 的 frontmatter（category / tier / adr 列表），
 * 知识卡关联图生成器 —— 扫描 docs/knowledge/*.md 的 frontmatter（category / tier / adr 列表），
 * 输出 Mermaid 图：architecture 卡按 category 分组，卡片节点连到其引用的 ADR 决策节点，
 * ADR 节点带 click 链接直达决策原文。
 *
 * 用法：
 *   node scripts/gen-knowledge-graph.mjs                               # Mermaid 图（stdout）
 *   node scripts/gen-knowledge-graph.mjs --file docs/knowledge/graph.md  # 写入文件
 *   node scripts/gen-knowledge-graph.mjs --check --file docs/knowledge/graph.md  # 校验是否同步
 *   node scripts/gen-knowledge-graph.mjs --category env                # 只画某分类
 *
 * 设计原则：
 *   - leaf 卡不画（工具函数/桩/barrel，折叠进索引即可，避免图被噪音淹没）；
 *   - 边 = 「architecture 卡 → 其 frontmatter adr: 引用的 ADR」，展示决策辐射面；
 *   - 全图约 95 卡 + 92 ADR 节点，GitHub / VSCode 的 Mermaid 均可渲染。
 *
 * 零依赖（仅 node:fs / node:path）。
 * 设计意图：知识图谱生成器
 * 退出码：1（失败）
 */

import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from './_lib/parse-args.mjs';
import { ROOT } from './_lib/scan-files.mjs';

const DOCS = path.join(ROOT, 'docs');
const KNOW_DIR = path.join(DOCS, 'knowledge');
const ADR_DIR = path.join(DOCS, 'adr');

const BANNER =
  '<!-- 本文件由 scripts/gen-knowledge-graph.mjs 自动生成，请勿手改。重跑：npm run gen:knowgraph -->';

const CATEGORY_LABEL = {
  env: '环境系统',
  scene: '场景编排',
  physics: '物理系统',
  rendering: '渲染系统',
  motion: '动作系统',
  ui: 'UI / 菜单',
  core: '核心基础设施',
  backend: '后端',
};

/** 索引/路由等非卡片文件（与 gen-docs-index.mjs 保持一致，graph.md 为本次新增） */
const NON_CARDS = new Set(['index.md', 'README.md', 'routes.md', 'menu-map.md', 'graph.md']);

/** 提取 frontmatter 单字段（仅扫描首个 --- 块）。 */
function fm(text, key) {
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!m) return undefined;
  const line = m[1].match(new RegExp('^' + key + '\\s*:\\s*(.+)$', 'm'));
  if (!line) return undefined;
  const v = line[1].trim();
  return v.startsWith('<') ? undefined : v;
}

/** 提取 frontmatter 列表字段的全部项（adr: 下的 `- ADR-xxx` 行）。 */
function fmList(text, key) {
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!m) return [];
  const lines = m[1].split(/\r?\n/);
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

/** Mermaid 节点 label 安全化：双引号会破坏字符串 label。 */
function safeLabel(s) {
  return String(s).replace(/"/g, "'");
}

function renderMermaid(cards, adrFileMap) {
  const lines = ['```mermaid', 'graph TD;'];

  // 按 category 分组（保持 KNOWLEDGE_ORDER 排序）
  const groups = new Map();
  for (const c of cards) {
    if (!groups.has(c.category)) groups.set(c.category, []);
    groups.get(c.category).push(c);
  }
  const order = ['env', 'scene', 'physics', 'rendering', 'motion', 'ui', 'core', 'backend', '未分类'];
  const cats = [...groups.keys()].sort((a, b) => {
    const ia = order.indexOf(a);
    const ib = order.indexOf(b);
    return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
  });

  // 卡片节点（按分类 subgraph 分组）
  const cardIds = new Map(); // file → mermaid id
  let counter = 0;
  for (const cat of cats) {
    lines.push('');
    lines.push(`    subgraph cat_${cat}["${safeLabel(CATEGORY_LABEL[cat] || cat)}"]`);
    for (const c of groups.get(cat)) {
      const id = `c${counter++}`;
      cardIds.set(c.file, id);
      lines.push(`        ${id}["${safeLabel(c.name)}"]`);
    }
    lines.push('    end');
  }

  // ADR 节点（全局收集 + 排序）
  const adrSet = new Set();
  for (const c of cards) for (const a of c.adrs) adrSet.add(a);
  const adrs = [...adrSet].sort((a, b) => a - b);

  lines.push('');
  lines.push('    subgraph adr_group["决策（ADR）"]');
  const adrIds = new Map();
  for (const num of adrs) {
    const id = `a${num}`;
    adrIds.set(num, id);
    lines.push(`        ${id}["ADR-${String(num).padStart(3, '0')}"]`);
  }
  lines.push('    end');

  // 边：卡片 → ADR
  lines.push('');
  for (const c of cards) {
    for (const num of c.adrs) {
      lines.push(`    ${cardIds.get(c.file)} --> ${adrIds.get(num)};`);
    }
  }

  // click 链接：ADR 节点 → 决策原文
  if (adrs.length) {
    lines.push('');
    for (const num of adrs) {
      const file = adrFileMap.get(num);
      if (file) lines.push(`    click ${adrIds.get(num)} href "../adr/${file}"`);
    }
  }

  lines.push('```');
  return lines.join('\n');
}

function main() {
  const args = parseArgs(process.argv.slice(2), {
    bools: ['check'],
    strings: ['file', 'category'],
    defaults: { file: null, category: null },
  });
  if (args.help) {
    console.log('用法见文件头 JSDoc（node scripts/gen-knowledge-graph.mjs [--check|--json|--strict]）');
    process.exit(0);
  }
  if (args.unknown && args.unknown.length) {
    console.error(`❌ 未知参数: ${args.unknown.join(', ')}（--help 查看用法）`);
    process.exit(1);
  }

  const isCheck = args.check;
  const categoryFilter = args.category;
  const outFile = args.file ? path.resolve(ROOT, args.file) : null;

  if (!fs.existsSync(KNOW_DIR)) {
    console.error('❌ docs/knowledge/ 不存在，请确认在仓库根目录运行');
    process.exit(1);
  }

  // 1. 扫描知识卡（leaf 不画；--category 过滤）
  const cards = [];
  for (const f of fs.readdirSync(KNOW_DIR).filter((f) => f.endsWith('.md')).sort()) {
    if (NON_CARDS.has(f)) continue;
    const text = fs.readFileSync(path.join(KNOW_DIR, f), 'utf8');
    const tier = fm(text, 'tier') || 'architecture';
    if (tier === 'leaf') continue;
    const category = fm(text, 'category') || '未分类';
    if (categoryFilter && category !== categoryFilter) continue;
    const adrs = fmList(text, 'adr')
      .map((a) => (String(a).match(/ADR-(\d+)/i) || [])[1])
      .filter(Boolean)
      .map(Number)
      .filter((n) => Number.isFinite(n));
    cards.push({
      file: f,
      name: fm(text, 'name') || f.replace(/\.md$/, ''),
      category,
      adrs,
    });
  }

  // 2. ADR 编号 → 文件映射（click 链接用）
  const adrFileMap = new Map();
  if (fs.existsSync(ADR_DIR)) {
    for (const f of fs.readdirSync(ADR_DIR)) {
      const m = f.match(/^adr-(\d+)-/);
      if (m) adrFileMap.set(parseInt(m[1], 10), f);
    }
  }

  console.error(`📄 ${categoryFilter ? `category=${categoryFilter} ` : ''}→ ${cards.length} 张 architecture 卡`);
  const totalEdges = cards.reduce((n, c) => n + c.adrs.length, 0);
  console.error(`   共 ${totalEdges} 条「卡 → ADR」边`);

  const body = renderMermaid(cards, adrFileMap);
  const output = BANNER + '\n\n# 知识卡关联图\n\n' +
    '> 机器生成的 Mermaid 图：**architecture 卡（按分类分组）→ 其引用的 ADR 决策**。' +
    'leaf 卡（工具函数/桩/barrel）不画，见 [索引](./index.md) 折叠行。\n' +
    '> 全量卡片详情见 [知识卡索引](./index.md)；ADR 原文见 [决策记录索引](../adr/index.md)。\n' +
    '> 重新生成：`npm run gen:knowgraph`（分类子集：`npm run gen:knowgraph -- --category env`）。\n\n' +
    body + '\n';

  if (outFile) {
    if (isCheck) {
      const existing = fs.existsSync(outFile) ? fs.readFileSync(outFile, 'utf8') : '';
      if (existing !== output) {
        console.error(`❌ ${outFile} 未同步，请运行：npm run gen:knowgraph`);
        process.exit(1);
      }
      console.log(`✅ ${outFile} 已同步`);
    } else {
      fs.writeFileSync(outFile, output, 'utf8');
      console.log(`✅ 已写入 ${outFile}`);
    }
  } else {
    console.log(output);
  }
}

main();
