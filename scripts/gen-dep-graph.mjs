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

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const SRC_DIR = path.join(ROOT, 'frontend', 'src');

// ── 配置 ──

const EXCLUDE_DIRS = [
  '__tests__', '__mocks__', 'node_modules', 'wailsjs',
];

const EXCLUDE_FILES = [
  /\.d\.ts$/, /\.test\.ts$/, /\.spec\.ts$/, /\.gen\.ts$/,
];

// 已知外部包前缀（不走相对路径解析，仅标注为「外部」）
const EXTERNAL_PREFIXES = [
  '@', 'babylonjs', 'babylon-mmd', 'react', 'vue', 'svelte',
];

// ── 工具 ──

function isSourceFile(name) {
  if (!name.endsWith('.ts')) return false;
  if (EXCLUDE_FILES.some((re) => re.test(name))) return false;
  return true;
}

function shouldTraverseDir(name) {
  return !name.startsWith('.') && !EXCLUDE_DIRS.includes(name);
}

/** 递归扫描 frontend/src/ 下所有 TS 源文件 */
function walkDir(dir, base = '') {
  const entries = [];
  if (!fs.existsSync(dir)) return entries;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    const rel = base ? `${base}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      if (shouldTraverseDir(entry.name)) {
        entries.push(...walkDir(full, rel));
      }
    } else if (entry.isFile() && isSourceFile(entry.name)) {
      entries.push({ file: full, rel });
    }
  }
  return entries;
}

/** 解析 .ts 文件中的 import 语句，返回依赖的相对路径列表 */
function parseImports(filePath, relPath) {
  const text = fs.readFileSync(filePath, 'utf8');
  const deps = new Set();
  const dir = path.dirname(filePath);

  // 匹配 import ... from '...' 和 import '...'
  const re = /(?:^|\n)\s*import(?:[\s\S]*?)\s+from\s+['"]([^'"]+)['"]|(?:^|\n)\s*import\s+['"]([^'"]+)['"]/g;
  let m;
  while ((m = re.exec(text))) {
    const spec = m[1] || m[2];
    if (!spec) continue;
    // 跳过外部包
    if (EXTERNAL_PREFIXES.some((p) => spec.startsWith(p))) continue;
    // 跳过以 @/ 开头的别名导入（内部模块，但不做路径解析）
    if (spec.startsWith('@/')) {
      // 将 @/xxx 转换为 frontend/src/xxx 的相对路径
      const resolved = spec.replace(/^@\//, '');
      deps.add(resolved);
      continue;
    }
    // 相对路径
    if (spec.startsWith('.')) {
      const resolved = path.resolve(dir, spec);
      // 尝试多种扩展名
      const candidates = [resolved + '.ts', resolved + '.tsx', resolved + '/index.ts', resolved + '/index.tsx'];
      const found = candidates.find((c) => fs.existsSync(c));
      if (found) {
        const rel = path.relative(SRC_DIR, found).replace(/\\/g, '/');
        deps.add(rel);
      }
      // 还要处理 .js 导入（在 Vite 中 TS 文件常被 import 为 .js）
      // 也尝试 .mjs
      // 实际上更简单：直接找 resolved 目录下的 index.ts
      continue;
    }
  }
  return [...deps];
}

/** 生成安全的 Mermaid 节点 ID */
function toNodeId(rel) {
  return rel
    .replace(/\.ts$/i, '')
    .replace(/[\/\\\.-]/g, '_')
    .replace(/[^a-zA-Z0-9_]/g, '');
}

/** 文件路径 → 显示名 */
function toLabel(rel) {
  return rel.replace(/\.ts$/i, '');
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
  const allFiles = walkDir(SRC_DIR);
  console.error(`📄 扫描到 ${allFiles.length} 个 TS 源文件`);

  // 按 scope 过滤
  const files = scope
    ? allFiles.filter((f) => f.rel.startsWith(scope + '/'))
    : allFiles;

  console.error(`   scope${scope ? `=${scope}` : '=全部'} → ${files.length} 个文件`);

  // 2. 解析依赖
  const entries = [];
  const edges = [];
  for (const f of files) {
    const deps = parseImports(f.file, f.rel);
    entries.push(f);
    for (const dep of deps) {
      edges.push([f.rel, dep]);
    }
  }

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