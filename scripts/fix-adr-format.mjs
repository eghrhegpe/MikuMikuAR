#!/usr/bin/env node
/**
 * fix-adr-format.mjs — 修复 ADR 文件首部格式，对齐 gen-status-index.mjs 的解析契约。
 *
 * 契约要求：
 *   # ADR-NNN: 标题         ← ASCII 冒号
 *   > **状态**: xxx          ← 有 > 前缀，ASCII 冒号
 *   > **日期**: yyyy-mm-dd   ← 有 > 前缀，ASCII 冒号
 *
 * 修复的偏差：
 *   1. 标题行：中文冒号 → ASCII 冒号（# ADR-NNN：标题 → # ADR-NNN: 标题）
 *   2. 标题行：缺冒号或破折号 → 补冒号（# ADR-131 标题 → # ADR-131: 标题）
 *   3. 状态行：缺少 > 前缀、中文冒号（**状态**：xxx → > **状态**: xxx）
 *   4. 日期行：缺少 > 前缀、中文冒号（**日期**：yyyy-mm-dd → > **日期**: yyyy-mm-dd）
 *
 * 用法：
 *   node scripts/fix-adr-format.mjs              # 修复全部
 *   node scripts/fix-adr-format.mjs adr-131-*    # 修复指定文件
 *
 * 零依赖，仅 node:fs / node:path。
 */

import fs from 'node:fs';
import path from 'node:path';

const ADR_DIR = path.resolve(process.cwd(), 'docs/adr');
const targets = process.argv.slice(2);

let files = targets.length > 0
  ? targets.filter(f => /^adr-\d+-.+\.md$/.test(f))
  : fs.readdirSync(ADR_DIR).filter(f => /^adr-\d+-.+\.md$/.test(f)).sort();

let fixed = 0;
let unchanged = 0;

for (const f of files) {
  const fp = path.join(ADR_DIR, f);
  if (!fs.existsSync(fp)) {
    console.warn(`⚠️  跳过 ${f}：文件不存在`);
    continue;
  }
  let text = fs.readFileSync(fp, 'utf8');
  const orig = text;

  const lines = text.split('\n');
  let changed = false;

  for (let i = 0; i < Math.min(lines.length, 20); i++) {
    const line = lines[i];

    // Fix 1: 标题行中文冒号 → ASCII 冒号
    if (/^#\s+ADR-\d+：/.test(line)) {
      lines[i] = line.replace(/^(#\s+ADR-\d+)：/, '$1: ');
      changed = true;
    }

    // Fix 2: 标题行缺冒号（空格或破折号后直接跟标题）
    // # ADR-NNN 标题  →  # ADR-NNN: 标题
    // # ADR-NNN — 标题 →  # ADR-NNN: 标题
    if (/^#\s+ADR-\d+\s[^:]/.test(line) || /^#\s+ADR-\d+\s*—/.test(line)) {
      lines[i] = line.replace(/^(#\s+ADR-\d+)\s*[—\s]*\s*/, '$1: ');
      changed = true;
    }

    // Fix 3: 状态行格式修复
    if (/^[> ]*\s*\*\*状态\*\*[：:]/.test(line)) {
      const m = line.match(/^\s*\*\*状态\*\*[：:]\s*(.+)$/);
      const m2 = line.match(/^>\s*\*\*状态\*\*[：:]\s*(.+)$/);
      const content = m ? m[1] : (m2 ? m2[1] : '');
      if (m || m2) {
        lines[i] = '> **状态**: ' + content;
        changed = true;
      }
    }

    // Fix 4: 日期行格式修复
    if (/^[> ]*\s*\*\*日期\*\*[：:]/.test(line)) {
      const m = line.match(/^\s*\*\*日期\*\*[：:]\s*(.+)$/);
      const m2 = line.match(/^>\s*\*\*日期\*\*[：:]\s*(.+)$/);
      const content = m ? m[1] : (m2 ? m2[1] : '');
      if (m || m2) {
        lines[i] = '> **日期**: ' + content;
        changed = true;
      }
    }
  }

  if (changed) {
    fs.writeFileSync(fp, lines.join('\n'), 'utf8');
    fixed++;
    console.log(`✅ ${f}`);
  } else {
    unchanged++;
  }
}

console.log(`\n📊 ${fixed} 个文件已修复，${unchanged} 个文件无需改动`);