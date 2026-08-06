#!/usr/bin/env node

/**
 * check-adr-status.mjs — ADR 状态检查脚本 - 精简版
 * 只报告有问题的 ADR
 * check-adr-status.mjs — ADR 状态分类统计（已完成/进行中/已废弃/未知）
 * 设计意图：ADR 状态分类统计（已完成/进行中/已废弃/未知）
 * 依赖：fs / path / url / 本地模块
 * 用法：
 *   node scripts/check-adr-status.mjs                 # 默认行为
 *   node scripts/check-adr-status.mjs --json # JSON 输出（CI/子代理消费）
 * 退出码：0（无 process.exit 调用）
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { STATUS_CATEGORIES } from './_lib/adr-status-categories.mjs';
// [fix] CLI 健壮性契约：--help 自吐 JSDoc 退 0 / 未知 flag 退 1（2026-08-06）
const _HELP = new Set(['--help', '-h']);
const _KNOWN = new Set(['--json']);
const _REST = process.argv.slice(2);
if (_REST.some((a) => _HELP.has(a))) {
  const _SRC = fs.readFileSync(process.argv[1], 'utf-8');
  const _B = _SRC.indexOf('/**');
  const _X = _SRC.indexOf('*/', _B);
  console.log(_SRC.slice(_B, _X + 2).replace(/^ \* ?/gm, '').trim());
  process.exit(0);
}
const _UNK = _REST.filter((a) => a.startsWith('--') && !_KNOWN.has(a) && !_HELP.has(a));
if (_UNK.length) {
  console.error(`❌ 未知参数: ${_UNK.join(', ')}（--help 查看用法）`);
  process.exit(1);
}


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
