#!/usr/bin/env node

/**
 * ADR 状态检查脚本 - 精简版
 * 只报告有问题的 ADR
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { STATUS_CATEGORIES } from './_lib/adr-status-categories.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ADR_DIR = path.join(__dirname, '..', 'docs', 'adr');
const JSON_OUT = process.argv.includes('--json');

// 提取状态
function extractStatus(content) {
  for (const line of content.split('\n')) {
    const m1 = line.match(/^>\s*\*\*状态\*\*:\s*(.+)/);
    if (m1) return m1[1].trim();
    const m2 = line.match(/^-\s*\*\*状态\*\*[：:]\s*(.+)/);
    if (m2) return m2[1].trim();
    const m3 = line.match(/^\|\s*\*\*状态\*\*\s*\|\s*(.+?)\s*\|/);
    if (m3) return m3[1].trim();
  }
  return null;
}

// 分类状态
function categorize(status) {
  if (!status) return 'unknown';
  for (const [cat, keywords] of Object.entries(STATUS_CATEGORIES)) {
    if (keywords.some(k => status.includes(k))) return cat;
  }
  return 'unknown';
}

// 主函数
function main() {
  const files = fs.readdirSync(ADR_DIR)
    .filter(f => f.startsWith('adr-') && f.endsWith('.md'))
    .sort();

  const stats = { completed: 0, inProgress: 0, deprecated: 0, unknown: 0 };
  const problems = [];

  for (const file of files) {
    const content = fs.readFileSync(path.join(ADR_DIR, file), 'utf-8');
    const status = extractStatus(content);
    const cat = categorize(status);
    stats[cat]++;

    // 只收集有问题的
    if (cat !== 'completed') {
      const icon = { inProgress: '🔄', deprecated: '⚠️', unknown: '❓' }[cat];
      problems.push(`${icon} ${file}: ${status || '(无状态)'}`);
    }
  }

  // 简洁输出（或 JSON 机读）
  if (JSON_OUT) {
    console.log(JSON.stringify({ stats, problems }, null, 2));
    return;
  }

  console.log(`✅ 已完成: ${stats.completed} | 🔄 进行中: ${stats.inProgress} | ⚠️ 已废弃: ${stats.deprecated} | ❓ 未知: ${stats.unknown} | 总计: ${files.length}`);

  if (problems.length > 0) {
    console.log('\n需要关注的 ADR:');
    problems.forEach(p => console.log(p));
  } else {
    console.log('\n所有 ADR 状态正常！');
  }
}

main();
