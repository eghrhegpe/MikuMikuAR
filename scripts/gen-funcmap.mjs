#!/usr/bin/env node
/**
 * gen-funcmap.mjs
 * 函数映射表生成器 —— 扫描 frontend/src/ 的 TS 源文件，提取 export 符号，
 * 按模块分组生成函数索引表，写入 docs/function-map.md。
 *
 * 用法：
 *   node scripts/gen-funcmap.mjs                  # 生成并写入
 *   node scripts/gen-funcmap.mjs --check          # 只检查是否已同步
 *   node scripts/gen-funcmap.mjs --scope scene    # 只分析 scene/ 模块
 *
 * 输出「文件:行」列（findExportLine 定位 export 声明行），grep 索引可直接跳行。
 *
 * 零依赖（仅 node:fs / node:path）。
 * 退出码：1（失败）
 * 设计意图：函数地图生成器
 */

import fs from 'node:fs';
import path from 'node:path';
import { walkSourceFiles, getExportedSymbols } from './_lib/source-graph.mjs';
import { parseArgs } from './_lib/parse-args.mjs';
import { ROOT } from './_lib/scan-files.mjs';

// ── JSDoc 摘要提取（零侵入增强，不碰共用的 getExportedSymbols） ──
function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * 提取紧邻某导出符号「本文件内定义行」上方 JSDoc 块的首句摘要。
 * 仅对本文件定义型符号有效（export function/const/class/... <sym>）；
 * 对 export { a, b } 聚合型（定义在他处）自然返回 ''，说明列留 —。
 */
function extractDocSummary(filePath, sym) {
  let text;
  try {
    text = fs.readFileSync(filePath, 'utf8');
  } catch {
    return '';
  }
  const lines = text.split('\n');
  const defRe = new RegExp(
    '^(?:export\\s+(?:default\\s+)?(?:async\\s+)?)?' +
    '(?:function|const|let|class|interface|type|enum)\\s+' + escapeRe(sym) + '\\b'
  );
  let defIdx = -1;
  for (let i = 0; i < lines.length; i++) {
    if (defRe.test(lines[i])) { defIdx = i; break; }
  }
  if (defIdx <= 0) return '';

  let i = defIdx - 1;
  while (i >= 0 && /^\s*(?:\/\/.*)?$/.test(lines[i])) i--;
  if (i < 0) return '';

  const docLines = [];
  if (/\*\/\s*$/.test(lines[i])) {
    // 紧贴 export 的是多行 JSDoc 的结束行 */：向上收集到 /** 或 /*
    while (i >= 0) {
      const raw = lines[i];
      let cleaned = raw.replace(/^\s*\/?\*+\/?\s?/, '').replace(/\*\/\s*$/, '').trim();
      if (cleaned.startsWith('@')) { i--; continue; }
      if (cleaned) docLines.unshift(cleaned);
      if (/^\s*\/\*\*/.test(raw) || /^\s*\/\*/.test(raw)) break;
      i--;
    }
  } else if (/^\s*\/\*\*/.test(lines[i]) || /^\s*\/\*/.test(lines[i])) {
    // 单行 JSDoc：/** ... */ 与 export 同行或紧邻上一行
    let cleaned = lines[i].replace(/^\s*\/?\*+\/?\s?/, '').replace(/\*\/\s*$/, '').trim();
    if (!cleaned.startsWith('@') && cleaned) docLines.push(cleaned);
  }
  if (docLines.length === 0) return '';

  const joined = docLines.join(' ');
  const firstSentence = joined.split(/(?<=[。.])\s/)[0] || joined;
  return firstSentence.slice(0, 90).trim();
}

const SRC_DIR = path.join(ROOT, 'frontend', 'src');
const OUT_FILE = path.join(ROOT, 'docs', 'function-map.md');

// gen-funcmap 只关心 .ts 文件（不含 .tsx），通过 walkSourceFiles 的 extensions 参数指定
const TS_EXT = ['.ts'];

// ── 模块分组 ──

function groupByModule(entries) {
  // 将文件按顶层目录分组
  const groups = new Map(); // groupName → { files: [{rel, syms}], description: '' }

  for (const { rel, file, syms } of entries) {
    if (syms.length === 0) continue;
    const top = rel.split('/')[0];
    if (!groups.has(top)) {
      groups.set(top, { files: [] });
    }
    groups.get(top).files.push({ rel, file, syms });
  }

  return groups;
}

// ── 组名映射（中文描述） ──

const GROUP_LABELS = {
  core: '核心基础设施',
  scene: '3D 场景',
  menus: '菜单 & UI',
  outfit: '换装 & 音频',
  'motion-algos': '动作算法',
  physics: '物理系统',
};

const GROUP_ORDER = ['core', 'scene', 'menus', 'outfit', 'motion-algos', 'physics'];

// ── 导出符号行号定位 ──

/**
 * 定位符号在文件内的 export 声明行号（1-based）。
 * 优先单行 export 声明；多行 export { ... } 块取块起始行；兜底符号首现行。
 * 与 check-consumers.mjs 的定位逻辑保持一致（同一视觉：file:line 可直接跳转）。
 */
