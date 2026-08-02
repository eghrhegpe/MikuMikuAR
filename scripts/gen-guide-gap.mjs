#!/usr/bin/env node
/**
 * gen-guide-gap.mjs
 * 用户指南覆盖缺口扫描 —— 从 menu-map.md（机器生成的声明式菜单事实源）提取 folder 面板，
 * 与 guide/ 页面清单对照，列出「菜单有面板但用户指南无对应页」的缺口（WARN 不阻断）。
 *
 * 背景：guide 是手写的叙事性操作手册（"怎么用"），无法机器生成正文；但缺口可见性可以自动化——
 * 声明式菜单新增面板后，如果 guide 没有对应操作页，用户将找不到入口。本脚本把缺口列出来，
 * 供按优先级人工补写，避免"菜单加了、手册忘了"的静默漂移。
 *
 * 用法：
 *   node scripts/gen-guide-gap.mjs            # 扫描并输出缺口清单
 *   node scripts/gen-guide-gap.mjs --strict   # 有缺口时 exit 1（CI 可选卡点）
 *
 * 零依赖（仅 node:fs / node:path）。
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from './_lib/parse-args.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const MENU_MAP = path.join(ROOT, 'docs', 'knowledge', 'menu-map.md');
const GUIDE_DIR = path.join(ROOT, 'docs', 'guide');

/** 已知豁免：这些 folder 面板是内部/无独立操作页，不要求 guide 覆盖 */
const EXEMPT = new Set([
  'experimental', // 实验性，未稳定不写手册
  'none', // 占位
  'recent', // 最近使用列表，非功能
  'loadModel', // 模型加载（guide 已有 import-model 覆盖，按页面名不匹配豁免？→ 见下）
]);

/** settings.* 子域（about/appearance/controls/downloads/graphics/media/resources/system）由 settings.md 总览页覆盖，豁免 */
const SETTINGS_OVERRIDDEN = new Set([
  'about', 'appearance', 'controls', 'downloads', 'graphics', 'media', 'resources', 'system',
]);

/** 被其他 guide 页覆盖的别名域（如 tags → import-model / library） */
const ALIAS_COVERED = new Set(['tags']);

function main() {
  const args = parseArgs(process.argv.slice(2), { bools: ['strict'], strings: [], defaults: {} });
  const strict = args.strict;

  if (!fs.existsSync(MENU_MAP) || !fs.existsSync(GUIDE_DIR)) {
    console.error('❌ menu-map.md 或 guide/ 不存在，请确认在仓库根目录运行');
    process.exit(1);
  }

  // 1. 提取 menu-map 的 folder 面板（含 env./scene./library./motion./settings. 前缀的二级域）
  const folders = [];
  for (const m of fs.readFileSync(MENU_MAP, 'utf8').matchAll(/^\| folder \| `([a-z]+\.[a-z0-9-]+)` \|/gm)) {
    folders.push(m[1].split('.')[1]);
  }
  const uniqueFolders = [...new Set(folders)].sort();

  // 2. guide 页面名（去 .md）
  const guidePages = fs
    .readdirSync(GUIDE_DIR)
    .filter((f) => f.endsWith('.md') && !['README.md', 'index.md'].includes(f))
    .map((f) => f.replace(/\.md$/, ''));

  // 3. 对照：面板二级域是否被某 guide 页名包含（或反向）
  const missing = [];
  for (const folder of uniqueFolders) {
    if (EXEMPT.has(folder)) continue;
    if (SETTINGS_OVERRIDDEN.has(folder)) continue; // settings.md 总览页已覆盖
    if (ALIAS_COVERED.has(folder)) continue; // 被其他 guide 页别名覆盖
    const hit = guidePages.filter((p) => p.includes(folder) || folder.includes(p));
    if (!hit.length) missing.push(folder);
  }

  console.log('用户指南覆盖缺口扫描');
  console.log('  菜单 folder 面板:', uniqueFolders.length, '个');
  console.log('  guide 页面:', guidePages.length, '篇');
  if (missing.length) {
    console.log(`\n🟡 ${missing.length} 个菜单面板无 guide 页面覆盖（建议人工补写操作页）:`);
    for (const f of missing) console.log(`   - ${f}`);
    console.log('\n  补写模板：docs/guide/ 下新建 <域>.md，frontmatter 含 title/description，');
    console.log('  正文按「它能做什么 → 打开方式 → 操作步骤 → 常见问题 → 相关功能」结构。');
    if (strict) process.exit(1);
    console.log('\n  (WARN 不阻断，加 --strict 后 CI 阻断)');
  } else {
    console.log('\n✅ 所有菜单面板均有 guide 页面覆盖。');
  }
  process.exit(0);
}

main();
