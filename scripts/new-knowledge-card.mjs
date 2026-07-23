#!/usr/bin/env node
/**
 * new-knowledge-card.mjs — 生成知识卡模板。
 *
 * 按 docs/knowledge/README.md 的卡片格式规范生成标准 frontmatter + 章节骨架。
 *
 * 用法：
 *   node scripts/new-knowledge-card.mjs <kind> <name> <category> <source_file>
 *
 * 示例：
 *   node scripts/new-knowledge-card.mjs lighting_foo "灯光系统 Foo" rendering "frontend/src/scene/render/lighting-foo.ts"
 *
 * 参数：
 *   kind        — snake_case 标识符
 *   name        — 中文短名（加引号）
 *   category    — rendering|env|motion|ui|core|backend
 *   source_file — 仓库相对路径，必须真实存在于磁盘
 *   adr         — 可选，关联 ADR 编号，如 ADR-174
 *
 * 零依赖，仅 node:fs / node:path。
 */

import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const KNOWLEDGE_DIR = path.resolve(ROOT, 'docs/knowledge');
const kind = process.argv[2];
const name = process.argv[3];
const category = process.argv[4];
const sourceFile = process.argv[5];
const adr = process.argv[6] || '';

const VALID_CATS = ['rendering', 'env', 'motion', 'ui', 'core', 'backend'];

if (!kind || !name || !category || !sourceFile) {
  console.error('用法: node scripts/new-knowledge-card.mjs <kind> <name> <category> <source_file> [adr]');
  console.error('示例:');
  console.error('  node scripts/new-knowledge-card.mjs lighting_foo "灯光系统 Foo" rendering frontend/src/scene/render/lighting-foo.ts ADR-174');
  process.exit(1);
}

if (!VALID_CATS.includes(category)) {
  console.error(`❌ 无效 category: "${category}"，有效值: ${VALID_CATS.join(', ')}`);
  process.exit(1);
}

if (!/^[a-z][a-z0-9_]*$/.test(kind)) {
  console.error('❌ kind 必须为 snake_case（小写字母开头，仅含 a-z0-9_）');
  process.exit(1);
}

// 验证 source_file 存在
const sourcePath = path.resolve(ROOT, sourceFile);
if (!fs.existsSync(sourcePath)) {
  console.warn(`⚠️  source_file 不存在: ${sourceFile}（卡片仍会创建，但 drift 脚本会报错）`);
}

// 从 source_file 推导 scope
const scopeParts = sourceFile.split('/');
const scopeDir = scopeParts.slice(0, -1).join('/');
const scope = scopeDir.startsWith('frontend/') ? `  - ${scopeDir}/**` : `  - ${scopeDir}/**`;

// 从文件名推导卡片文件名
const cardName = path.basename(sourceFile, '.ts').replace(/\./g, '-');
const cardFile = `${cardName}.md`;
const cardPath = path.join(KNOWLEDGE_DIR, cardFile);

const adrBlock = adr ? `  - ${adr}` : '[]';

const content = `---
kind: ${kind}
name: ${name}
category: ${category}
scope:
${scope}
source_files:
  - ${sourceFile}
adr: ${adrBlock}
---

## 系统概览
<!-- 2-4 句讲清它是什么、解决什么问题 -->

## 核心职责
- \`${path.basename(sourceFile)}\` — <!-- 职责 -->

## 对外 API（节选）
- \`symbol()\` — <!-- 作用 -->

## 与其他子系统关系
- <!-- 被谁引用 / 引用谁 -->
`;

fs.writeFileSync(cardPath, content, 'utf8');
console.log(`✅ 已创建知识卡: ${cardFile}`);
console.log(`   文件: ${cardPath}`);
console.log(`   kind: ${kind} | category: ${category} | source: ${sourceFile}`);
if (adr) console.log(`   adr: ${adr}`);