function findExportLine(filePath, sym) {
  let text;
  try {
    text = fs.readFileSync(filePath, 'utf8');
  } catch {
    return null;
  }
  const lines = text.split('\n');
  const reSym = new RegExp(`\\b${escapeRe(sym)}\\b`);

  let line = lines.findIndex((l) => /^export\b/.test(l) && reSym.test(l));
  if (line === -1) {
    // 多行 export { ... } 块
    for (let idx = 0; idx < lines.length; idx++) {
      if (/^export\s*(?:type\s+)?\{/.test(lines[idx])) {
        let j = idx;
        while (j < lines.length && !lines[j].includes('}')) {
          if (reSym.test(lines[j])) { line = idx; break; }
          j++;
        }
        if (line !== -1) break;
      }
    }
  }
  if (line === -1) {
    line = lines.findIndex((l) => reSym.test(l));
  }
  return line === -1 ? null : line + 1;
}

// ── 渲染 Markdown ──

function renderMarkdown(groups, entries, scope) {
  const lines = [];
  const now = new Date().toISOString().slice(0, 10);

  lines.push(`# 函数映射表`);
  lines.push(``);
  lines.push(`> AI 找代码用。改前端功能时先 grep 此表定位文件。`);
  lines.push(`> **自动生成**（${now}）— 由 \`scripts/gen-funcmap.mjs\` 生成。`);
  if (scope) {
    lines.push(`> 当前 scope：\`${scope}\``);
  }
  lines.push(``);
  lines.push(`## 总览`);
  lines.push(``);
  lines.push(`| 模块 | 文件数 | 导出符号数 |`);
  lines.push(`|------|--------|-----------|`);
  for (const groupName of GROUP_ORDER) {
    const group = groups.get(groupName);
    if (!group) continue;
    const fileCount = group.files.length;
    const symCount = group.files.reduce((s, f) => s + f.syms.length, 0);
    const label = GROUP_LABELS[groupName] || groupName;
    lines.push(`| ${label} | ${fileCount} | ${symCount} |`);
  }
  lines.push(``);

  // 按组输出
  for (const groupName of GROUP_ORDER) {
    const group = groups.get(groupName);
    if (!group) continue;
    const label = GROUP_LABELS[groupName] || groupName;

    lines.push(`## ${label}`);
    lines.push(``);
    lines.push(`| 符号 | 文件:行 | 说明 |`);
    lines.push(`|------|--------|------|`);

    // 按文件排序
    const sortedFiles = [...group.files].sort((a, b) => a.rel.localeCompare(b.rel));
    for (const file of sortedFiles) {
      const displayPath = file.rel.replace(/\.ts$/, '');
      for (const sym of file.syms) {
        const doc = extractDocSummary(file.file, sym);
        const locLine = findExportLine(file.file, sym);
        const loc = locLine ? `${displayPath}:${locLine}` : displayPath;
        // [doc:vitepress] JSDoc 摘要可能含 HTML 尖括号（如 <iconify-icon> / <label>），
        // 文档站全量渲染时会被 Vue 编译器当标签解析导致构建失败，须转义。
        const escaped = doc ? doc.replace(/</g, '&lt;').replace(/>/g, '&gt;') : '';
        lines.push(`| \`${sym}()\` | \`${loc}\` | ${escaped || '—'} |`);
      }
    }
    lines.push(``);
  }

  lines.push(`---`);
  lines.push(``);
  lines.push(`> 说明列由 gen-funcmap 自动提取导出符号紧邻 JSDoc 的首句摘要（无 JSDoc 则留 —）。`);

  return lines.join('\n');
}

// ── 主流程 ──

function main() {
  const args = parseArgs(process.argv.slice(2), {
    bools: ['check'],
    strings: ['scope'],
  });

  const scope = args.scope;
  const isCheck = args.check;

  // 1. 扫描文件
  const allFiles = walkSourceFiles(SRC_DIR, SRC_DIR, '', TS_EXT);
  const files = scope
    ? allFiles.filter((f) => f.rel.startsWith(scope + '/'))
    : allFiles;

  console.error(`📄 扫描到 ${files.length} 个 TS 源文件${scope ? `（scope=${scope}）` : ''}`);

  // 2. 提取符号
  const entries = [];
  for (const f of files) {
    const syms = getExportedSymbols(f.file);
    if (syms.length > 0) {
      entries.push({ rel: f.rel, file: f.file, syms });
    }
  }

  console.error(`   提取到 ${entries.length} 个含导出符号的文件，共 ${entries.reduce((s, e) => s + e.syms.length, 0)} 个符号`);

  // 3. 分组
  const groups = groupByModule(entries);

  // 4. 渲染
  const output = renderMarkdown(groups, entries, scope);

  // 5. 输出或检查
  if (isCheck) {
    const existing = fs.existsSync(OUT_FILE) ? fs.readFileSync(OUT_FILE, 'utf8') : '';
    if (existing !== output) {
      console.error(`❌ ${OUT_FILE} 未同步，请运行：npm run gen:funcmap`);
      process.exit(1);
    }
    console.log(`✅ ${OUT_FILE} 已同步`);
  } else {
    fs.writeFileSync(OUT_FILE, output, 'utf8');
    console.log(`✅ 已写入 ${OUT_FILE}`);
  }
}

main();