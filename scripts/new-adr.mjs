#!/usr/bin/env node
/**
 * new-adr.mjs — 生成新 ADR 文件模板。
 *
 * 自动获取下一个 ADR 编号，按 gen-status-index.mjs 契约生成标准格式。
 *
 * 用法：
 *   node scripts/new-adr.mjs "标题"                        # 无副标题
 *   node scripts/new-adr.mjs "标题" "副标题"               # 有副标题
 *   node scripts/new-adr.mjs "标题" "副标题" "进行中"      # 自定义状态
 *
 * 零依赖，仅 node:fs / node:path。
 */

import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';

const ADR_DIR = path.resolve(process.cwd(), 'docs/adr');
const title = process.argv[2];
const subtitle = process.argv[3] || '';
const status = process.argv[4] || '提案';

if (!title) {
  console.error('用法: node scripts/new-adr.mjs "标题" ["副标题"] ["状态"]');
  process.exit(1);
}

// 获取下一个编号
const files = fs.readdirSync(ADR_DIR).filter(f => /^adr-(\d+)-/.test(f));
const nums = files.map(f => parseInt(f.match(/^adr-(\d+)/)[1], 10));
const next = nums.length > 0 ? Math.max(...nums) + 1 : 1;

// 生成文件名
const slug = title
  .toLowerCase()
  .replace(/[^a-z0-9\u4e00-\u9fff]+/g, '-')
  .replace(/^-|-$/g, '');
const filename = `adr-${next}-${slug}.md`;
const filepath = path.join(ADR_DIR, filename);

const today = new Date().toISOString().slice(0, 10);

const fullTitle = subtitle ? `${title} — ${subtitle}` : title;

const content = `# ADR-${next}: ${fullTitle}

> **状态**: ${status}（${today}）
> **日期**: ${today}

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

fs.writeFileSync(filepath, content, 'utf8');
console.log(`✅ 已创建 ADR-${next}: ${fullTitle}`);
console.log(`   文件: ${filepath}`);
console.log(`   > **状态**: ${status}（${today}）`);

// 自动同步 docs/status.md 的 ADR 索引（仅重写 GEN:ADR_INDEX 标记区，不破坏手写区）
try {
  execSync('node scripts/gen-status-index.mjs --reverse', { cwd: process.cwd(), stdio: 'pipe' });
  console.log('✅ 已自动同步 docs/status.md 的 ADR 索引');
} catch (err) {
  console.warn('⚠ 自动同步 status.md 失败（ADR 文件已创建），请手动运行: npm run gen:status');
  if (err && err.message) console.warn('   ' + err.message.split('\n')[0]);
}