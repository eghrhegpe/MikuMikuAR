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
 * 零依赖（仅 node:fs / node:path）。
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const SRC_DIR = path.join(ROOT, 'frontend', 'src');
const OUT_FILE = path.join(ROOT, 'docs', 'function-map.md');

const EXCLUDE_DIRS = ['__tests__', '__mocks__', 'node_modules', 'wailsjs'];
const EXCLUDE_FILES = [/\.d\.ts$/, /\.test\.ts$/, /\.spec\.ts$/, /\.gen\.ts$/];

// ── 扫描 ──

function isSourceFile(name) {
  if (!name.endsWith('.ts')) return false;
  return !EXCLUDE_FILES.some((re) => re.test(name));
}

function shouldTraverseDir(name) {
  return !name.startsWith('.') && !EXCLUDE_DIRS.includes(name);
}

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

// ── 提取导出符号 ──

function getExportedSymbols(filePath) {
  const text = fs.readFileSync(filePath, 'utf8');
  const syms = new Set();

  // export function / const / let / class / interface / type / enum / async function
  const re1 = /^export\s+(?:async\s+)?(?:function|const|let|class|interface|type|enum)\s+([A-Za-z0-9_]+)/gm;
  let m;
  while ((m = re1.exec(text))) syms.add(m[1]);

  // export { a, b, c }
  const re2 = /^export\s*\{([^}]+)\}/gm;
  while ((m = re2.exec(text))) {
    m[1].split(',').forEach((s) => {
      const name = s.trim().split(/\s+as\s+/).pop().trim();
      if (name && /^[A-Za-z0-9_]+$/.test(name)) syms.add(name);
    });
  }

  // export default function/class
  const re3 = /^export\s+default\s+(?:function|class)\s+([A-Za-z0-9_]+)/gm;
  while ((m = re3.exec(text))) syms.add(m[1]);

  // export default <name> (after declaration)
  const re4 = /^export\s+default\s+([A-Za-z0-9_]+)\s*$/gm;
  while ((m = re4.exec(text))) syms.add(m[1]);

  return [...syms].sort();
}

// ── 模块分组 ──

function groupByModule(entries) {
  // 将文件按顶层目录分组
  const groups = new Map(); // groupName → { files: [{rel, syms}], description: '' }

  for (const { rel, syms } of entries) {
    if (syms.length === 0) continue;
    const top = rel.split('/')[0];
    if (!groups.has(top)) {
      groups.set(top, { files: [] });
    }
    groups.get(top).files.push({ rel, syms });
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
    lines.push(`| 符号 | 文件 | 说明 |`);
    lines.push(`|------|------|------|`);

    // 按文件排序
    const sortedFiles = [...group.files].sort((a, b) => a.rel.localeCompare(b.rel));
    for (const file of sortedFiles) {
      const displayPath = file.rel.replace(/\.ts$/, '');
      for (const sym of file.syms) {
        lines.push(`| \`${sym}()\` | \`${displayPath}\` | — |`);
      }
    }
    lines.push(``);
  }

  lines.push(`---`);
  lines.push(``);
  lines.push(`> 共 ${entries.length} 个文件，${entries.reduce((s, e) => s + e.syms.length, 0)} 个导出符号。`);
  lines.push(`> 说明列（—）待知识库或人工补充。`);

  return lines.join('\n');
}

// ── 主流程 ──

function main() {
  const args = process.argv.slice(2);
  const scopeIdx = args.indexOf('--scope');
  const scope = scopeIdx !== -1 && args[scopeIdx + 1] ? args[scopeIdx + 1] : null;
  const isCheck = args.includes('--check');

  // 1. 扫描文件
  const allFiles = walkDir(SRC_DIR);
  const files = scope
    ? allFiles.filter((f) => f.rel.startsWith(scope + '/'))
    : allFiles;

  console.error(`📄 扫描到 ${files.length} 个 TS 源文件${scope ? `（scope=${scope}）` : ''}`);

  // 2. 提取符号
  const entries = [];
  for (const f of files) {
    const syms = getExportedSymbols(f.file);
    if (syms.length > 0) {
      entries.push({ rel: f.rel, syms });
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