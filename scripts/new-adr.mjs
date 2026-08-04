#!/usr/bin/env node
/**
 * new-adr.mjs — 生成新 ADR 文件模板（含占号防并发机制）。
 *
 * 自动获取下一个 ADR 编号（本地目录 与 origin/main 取较大者 +1，防本地落后远端撞号），
 * 按 gen-status-index.mjs 契约生成标准格式。
 *
 * 内置两道防并发防线：
 *   1. 原子占位（wx / O_EXCL）：目标编号文件已存在则 EEXIST 失败退出，杜绝 TOCTOU 静默覆盖。
 *   2. 算号合并 origin/main：本地未 fetch 的新号不会与远端已立档的号冲突。
 *
 * 支持 --reserve / --占位 占号模式：先立空壳 ADR（状态=规划）占号，待并行任务完成后立档。
 *
 * 用法：
 *   node scripts/new-adr.mjs "标题"                        # 无副标题
 *   node scripts/new-adr.mjs "标题" "副标题"               # 有副标题
 *   node scripts/new-adr.mjs "标题" "副标题" "进行中"      # 自定义状态
 *   node scripts/new-adr.mjs --reserve "标题"              # 占号模式（状态=规划，空壳）
 *
 * 零依赖，仅 node:fs / node:path / node:child_process。
 * 设计意图：ADR 新建工具（占号防撞）
 * 退出码：1（失败）
 */

import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { parseArgs } from './_lib/parse-args.mjs';

const ADR_DIR = path.resolve(process.cwd(), 'docs/adr');

// 占号模式：先立空壳 ADR 占号，状态=规划，待并行 AI 立档
const reserve = process.argv.includes('--reserve') || process.argv.includes('--占位');
const rawArgv = process.argv.filter(a => a !== '--reserve' && a !== '--占位');

// 位置参数（标题/副标题/状态）走 parseArgs 的 `_` 收集，统一参数解析
const { _: positional } = parseArgs(rawArgv.slice(2), { bools: [], strings: [], defaults: {} });
const title = positional[0];
let subtitle = positional[1] || '';
let status = positional[2] || '提案';

if (!title) {
  console.error('用法: node scripts/new-adr.mjs "标题" ["副标题"] ["状态"] [--reserve]');
  process.exit(1);
}

// 取得编号：本地目录 与 origin/main 取较大者 +1（防本地落后远端撞号）
function maxAdrNumFrom(list) {
  // 兼容本地（adr-NNN-slug.md）与远端（docs/adr/adr-NNN-slug.md 带路径前缀）两种返回
  const nums = list
    .map(f => { const m = f.match(/adr-(\d+)-/); return m ? parseInt(m[1], 10) : 0; })
    .filter(n => n > 0);
  return nums.length > 0 ? Math.max(...nums) : 0;
}

const localFiles = fs.readdirSync(ADR_DIR).filter(f => /^adr-\d+-/.test(f));
const localMax = maxAdrNumFrom(localFiles);
let remoteMax = 0;
let mergedRemote = false;

// 合并远端已立档的号，避免本地未 fetch 时撞号（离线 / 无 origin / 未 fetch 则降级为仅本地）
try {
  const remoteOut = execSync('git ls-tree -r --name-only origin/main -- docs/adr', {
    cwd: process.cwd(),
    stdio: 'pipe',
  }).toString();
  const remoteFiles = remoteOut.split('\n').map(s => s.trim()).filter(Boolean);
  if (remoteFiles.length) { remoteMax = maxAdrNumFrom(remoteFiles); mergedRemote = true; }
} catch {
  // 降级路径：无 origin/main 远端引用时仅用本地编号，不阻断创建
}
const next = Math.max(localMax + 1, remoteMax + 1);

if (reserve) {
  status = '规划';
}

// 生成文件名
const slug = title
  .toLowerCase()
  .replace(/[^a-z0-9\u4e00-\u9fff]+/g, '-')
  .replace(/^-|-$/g, '');
const filename = `adr-${next}-${slug}.md`;
const filepath = path.join(ADR_DIR, filename);

// 原子占位（wx = O_EXCL）：目标编号文件已存在则 EEXIST 失败退出，
// 杜绝并发同号时的 TOCTOU 竞态静默覆盖。
let fd;
try {
  fd = fs.openSync(filepath, 'wx');
} catch (e) {
  if (e && e.code === 'EEXIST') {
    const srcNote = mergedRemote ? `本地最大 ${localMax} / 远端最大 ${remoteMax}` : `本地最大 ${localMax}`;
    console.error(`❌ ADR-${next} 编号已被占用（${filepath} 已存在），疑似并发创建或本地落后远端。`);
    console.error(`   当前 ${srcNote}，请先 \`git fetch\` 再从最大号 +1 重新运行，或人工核对编号。`);
    process.exit(1);
  }
  throw e;
}
fs.writeSync(fd, content0(title, subtitle, status, next, reserve));
fs.closeSync(fd);

const srcNote = mergedRemote ? `本地最大 ${localMax} / 远端最大 ${remoteMax}` : `本地最大 ${localMax}`;
console.log(`✅ 已创建 ADR-${next}: ${subtitle ? `${title} — ${subtitle}` : title}${reserve ? '（占号模式）' : ''}`);
console.log(`   ℹ 编号分配：${srcNote} → ADR-${next}`);
console.log(`   文件: ${filepath}`);
console.log(`   > **状态**: ${status}（${new Date().toISOString().slice(0, 10)}）`);

// 自动同步 docs/status.md 的 ADR 索引（仅重写 GEN:ADR_INDEX 标记区，不破坏手写区）
try {
  execSync('node scripts/gen-status-index.mjs --reverse', { cwd: process.cwd(), stdio: 'pipe' });
  console.log('✅ 已自动同步 docs/status.md 的 ADR 索引');
} catch (err) {
  console.warn('⚠ 自动同步 status.md 失败（ADR 文件已创建），请手动运行: npm run gen:status');
  if (err && err.message) console.warn('   ' + err.message.split('\n')[0]);
}

/**
 * 生成 ADR 正文。
 * @param {string} t 标题
 * @param {string} sub 副标题
 * @param {string} st 状态
 * @param {number} n 编号
 * @param {boolean} r 是否占号模式
 */
function content0(t, sub, st, n, r) {
  const today = new Date().toISOString().slice(0, 10);
  const fullTitle = sub ? `${t} — ${sub}` : t;
  return `# ADR-${n}: ${fullTitle}

> **状态**: ${st}（${today}）
> **日期**: ${today}
${r ? '\n> **占号**: 本 ADR 为占位立档，待并行任务完成后补充正文。\n' : ''}
## 背景

<!-- 为什么要做这个决策？解决了什么问题？ -->

## 决策

<!-- 做了什么决定？ -->

## 备选方案

<!-- 考虑了哪些方案？为什么没选？ -->

## 影响

<!-- 涉及哪些文件？需要同步修改什么？ -->

## 相关文档

<!-- 关联的 ADR / 知识卡 / 代码文件 -->
`;
}
