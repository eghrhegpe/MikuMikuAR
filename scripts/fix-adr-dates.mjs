#!/usr/bin/env node
/**
 * fix-adr-dates.mjs — 为缺失「日期行」的 ADR 补 `> **日期**: yyyy-mm-dd`。
 *
 * 与 fix-adr-format.mjs 分工:那个修格式,本脚本补缺失字段。
 * 日期来源(按优先级):
 *   1. 首部 20 行内最早出现的 yyyy-mm-dd(状态行/来源行/正文日期)
 *   2. 无首部日期时,用 FALLBACK 表(取自 git 创建日期,已核实)
 *   3. 两者都无 → 跳过并报告(需人工确认)
 *
 * 插入位置:状态行之后(状态行缺失时退到标题行之后),保持首部 blockquote 连续性。
 *
 * 用法:
 *   node scripts/fix-adr-dates.mjs            # 补全部
 *   node scripts/fix-adr-dates.mjs adr-066-*  # 只补指定文件
 *
 * 零依赖,仅 node:fs / node:path。保留原文件换行风格(CRLF/LF)。
 * 退出码：0（无 process.exit 调用）
 * 设计意图：ADR 日期修复工具
 */

import fs from 'node:fs';
import path from 'node:path';

const ADR_DIR = path.resolve(process.cwd(), 'docs/adr');
const targets = process.argv.slice(2);

// 首部 20 行内无日期的 ADR → git 创建日期(2026-08-02 核实)
const FALLBACK = {
  'adr-066-fullscreen-resource-library.md': '2026-07-08',
  'adr-089-ground-mode-split.md': '2026-07-12',
  'adr-091-ground-texture-unification.md': '2026-07-12',
  'adr-092-unified-texture-reflection.md': '2026-07-12',
  'adr-101-utility-logic-consolidation-wave2.md': '2026-07-13',
  'adr-117-go-error-i18n.md': '2026-07-16',
  'adr-118-refresh-rate-aware-degradation.md': '2026-07-16',
  'adr-220-schema-integrity-metatest.md': '2026-07-31',
  'adr-221-per-material-alpha.md': '2026-08-01',
  'adr-229-e2e-automation-advancement.md': '2026-08-02',
};

const DATE_FIELD_RE = [
  /^>\s*\*\*日期\*\*\s*[：:]\s*(.+)/,
  /^[-*]\s*\*\*日期\*\*\s*[：:]\s*(.+)/,
  /^\s*\*\*日期\*\*\s*[：:]\s*(.+)/,
  /^\|\s*\*\*日期\*\*\s*\|\s*(.+?)\s*\|\s*$/,
];

function hasDateField(lines) {
  return lines.slice(0, 20).some((l) => DATE_FIELD_RE.some((r) => r.test(l)));
}

let files = targets.length > 0
  ? targets.filter((f) => /^adr-[\d.]+-.+\.md$/.test(f))
  : fs.readdirSync(ADR_DIR).filter((f) => /^adr-[\d.]+-.+\.md$/.test(f)).sort();

let filled = 0;
const skipped = [];

for (const f of files) {
  const fp = path.join(ADR_DIR, f);
  if (!fs.existsSync(fp)) { console.warn(`⚠️  跳过 ${f}:文件不存在`); continue; }
  const text = fs.readFileSync(fp, 'utf8');
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const lines = text.split(/\r?\n/);

  if (hasDateField(lines)) continue; // 已有日期行

  // 取日期:首部最早日期 → fallback
  const head = lines.slice(0, 20).join('\n');
  const m = head.match(/20\d{2}-\d{2}-\d{2}/);
  const date = m ? m[0] : FALLBACK[f];
  if (!date) { skipped.push(f); continue; }

  // 插入位置:状态行之后(找不到则标题后)
  const titleIdx = lines.findIndex((l) => /^#\s+ADR-\d+/.test(l));
  const statusIdx = lines.findIndex((l) => /^\s*[-*>|]?\s*\*\*状态\*\*/.test(l));
  const insertAt = (statusIdx > titleIdx ? statusIdx : titleIdx) + 1;
  lines.splice(insertAt, 0, `> **日期**: ${date}`);

  fs.writeFileSync(fp, lines.join(eol), 'utf8');
  filled++;
  console.log(`✅ ${f} → ${date}`);
}

console.log(`\n📊 补全 ${filled} 篇日期行`);
if (skipped.length > 0) {
  console.log(`⚠️  跳过 ${skipped.length} 篇(无日期来源):${skipped.join(', ')}`);
}
