#!/usr/bin/env node

/**
 * ADR 技术债务检查 - 精简版
 * 只报告有问题的 ADR
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ADR_DIR = path.join(__dirname, '..', 'docs', 'adr');

const DEBT_KEYWORDS = ['已废弃', '已放弃', '已搁置', '搁置', '废弃', '待立项', '草案', '提案', 'Proposed', '规划中', '部分实现', '待推进'];

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

  console.log(`技术债务: ${debtItems.length} 个 ADR 需要关注`);
  
  if (debtItems.length > 0) {
    debtItems.forEach(item => console.log(`  - ${item}`));
  }
}

main();
