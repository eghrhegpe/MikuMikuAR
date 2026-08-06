#!/usr/bin/env node
/**
 * gen-menu-map.mjs — 从源码自动生成「菜单层级地图」知识库文档（docs/knowledge/menu-map.md）。
 *
 * 提取三部分静态菜单骨架：
 *   A. 声明式 Schema 树 —— 每个 `build*Schema(): MenuNode[]` 返回的数组字面量
 *      （id / kind / label / icon / target / children 嵌套），见 ADR-093。
 *   B. 根导航 items    —— `items.push({...})` 与 `items: [...]` 中的
 *      PopupRow（kind / label / target）。
 *   C. target 路由映射 —— `onFolderEnter` / `sceneOnFolderEnter` 等 switch 中
 *      `case '<target>': return buildXxxLevel()` 的 target → builder 对应。
 *
 * 局限（静态提取固有）：
 *   - `renderCustom` / `custom` 节点内部运行时生成的行（模型列表、标签、搜索结果）无法提取，
 *     仅以节点本身占位。
 *   - `slideRow(...)` 命令式内联行不提取。
 *
 * 用法：
 *   node scripts/gen-menu-map.mjs            # 重新生成 docs/knowledge/menu-map.md
 *   node scripts/gen-menu-map.mjs --check    # 校验文档是否与源码一致（不一致 exit 1）
 *
 * 零依赖（node:fs / node:path / node:url）。写盘采用原子重命名（.tmp → rename）。
 * 设计意图：// ---------------------------------------------------------------------------
 * 退出码：1（失败）
 */

import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from './_lib/parse-args.mjs';
import { ROOT } from './_lib/scan-files.mjs';

const MENUS_DIR = path.join(ROOT, 'frontend', 'src', 'menus');
const OUT_PATH = path.join(ROOT, 'docs', 'knowledge', 'menu-map.md');

const args = parseArgs(process.argv.slice(2), { bools: ['check'], strings: [] });
if (args.help) {
  const _src = fs.readFileSync(process.argv[1], 'utf-8');
  const _s = _src.indexOf('/**');
  const _e = _src.indexOf('*/', _s);
  console.log(_src.slice(_s, _e + 2).replace(/^ \* ?/gm, '').trim());
  process.exit(0);
}
if (args.unknown && args.unknown.length) {
  console.error(`❌ 未知参数: ${args.unknown.join(', ')}（--help 查看用法）`);
  process.exit(1);
}
const CHECK_ONLY = args.check;

// ---------------------------------------------------------------------------
// 括号平衡工具
// ---------------------------------------------------------------------------

