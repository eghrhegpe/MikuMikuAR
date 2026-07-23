#!/usr/bin/env node
/**
 * gen-status-index.mjs
 * 从 ADR 文件首部自动生成状态索引表，替换 docs/status.md 中标记区域。
 *
 * 用法：
 *   node scripts/gen-status-index.mjs
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
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const ADR_DIR = path.join(ROOT, 'docs', 'adr');
const STATUS_FILE = path.join(ROOT, 'docs', 'status.md');

const MARKER_START = '<!-- GEN:ADR_INDEX start -->';
const MARKER_END   = '<!-- GEN:ADR_INDEX end -->';

// ── 解析单个 ADR 文件 ──

function parseAdr(filePath) {
  const text = fs.readFileSync(filePath, 'utf8');
  const lines = text.split(/\r?\n/);

  let num = null;
  let title = '';
  let status = '';
  let date = '';

  for (let i = 0; i < Math.min(lines.length, 20); i++) {
    const line = lines[i];

    // # ADR-NNN: Title
    const mTitle = line.match(/^#\s+ADR-(\d+):\s*(.+)/);
    if (mTitle) {
      num = parseInt(mTitle[1], 10);
      title = mTitle[2].trim();
      continue;
    }

    // > **状态**: xxx
    const mStatus = line.match(/^>\s*\*\*状态\*\*:\s*(.+)/);
    if (mStatus) {
      status = mStatus[1].trim();
      continue;
    }

    // > **日期**: yyyy-mm-dd
    const mDate = line.match(/^>\s*\*\*日期\*\*:\s*(.+)/);
    if (mDate) {
      date = mDate[1].trim();
      continue;
    }
  }

  if (num === null) {
    console.warn(`⚠️  跳过 ${path.basename(filePath)}：未找到 ADR 编号`);
    return null;
  }

  // 若状态行未包含日期，追加日期
  let statusDisplay = status;
  if (date && !status.includes(date)) {
    statusDisplay = `${status}（${date}）`;
  }

  return { num, title, status: statusDisplay };
}

// ── 生成 Markdown 表格 ──

function generateTable(entries) {
  const rows = entries.map((e) => {
    const adr = `ADR-${e.num}`;
    // 转义标题中的管道符，避免破坏表格
    const safeTitle = e.title.replace(/\|/g, '\\|');
    const safeStatus = e.status.replace(/\|/g, '\\|');
    return `| ${adr} | ${safeTitle} | ${safeStatus} |`;
  });

  const header = [
    '| ADR | 主题 | 状态 |',
    '|-----|------|------|',
  ];

  return [...header, ...rows].join('\n') + '\n';
}

// ── 主流程 ──

function main() {
  // 1. 扫描 ADR 文件
  if (!fs.existsSync(ADR_DIR)) {
    console.error(`❌ ADR 目录不存在：${ADR_DIR}`);
    process.exit(1);
  }

  const files = fs.readdirSync(ADR_DIR)
    .filter((f) => /^adr-\d+-.+\.md$/.test(f))
    .sort(); // 按文件名排序本质就是按编号排序

  const entries = [];
  for (const f of files) {
    const entry = parseAdr(path.join(ADR_DIR, f));
    if (entry) entries.push(entry);
  }

  // 按编号升序排列
  entries.sort((a, b) => a.num - b.num);

  console.log(`📄 扫描到 ${entries.length} 个 ADR 文件`);

  // 2. 生成表格
  const table = generateTable(entries);

  // 3. 替换 status.md 中的标记区域
  if (!fs.existsSync(STATUS_FILE)) {
    console.error(`❌ status.md 不存在：${STATUS_FILE}`);
    process.exit(1);
  }

  let statusMd = fs.readFileSync(STATUS_FILE, 'utf8');

  const startIdx = statusMd.indexOf(MARKER_START);
  const endIdx   = statusMd.indexOf(MARKER_END);

  if (startIdx === -1 || endIdx === -1) {
    console.error(`❌ status.md 中未找到标记（${MARKER_START} / ${MARKER_END}）`);
    console.error('请在 ADR 索引表区域的首尾分别插入这两行标记。');
    process.exit(1);
  }

  if (startIdx >= endIdx) {
    console.error('❌ status.md 中标记顺序错误：start 在 end 之后');
    process.exit(1);
  }

  const replacement = `${MARKER_START}\n\n${table}\n${MARKER_END}`;
  const before = statusMd.slice(0, startIdx);
  const after  = statusMd.slice(endIdx + MARKER_END.length);
  statusMd = before + replacement + after;

  fs.writeFileSync(STATUS_FILE, statusMd, 'utf8');

  console.log(`✅ 已更新 ${STATUS_FILE}`);
  console.log(`   生成 ${entries.length} 行 ADR 索引`);
}

main();