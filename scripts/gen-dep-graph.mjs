#!/usr/bin/env node
/**
 * gen-dep-graph.mjs
 * 前端模块依赖图生成器 —— 扫描 frontend/src/ 的 TS 文件，提取 import 依赖，
 * 输出 Mermaid 图 / 列表 / JSON。
 *
 * 用法：
 *   node scripts/gen-dep-graph.mjs                        # Mermaid 图（stdout）
 *   node scripts/gen-dep-graph.mjs --format list           # 缩进列表
 *   node scripts/gen-dep-graph.mjs --format json           # JSON
 *   node scripts/gen-dep-graph.mjs --scope core            # 只分析 core/ 模块
 *   node scripts/gen-dep-graph.mjs --file docs/dep-graph.md # 写入文件
 *   node scripts/gen-dep-graph.mjs --check                 # 只检查是否已同步（需配合 --file）
 *
 * 零依赖（仅 node:fs / node:path）。
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { scanSourceGraph } from './_lib/source-graph.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const SRC_DIR = path.join(ROOT, 'frontend', 'src');

// ── 配置 ──

/** 生成安全的 Mermaid 节点 ID */
function toNodeId(rel) {
  return rel
    .replace(/\.tsx?$/i, '')
    .replace(/[\/\\\.-]/g, '_')
    .replace(/[^a-zA-Z0-9_]/g, '');
}

/** 文件路径 → 显示名 */
function toLabel(rel) {
  return rel.replace(/\.tsx?$/i, '');
}

// ── 输出格式 ──

function renderMermaid(entries, edges) {
  const lines = ['```mermaid', 'graph TD;'];
  // 按模块分组着色
  const modules = {};
  for (const e of entries) {
    const mod = e.rel.split('/')[0];
    if (!modules[mod]) modules[mod] = [];
    modules[mod].push(e);
  }

  let nodeId = 0;
  const nodeMap = new Map(); // rel → id

  for (const [mod, files] of Object.entries(modules).sort()) {
    lines.push('');
    for (const f of files) {
      const id = `n${nodeId++}`;
      nodeMap.set(f.rel, id);
      // 用文件 basename 作为标签，保留路径在 tooltip 中
      const label = f.rel;
      lines.push(`    ${id}["${label}"]`);
    }
  }

  lines.push('');
  for (const [from, to] of edges) {
    const fromId = nodeMap.get(from);
    const toId = nodeMap.get(to);
    if (fromId && toId) {
      lines.push(`    ${fromId} --> ${toId};`);
    }
  }

  lines.push('```');
  return lines.join('\n');
}

function renderList(entries, edges) {
  // 构建依赖树：from → [tos]
  const depMap = new Map();
  for (const e of entries) {
    depMap.set(e.rel, []);
  }
  for (const [from, to] of edges) {
    if (depMap.has(from)) {
      depMap.get(from).push(to);
    }
  }

  const lines = [];
  const sorted = entries.map((e) => e.rel).sort();
  for (const rel of sorted) {
    const deps = depMap.get(rel) || [];
    lines.push(`${rel}`);
    for (const dep of deps.sort()) {
      lines.push(`  └─ ${dep}`);
    }
    lines.push('');
  }
  return lines.join('\n');
}

function renderJson(entries, edges) {
  const depMap = new Map();
  for (const e of entries) {
    depMap.set(e.rel, []);
  }
  for (const [from, to] of edges) {
    if (depMap.has(from)) {
      depMap.get(from).push(to);
    } else {
      depMap.set(from, [to]);
    }
  }

  const obj = {};
  for (const [rel, deps] of [...depMap.entries()].sort()) {
    obj[rel] = deps.sort();
  }
  return JSON.stringify(obj, null, 2);
}

// ── 主流程 ──

function main() {
  const args = process.argv.slice(2);

  const formatIdx = args.indexOf('--format');
  const format = formatIdx !== -1 && args[formatIdx + 1]
    ? args[formatIdx + 1] : 'mermaid';

  const scopeIdx = args.indexOf('--scope');
  const scope = scopeIdx !== -1 && args[scopeIdx + 1]
    ? args[scopeIdx + 1] : null;

  const fileIdx = args.indexOf('--file');
  const outFile = fileIdx !== -1 && args[fileIdx + 1]
    ? path.resolve(ROOT, args[fileIdx + 1]) : null;

  const isCheck = args.includes('--check');

  if (!['mermaid', 'list', 'json'].includes(format)) {
    console.error(`❌ 不支持的格式：${format}（可选：mermaid / list / json）`);
    process.exit(1);
  }

  // 1. 扫描文件
  const allFiles = scanSourceGraph(SRC_DIR).files;
  console.error(`📄 扫描到 ${allFiles.length} 个 TS 源文件`);

  // 按 scope 过滤
  const files = scope
    ? allFiles.filter((f) => f.rel.startsWith(scope + '/'))
    : allFiles;

  console.error(`   scope${scope ? `=${scope}` : '=全部'} → ${files.length} 个文件`);

  // 2. 解析依赖
  const entries = files;
  const graph = scanSourceGraph(SRC_DIR, { scope }).graph;
  const edges = [...graph.entries()].flatMap(([from, deps]) => [...deps].map((to) => [from, to]));

  console.error(`   解析到 ${edges.length} 条依赖边`);

  // 3. 渲染输出
  let output;
  switch (format) {
    case 'mermaid':
      output = renderMermaid(entries, edges);
      break;
    case 'list':
      output = renderList(entries, edges);
      break;
    case 'json':
      output = renderJson(entries, edges);
      break;
  }

  // 4. 输出或检查
  if (outFile) {
    // 写入文件
    if (isCheck) {
      // 检查文件是否已同步
      const existing = fs.existsSync(outFile) ? fs.readFileSync(outFile, 'utf8') : '';
      if (existing !== output) {
        console.error(`❌ ${outFile} 未同步，请运行：npm run dep:graph`);
        process.exit(1);
      }
      console.log(`✅ ${outFile} 已同步`);
    } else {
      fs.writeFileSync(outFile, output, 'utf8');
      console.log(`✅ 已写入 ${outFile}`);
    }
  } else {
    // 输出到控制台
    console.log(output);
  }

  console.error(`   格式=${format} 文件=${outFile || 'stdout'}`);
}

main();
