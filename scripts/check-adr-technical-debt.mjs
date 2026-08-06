#!/usr/bin/env node

/**
 * check-adr-technical-debt.mjs — ADR 技术债务检查 - 精简版
 * 只报告有问题的 ADR
 * check-adr-technical-debt.mjs — ADR 技术债务关键词扫描
 * 设计意图：ADR 技术债务关键词扫描
 * 依赖：fs / path / url / 本地模块
 * 用法：
 *   node scripts/check-adr-technical-debt.mjs                 # 默认行为
 *   node scripts/check-adr-technical-debt.mjs --json # JSON 输出（CI/子代理消费）
 * 退出码：0（无 process.exit 调用）
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { TECHNICAL_DEBT_KEYWORDS } from './_lib/adr-status-categories.mjs';
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

const DEBT_KEYWORDS = TECHNICAL_DEBT_KEYWORDS;

function extractStatus(content) {
  for (const line of content.split('\n')) {
    const m = line.match(/^[>-|]\s*\*\*状态\*\*[：:|\s]+(.+)/);
    if (m) return m[1].trim();
  }
  return null;
}

function main() {
  const files = fs.readdirSync(ADR_DIR)
    .filter(f => f.startsWith('adr-') && f.endsWith('.md'))
    .sort();

  const debtItems = [];

  for (const file of files) {
    const content = fs.readFileSync(path.join(ADR_DIR, file), 'utf-8');
    const status = extractStatus(content);
    
    if (status && DEBT_KEYWORDS.some(k => status.includes(k))) {
      const shortStatus = status.length > 60 ? status.slice(0, 60) + '...' : status;
      debtItems.push(`${file}: ${shortStatus}`);
    }
  }

  if (JSON_OUT) {
    console.log(JSON.stringify({ count: debtItems.length, debtItems }, null, 2));
    return;
  }

  console.log(`技术债务: ${debtItems.length} 个 ADR 需要关注`);

  if (debtItems.length > 0) {
    debtItems.forEach(item => console.log(`  - ${item}`));
  }
}

main();
