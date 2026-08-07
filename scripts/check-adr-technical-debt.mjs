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
import { parseAdrHeader } from './_lib/frontmatter.mjs';
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

// [P1+P2 2026-08-08] 首部解析收口共享库 parseAdrHeader（首 20 行 + `---` 早停）：
// 手写 extractStatus 的 `/^[>-|]/` 是字符区间 `>`..`|`（不匹配字面 `-`）→
// `- **状态**` 列表格式（ADR-131 起约半数）全部漏检（实证 ADR-149「搁置待修复立项」）；
// 且无早停导致正文 `**状态**` 行被误取、table 格式贪婪吞尾 `|`。
// 迁移后与 check-adr-health/check-adr-status 同源，债务报告口径一致。
function extractStatus(filePath) {
  const hdr = parseAdrHeader(filePath);
  return hdr.error ? null : (hdr.status || null);
}

function main() {
  const files = fs.readdirSync(ADR_DIR)
    .filter(f => f.startsWith('adr-') && f.endsWith('.md'))
    .sort();

  const debtItems = [];

  for (const file of files) {
    const status = extractStatus(path.join(ADR_DIR, file));
    
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