/** 从 openIdx（须为 '[' 或 '{'）找到匹配的闭符下标；未闭合返回 -1。 */
function matchBracket(text, openIdx) {
  const open = text[openIdx];
  const close = open === '[' ? ']' : open === '{' ? '}' : null;
  if (!close) return -1;
  let depth = 0;
  let inStr = null; // null | ' | " | `
  for (let i = openIdx; i < text.length; i++) {
    const ch = text[i];
    if (inStr) {
      if (ch === '\\') { i++; continue; }
      if (ch === inStr) inStr = null;
      continue;
    }
    if (ch === "'" || ch === '"' || ch === '`') { inStr = ch; continue; }
    if (ch === '/' && text[i + 1] === '/') {
      const nl = text.indexOf('\n', i + 2);
      if (nl === -1) return -1;
      i = nl;
      continue;
    }
    if (ch === '/' && text[i + 1] === '*') {
      const end = text.indexOf('*/', i + 2);
      if (end === -1) return -1;
      i = end + 1;
      continue;
    }
    if (ch === open) depth++;
    else if (ch === close) {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/** 在顶层逗号处拆分数组/对象文本（跳过嵌套与字符串），返回元素数组。 */
function splitTopLevel(text) {
  const items = [];
  let depth = 0;
  let inStr = null;
  let start = -1;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inStr) {
      if (ch === '\\') { i++; continue; }
      if (ch === inStr) inStr = null;
      continue;
    }
    if (ch === "'" || ch === '"' || ch === '`') { inStr = ch; continue; }
    if (ch === '/' && text[i + 1] === '/') {
      const nl = text.indexOf('\n', i + 2);
      if (nl === -1) break;
      i = nl;
      continue;
    }
    if (ch === '/' && text[i + 1] === '*') {
      const end = text.indexOf('*/', i + 2);
      if (end === -1) break;
      i = end + 1;
      continue;
    }
    if (ch === '[' || ch === '{') {
      if (depth === 0 && start === -1) start = i;
      depth++;
    } else if (ch === ']' || ch === '}') {
      depth--;
      if (depth === 0 && start !== -1) {
        items.push(text.slice(start, i + 1));
        start = -1;
      }
    } else if (ch === ',' && depth === 0 && start !== -1) {
      items.push(text.slice(start, i));
      start = -1;
    }
  }
  if (start !== -1) items.push(text.slice(start));
  return items;
}

// ---------------------------------------------------------------------------
// 对象属性提取
// ---------------------------------------------------------------------------

/**
 * 提取对象字面量文本中 `key: <value>` 的值。
 * 支持：'str'、"str"、`str`、t('i18n.key')、数字、布尔、标识符。
 * 嵌套对象/数组不提取（返回 undefined）。
 */
function extractProp(objText, key) {
  const re = new RegExp(`\\b${key}\\s*:`);
  const m = re.exec(objText);
  if (!m) return undefined;
  let i = m.index + m[0].length;
  while (i < objText.length && /\s/.test(objText[i])) i++;
  const ch = objText[i];
  if (ch === "'" || ch === '"' || ch === '`') {
    let val = '';
    let j = i + 1;
    while (j < objText.length && objText[j] !== ch) {
      if (objText[j] === '\\') { val += objText[j + 1] ?? ''; j += 2; continue; }
      val += objText[j];
      j++;
    }
    return val;
  }
  if (objText.startsWith('t(', i)) {
    const tm = /t\(\s*['"]([^'"]+)['"]/.exec(objText.slice(i));
    return tm ? tm[1] : undefined;
  }
  if (objText.startsWith('getLabel(', i)) return undefined; // 动态 label，跳过
  const im = /^[A-Za-z0-9_.$-]+/.exec(objText.slice(i));
  return im ? im[0] : undefined;
}

/** 递归解析 MenuNode 数组字面量 → 树节点。 */
function parseNodeArray(arrText) {
  const inner = arrText.slice(1, -1);
  const nodes = [];
  for (const el of splitTopLevel(inner)) {
    const trimmed = el.trim();
    if (!trimmed || trimmed === ',') continue;
    if (!trimmed.startsWith('{')) continue; // 标量元素（如变量引用）跳过
    const node = {
      id: extractProp(trimmed, 'id'),
      kind: extractProp(trimmed, 'kind'),
      label: extractProp(trimmed, 'label'),
      icon: extractProp(trimmed, 'icon'),
      target: extractProp(trimmed, 'target'),
    };
    // children: [ ... ] 嵌套
    const chIdx = trimmed.indexOf('children');
    if (chIdx !== -1) {
      const colon = trimmed.indexOf(':', chIdx + 8);
      if (colon !== -1) {
        let k = colon + 1;
        while (k < trimmed.length && /\s/.test(trimmed[k])) k++;
        if (trimmed[k] === '[') {
          const end = matchBracket(trimmed, k);
          if (end !== -1) node.children = parseNodeArray(trimmed.slice(k, end + 1));
        }
      }
    }
    nodes.push(node);
  }
  return nodes;
}

// ---------------------------------------------------------------------------
// 源码扫描
// ---------------------------------------------------------------------------

/** 在函数体文本中寻找顶层 `return [ ... ]`，返回数组字面量文本。 */
function findReturnArray(bodyText) {
  let i = 0;
  while (i < bodyText.length) {
    const m = /return\s*\[/.exec(bodyText.slice(i));
    if (!m) return null;
    const openIdx = i + m.index + m[0].length - 1; // '[' 位置
    const end = matchBracket(bodyText, openIdx);
    if (end !== -1) return bodyText.slice(openIdx, end + 1);
    i = openIdx + 1;
  }
  return null;
}

/** 从文件文本中提取所有 `build*Schema()` 函数及其 schema 树。 */
function extractSchemas(text) {
  const schemas = [];
  const re = /\b(?:export\s+)?function\s+(build\w+Schema)\s*\([^)]*\)\s*:\s*MenuNode\[\]\s*\{/g;
  let m;
  while ((m = re.exec(text))) {
    const braceIdx = m.index + m[0].length - 1; // '{'
    const end = matchBracket(text, braceIdx);
    if (end === -1) continue;
    const body = text.slice(braceIdx + 1, end);
    const arr = findReturnArray(body);
    if (arr) schemas.push({ name: m[1], nodes: parseNodeArray(arr) });
  }
  return schemas;
}

/** 从文件文本中提取 `items.push({ ... })` 的导航行。 */
function extractPushedItems(text) {
  const rows = [];
  const re = /items\.push\(\s*\{/g;
  let m;
  while ((m = re.exec(text))) {
    const openIdx = m.index + m[0].length - 1; // '{'
    const end = matchBracket(text, openIdx);
    if (end === -1) continue;
    const obj = text.slice(openIdx, end + 1);
    rows.push({
      kind: extractProp(obj, 'kind'),
      label: extractProp(obj, 'label'),
      target: extractProp(obj, 'target'),
      icon: extractProp(obj, 'icon'),
    });
  }
  return rows;
}

/** 从文件文本中提取 `return { ... items: [ ... ] ... }` 的根级 items 树。 */
function extractRootItems(text) {
  const items = [];
  const re = /\bitems\s*:\s*\[/g;
  let m;
  while ((m = re.exec(text))) {
    const openIdx = m.index + m[0].length - 1; // '['
    const end = matchBracket(text, openIdx);
    if (end === -1) continue;
    const arrText = text.slice(openIdx, end + 1);
    const inner = arrText.slice(1, -1);
    for (const el of splitTopLevel(inner)) {
      const trimmed = el.trim();
      if (!trimmed || trimmed === ',') continue;
      if (trimmed.startsWith('{')) {
        items.push({
          kind: extractProp(trimmed, 'kind'),
          label: extractProp(trimmed, 'label'),
          target: extractProp(trimmed, 'target'),
          icon: extractProp(trimmed, 'icon'),
        });
      } else {
        // 数组元素是标识符（如 buildModelRootItems()）——记录引用名
        const ref = /^[A-Za-z_$][\w$]*/.exec(trimmed);
        if (ref) items.push({ kind: 'ref', label: undefined, target: undefined, ref: ref[0] });
      }
    }
  }
  return items;
}

/** 从文件文本中提取 switch 路由 `case '<target>': return buildXxxLevel()`。 */
function extractRoutes(text) {
  const routes = [];
  const re = /case\s+['"]([^'"]+)['"]\s*:\s*return\s+(build\w+Level|build\w+Schema)\s*\(/g;
  let m;
  while ((m = re.exec(text))) {
    routes.push({ target: m[1], builder: m[2] });
  }
  return routes;
}

/** 提取顶层入口函数：`export function showXxxMenu(...)` / `export function buildXxxLevel()`（无参）。 */
function extractEntries(text) {
  const entries = [];
  const re = /export\s+function\s+(show\w+|build\w+Level)\s*\(\s*\)\s*:/g;
  let m;
  while ((m = re.exec(text))) entries.push(m[1]);
  return [...new Set(entries)];
}

/** 从 shortcut-app.ts 提取 registerShortcuts([...]) 的快捷键登记（id/label/defaultKey/defaultCtrl/group）。 */
function extractShortcuts() {
  const file = path.join(ROOT, 'frontend', 'src', 'core', 'shortcut-app.ts');
  if (!fs.existsSync(file)) return [];
  const text = fs.readFileSync(file, 'utf8');
  const start = text.indexOf('registerShortcuts([');
  if (start === -1) return [];
  const openIdx = text.indexOf('[', start);
  const closeIdx = matchBracket(text, openIdx);
  if (closeIdx === -1) return [];
  const out = [];
  for (const obj of splitTopLevel(text.slice(openIdx + 1, closeIdx))) {
    const id = extractProp(obj, 'id');
    if (!id) continue;
    out.push({
      id,
      label: extractProp(obj, 'label'),
      key: extractProp(obj, 'defaultKey'),
      ctrl: extractProp(obj, 'defaultCtrl') === 'true',
      group: extractProp(obj, 'group'),
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Markdown 渲染
// ---------------------------------------------------------------------------

function renderLabel(label) {
  return label ? `\`${label}\`` : '—';
}

function renderIcon(icon) {
  return icon ? ` ${icon}` : '';
}

function renderNode(node, depth) {
  const pad = '  '.repeat(depth);
  const kind = node.kind ?? 'node';
  const id = node.id ? ` \`${node.id}\`` : '';
  const tgt = node.target ? ` → \`${node.target}\`` : '';
  const lines = [`${pad}- **${kind}**${id} · ${renderLabel(node.label)}${renderIcon(node.icon)}${tgt}`];
  if (node.children && node.children.length > 0) {
    for (const c of node.children) lines.push(...renderNode(c, depth + 1));
  }
  return lines;
}

function renderRow(row) {
  const kind = row.kind ?? '—';
  const label = renderLabel(row.label);
  const tgt = row.target ? `\`${row.target}\`` : (row.ref ? `\`ref:${row.ref}\`` : '—');
  const icon = row.icon ? row.icon : '—';
  return `| ${kind} | ${label} | ${icon} | ${tgt} |`;
}

/**
 * 生成 frontmatter（menu-map 转正为知识卡：tier: architecture / category: ui）。
 * source_files 动态列出实际有输出内容的菜单文件，保证 check-doc-drift 磁盘存在性校验通过。
 */
function buildFrontmatter(files) {
  const covered = files
    .filter((f) => f.schemas.length || f.pushed.length || f.rootItems.length || f.routes.length)
    .map((f) => `  - frontend/src/menus/${f.rel}`);
  return [
    '---',
    'kind: menu_map',
    'name: 菜单层级地图（自动生成）',
    'tier: architecture',
    'category: ui',
    'scope:',
    '  - frontend/src/menus/*.ts',
    'source_files:',
    ...covered,
    'adr:',
    '  - ADR-093',
    '  - ADR-218',
    'invariants:',
    '  - 由 scripts/gen-menu-map.mjs 自动生成，禁止手改（--check 守护一致性）',
    '  - renderCustom/custom 运行时行与 slideRow 行无法静态提取，缺口由对应知识卡 ## UI 入口 补足',
    'tests:',
    '  - npm run gen:menumap -- --check（一致性校验）',
    'use_when:',
    '  - 菜单层级',
    '  - 菜单有哪些项',
    '  - 菜单路由',
    '  - 菜单怎么扩展',
    '  - 菜单地图',
    '---',
    '',
  ];
}

function buildMarkdown(files) {
  const lines = buildFrontmatter(files);
  lines.push('# 菜单层级地图（自动生成）');
  lines.push('');
  lines.push('> 由 `scripts/gen-menu-map.mjs` 从 `frontend/src/menus/**/*.ts` 自动提取，**勿手改**。');
  lines.push('> 重新生成：`node scripts/gen-menu-map.mjs`（仓库根目录）。');
  lines.push('> 本文档 `menu-map.md` 为菜单 UI 入口的机器生成事实源（ADR-218），静态归此、动态归对应知识卡。');
  lines.push('');
  lines.push('覆盖三部分静态菜单骨架：');
  lines.push('1. **Schema 树**（ADR-093 声明式）：`build*Schema(): MenuNode[]` 的层级（folder 嵌套 children）。');
  lines.push('2. **根导航 items**：`items.push({...})` / `items: [...]` 的 PopupRow（target 路由）。');
  lines.push('3. **target 路由映射**：`case \'<target>\': return build*Level()`。');
  lines.push('');
  lines.push('> ⚠ 局限：`renderCustom`/`custom` 内部运行时生成的行、命令式 `slideRow` 行无法静态提取。');
  lines.push('');
  lines.push('---');
  lines.push('');

  // ── 入口一览：顶层入口函数（人类可读「怎么打开」）+ 快捷键 ──
  const entryRows = files
    .filter((f) => f.entries.length > 0)
    .flatMap((f) => f.entries.map((name) => ({ name, rel: f.rel })));
  if (entryRows.length > 0) {
    lines.push('## 入口一览（怎么打开）');
    lines.push('');
    lines.push('| 入口函数 | 文件 |');
    lines.push('|----------|------|');
    for (const e of entryRows) lines.push(`| \`${e.name}()\` | \`${e.rel}\` |`);
    lines.push('');
  }

  const shortcuts = extractShortcuts();
  if (shortcuts.length > 0) {
    lines.push('## 快捷键（shortcut-app.ts）');
    lines.push('');
    lines.push('| id | label | 默认键 | Ctrl | 分组 |');
    lines.push('|----|-------|--------|------|------|');
    for (const s of shortcuts) {
      lines.push(`| \`${s.id}\` | \`${s.label ?? '—'}\` | ${s.key ? '`' + s.key + '`' : '—'} | ${s.ctrl ? '✓' : '—'} | ${s.group ?? '—'} |`);
    }
    lines.push('');
  }

  for (const f of files) {
    if (f.schemas.length === 0 && f.pushed.length === 0 && f.rootItems.length === 0 && f.routes.length === 0) continue;
    lines.push(`## ${f.rel}`);
    lines.push('');

    if (f.pushed.length > 0) {
      lines.push(`### 导航 items（items.push）`);
      lines.push('');
      lines.push('| kind | label | icon | target |');
      lines.push('|------|-------|------|--------|');
      for (const r of f.pushed) lines.push(renderRow(r));
      lines.push('');
    }

    if (f.rootItems.length > 0) {
      lines.push(`### 根级 items（items: [...]）`);
      lines.push('');
      lines.push('| kind | label | icon | target |');
      lines.push('|------|-------|------|--------|');
      for (const r of f.rootItems) lines.push(renderRow(r));
      lines.push('');
    }

    if (f.routes.length > 0) {
      lines.push(`### target 路由`);
      lines.push('');
      lines.push('| target | builder |');
      lines.push('|--------|---------|');
      for (const r of f.routes) lines.push(`| \`${r.target}\` | \`${r.builder}\` |`);
      lines.push('');
    }

    for (const s of f.schemas) {
      lines.push(`### Schema: ${s.name}()`);
      lines.push('');
      for (const n of s.nodes) lines.push(...renderNode(n, 0));
      lines.push('');
    }
  }

  return lines.join('\n') + '\n';
}

// ---------------------------------------------------------------------------
// 主流程
// ---------------------------------------------------------------------------

function scanFile(rel, file) {
  const text = fs.readFileSync(file, 'utf8');
  return {
    rel,
    entries: extractEntries(text),
    schemas: extractSchemas(text),
    pushed: extractPushedItems(text),
    rootItems: extractRootItems(text),
    routes: extractRoutes(text),
  };
}

function main() {
  const files = [];
  for (const e of fs.readdirSync(MENUS_DIR, { withFileTypes: true })) {
    if (!e.isFile() || !e.name.endsWith('.ts')) continue;
    files.push(scanFile(e.name, path.join(MENUS_DIR, e.name)));
  }
  files.sort((a, b) => a.rel.localeCompare(b.rel));

  const content = buildMarkdown(files);

  if (CHECK_ONLY) {
    const existing = fs.existsSync(OUT_PATH) ? fs.readFileSync(OUT_PATH, 'utf8') : '';
    if (existing !== content) {
      console.error(`❌ ${path.relative(ROOT, OUT_PATH)} 与源码不一致。请运行 node scripts/gen-menu-map.mjs 重新生成。`);
      process.exit(1);
    }
    console.log('✅ 菜单地图文档与源码一致。');
    return;
  }

  const tmpPath = OUT_PATH + '.tmp';
  fs.mkdirSync(path.dirname(OUT_PATH), { recursive: true });
  fs.writeFileSync(tmpPath, content, 'utf8');
  fs.renameSync(tmpPath, OUT_PATH);
  console.log(`✅ 菜单地图已生成：${path.relative(ROOT, OUT_PATH)}`);
  console.log(`   扫描 ${files.length} 个菜单文件。`);
}

main();
