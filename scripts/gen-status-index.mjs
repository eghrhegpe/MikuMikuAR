#!/usr/bin/env node
/**
 * gen-status-index.mjs — 从 ADR 文件首部自动生成状态索引表，替换 docs/status.md 中标记区域。
 *
 * 用法：
 *   node scripts/gen-status-index.mjs              # 生成并写入（升序）
 *   node scripts/gen-status-index.mjs --reverse    # 生成并写入（倒序，最新在前）
 *   node scripts/gen-status-index.mjs --check      # 只检查是否已同步
 *
 * 前置条件：
 *   - docs/status.md 包含 <!-- GEN:ADR_INDEX start --> 和 <!-- GEN:ADR_INDEX end --> 标记
 *   - docs/adr/adr-*.md 文件首部格式一致（见下方）
 *
 * ADR 文件首部契约（解析依赖以下格式，修改时请保持一致）：
 * ```
 * # ADR-NNN: 标题
 * > **状态**: xxx
 * > **日期**: yyyy-mm-dd
 * ```
 *
 * 零依赖（仅 node:fs / node:path）。
 * 设计意图：状态索引生成器
 * 退出码：1（失败）
 */

import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from './_lib/parse-args.mjs';
import { ROOT } from './_lib/scan-files.mjs';
import { parseAdrHeader } from './_lib/frontmatter.mjs';

const args = parseArgs(process.argv.slice(2), { bools: ['reverse', 'check'], strings: [], defaults: {} });
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
const ADR_DIR = path.join(ROOT, 'docs', 'adr');
const STATUS_FILE = path.join(ROOT, 'docs', 'status.md');

const MARKER_START = '<!-- GEN:ADR_INDEX start -->';
const MARKER_END   = '<!-- GEN:ADR_INDEX end -->';

// ── 解析单个 ADR 文件 ──

// [P2] 首部解析收口共享库 _lib/frontmatter.mjs 的 parseAdrHeader：
// 兼容三种首部格式 + 无冒号标题 + `---` 早停（本文件此前手写正则复制，已实际漂移）。
// parseAdrHeader 返回 { num, title, status, date, statusLine } 或 { error }，错误文案与旧实现兼容。
function parseAdr(filePath) {
  const hdr = parseAdrHeader(filePath);
  if (hdr.error) return { error: hdr.error };

  // 若状态行未包含日期，追加日期（与旧实现行为一致）
  let statusDisplay = hdr.status;
  if (hdr.date && !hdr.status.includes(hdr.date)) {
    statusDisplay = `${hdr.status}（${hdr.date}）`;
  }

  return { num: hdr.num, title: hdr.title, status: statusDisplay };
}

// ── 生成 Markdown 表格 ──

function generateTable(entries) {
  const rows = entries.map((e) => {
    const adr = `ADR-${e.num}`;
    // 转义标题中的管道符，避免破坏表格
    const safeTitle = e.title.replace(/\|/g, '\\|');
    // 状态文本里的 ADR 链接在 docs/adr/ 下有效（如 `](adr-xxx.md)`），
    // 搬进 docs/status.md（docs/ 下）后需补 `adr/` 前缀，否则 md-links 断链。
    const statusLinked = e.status.replace(/\]\(adr-([^)\s]+\.md)\)/g, '](adr/adr-$1)');
    const safeStatus = statusLinked.replace(/\|/g, '\\|');
    return `| ${adr} | ${safeTitle} | ${safeStatus} |`;
  });

  const header = [
    '| ADR | 主题 | 状态 |',
    '|-----|------|------|',
  ];

  return [...header, ...rows].join('\n') + '\n';
}

function replaceGeneratedRegion(statusMd, table) {
  const startIdx = statusMd.indexOf(MARKER_START);
  const endIdx = statusMd.indexOf(MARKER_END);

  if (startIdx === -1 || endIdx === -1) {
    throw new Error(`status.md 中未找到标记（${MARKER_START} / ${MARKER_END}）`);
  }

  if (startIdx >= endIdx) {
    throw new Error('status.md 中标记顺序错误：start 在 end 之后');
  }

  const replacement = `${MARKER_START}\n\n${table}\n${MARKER_END}`;
  return statusMd.slice(0, startIdx) + replacement + statusMd.slice(endIdx + MARKER_END.length);
}

// ── 主流程 ──

function main() {
  // 1. 扫描 ADR 文件
  if (!fs.existsSync(ADR_DIR)) {
    console.error(`❌ ADR 目录不存在：${ADR_DIR}`);
    process.exit(1);
  }

  const files = fs.readdirSync(ADR_DIR)
    .filter((f) => /^adr-[\d.]+-.+\.md$/.test(f))
    .sort(); // 按文件名排序本质就是按编号排序

  const entries = [];
  const errors = [];
  for (const f of files) {
    const entry = parseAdr(path.join(ADR_DIR, f));
    if (entry?.error) {
      errors.push(`${f}：${entry.error}`);
    } else if (entry) {
      entries.push(entry);
    }
  }

  if (errors.length) {
    console.error('❌ ADR 首部不符合状态索引契约：');
    errors.forEach((error) => console.error(`   ${error}`));
    process.exit(1);
  }

  const isReverse = args.reverse;

  // 按编号排序
  entries.sort((a, b) => a.num - b.num);
  if (isReverse) {
    entries.reverse();
  }

  console.log(`📄 扫描到 ${entries.length} 个 ADR 文件`);

  // 2. 生成表格
  const table = generateTable(entries);

  // 3. 替换 status.md 中的标记区域
  if (!fs.existsSync(STATUS_FILE)) {
    console.error(`❌ status.md 不存在：${STATUS_FILE}`);
    process.exit(1);
  }

  const statusMd = fs.readFileSync(STATUS_FILE, 'utf8');
  let expected;
  try {
    expected = replaceGeneratedRegion(statusMd, table);
  } catch (error) {
    console.error(`❌ ${error.message}`);
    console.error('请在 ADR 索引表区域的首尾分别插入生成标记。');
    process.exit(1);
  }

  if (args.check) {
    if (expected !== statusMd) {
      console.error('❌ docs/status.md 的 ADR 索引未同步，请运行：npm run gen:status');
      process.exit(1);
    }
    console.log(`✅ docs/status.md ADR 索引已同步（${entries.length} 行）`);
    return;
  }

  fs.writeFileSync(STATUS_FILE, expected, 'utf8');

  console.log(`✅ 已更新 ${STATUS_FILE}`);
  console.log(`   生成 ${entries.length} 行 ADR 索引`);
}

main();
