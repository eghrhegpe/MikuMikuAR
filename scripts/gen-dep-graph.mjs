#!/usr/bin/env node
/**
 * gen-dep-graph.mjs — 前端模块依赖图生成器 —— 扫描 frontend/src/ 的 TS 文件，提取 import 依赖，
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
 * 设计意图：依赖图生成器
 * 退出码：1（失败）
 */

import fs from 'node:fs';
import path from 'node:path';
import { scanSourceGraph } from './_lib/source-graph.mjs';
import { parseArgs } from './_lib/parse-args.mjs';
import { ROOT } from './_lib/scan-files.mjs';

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
    // [P2 2026-08-08] 组内按 rel 排序：walk（readdir）无 sort，跨 OS 目录顺序不同 →
    // 节点 ID 随顺序分配会整体重编号 → Mermaid 输出跨机器不确定、--check 不幂等。
    // 与 list 格式 `entries.map(e => e.rel).sort()` 对齐。
    files.sort((a, b) => a.rel.localeCompare(b.rel));
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
  const args = parseArgs(process.argv.slice(2), {
    bools: ['check', 'local-only'],
    strings: ['format', 'scope', 'file'],
    defaults: { format: 'mermaid', scope: null, file: null },
  });
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

  const format = args.format;
  const scope = args.scope;
  const outFile = args.file ? path.resolve(ROOT, args.file) : null;
  const isCheck = args.check;
  const localOnly = args['local-only'];

  if (!['mermaid', 'list', 'json'].includes(format)) {
    console.error(`❌ 不支持的格式：${format}（可选：mermaid / list / json）`);
    process.exit(1);
  }

  // 1. 扫描文件 + 解析依赖（scope 递归展开依赖，--local-only 限制 scope 内）
  const { files, graph } = scanSourceGraph(SRC_DIR, { scope, localOnly });
  // [P2 2026-08-08] frontend/src 缺失守卫：子模块未检出/错误 cwd 时 walk 返回 []，
  // 旧实现打印「0 个文件」后 exit 0 输出空图（可能把空图写进文档）。缺失即明确失败。
  if (files.length === 0) {
    if (!fs.existsSync(SRC_DIR)) {
      console.error(`❌ frontend/src 目录不存在：${SRC_DIR}（子模块未检出或 cwd 错误）`);
      process.exit(1);
    }
    console.error(`❌ 未扫描到任何 TS 文件（srcDir=${SRC_DIR}），疑似扫描异常`);
    process.exit(1);
  }
  console.error(`📄 ${scope ? `scope=${scope}${localOnly ? ' (local-only)' : ''}` : '全部'} → ${files.length} 个文件`);
  const edges = [...graph.entries()].flatMap(([from, deps]) => [...deps].map((to) => [from, to]));
  console.error(`   解析到 ${edges.length} 条依赖边`);

  const entries = files;

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
      // [P2 2026-08-08] 兼容重定向产物格式：docs/dep-graph.md 由 `npm run dep:graph > file`
      // 生成，含 npm 头部 + stderr 计数行（📄/解析到/格式=）+ mermaid 块——整串比对必失败。
      // 提取 existing 与 output 中的 ```mermaid ... ``` 块核心比对（尾部格式行/计数行忽略）。
      const extractBlock = (s) => {
        const m = s.match(/```mermaid\n([\s\S]*?)\n```/);
        return m ? m[1] : s;
      };
      if (extractBlock(existing) !== extractBlock(output)) {
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
