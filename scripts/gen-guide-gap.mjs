#!/usr/bin/env node
/**
 * gen-guide-gap.mjs — 用户指南覆盖缺口扫描 —— 从 menu-map.md（机器生成的声明式菜单事实源）提取 folder 面板，
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
 * 退出码：1 / 0（含失败码）
 * 设计意图：指南缺口生成器
 */

import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from './_lib/parse-args.mjs';
import { ROOT } from './_lib/scan-files.mjs';

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

// [P2 2026-08-08] folder→guide 页名别名映射：camelCase 面板与 kebab 页名归一化后
// 仍不相等（如 stageLight → stagelight vs stage-lights → stagelights），或语义对应
// 与命名无关（postProcess → env-atmosphere「后处理」、presetScenes → scene-save「预设场景」）。
// 归一化匹配无法覆盖的特殊对应都列在此；页面存在性仍会校验（页名不存在则判缺口）。
const ALIAS_FOLDER_TO_PAGE = {
  postProcess: 'env-atmosphere', // 后处理 → env-atmosphere.md
  presetScenes: 'scene-save', // 预设场景 → scene-save.md
  stageLight: 'stage-lights', // 光照 → stage-lights.md
  loadModel: 'import-model', // 模型加载 → import-model.md
  camera: 'camera-control', // 相机面板 → camera-control.md
  // [P2 2026-08-08] 旧双向子串匹配的「巧合覆盖」转为显式别名：
  // particle/wind 由 wind-particles.md、presets 由 env-presets.md、water 由 env-water.md 命中，
  // 归一化精确匹配后不再巧合命中，须显式登记（页存在性仍校验）。
  particle: 'wind-particles',
  wind: 'wind-particles',
  presets: 'env-presets',
  water: 'env-water',
};

/** 归一化：小写 + 去连字符/点（camelCase 与 kebab-case 折叠为同形比较） */
function normalize(s) {
  return String(s).toLowerCase().replace(/[-_.]/g, '');
}

function main() {
  const args = parseArgs(process.argv.slice(2), { bools: ['strict'], strings: [], defaults: {} });
  if (args.help) {
    const _src = fs.readFileSync(process.argv[1], 'utf-8');
    const _s = _src.indexOf('/**');
    const _e = _src.indexOf('*/', _s);
    console.log(_src.slice(_s, _e + 2).replace(/^ \* ?/gm, '').trim());
    process.exit(0);
  }
  if (args.unknown && args.unknown.length) {
    console.error(`❌ 未知参数: ${args.unknown.join(', ')}（--help 查看用法）`);
    process.exit(1);
  }
  const strict = args.strict;

  if (!fs.existsSync(MENU_MAP) || !fs.existsSync(GUIDE_DIR)) {
    console.error('❌ menu-map.md 或 guide/ 不存在，请确认在仓库根目录运行');
    process.exit(1);
  }

  // 1. 提取 menu-map 的 folder 面板（含 env./scene./library./motion./settings. 前缀的二级域）
  // [P1 2026-08-08] 旧正则 `[a-z]+\.[a-z0-9-]+` 只认全小写二级域 → 34 个面板中 9 个
  // camelCase（scene.postProcess/library.loadModel/motion.poseStudio.title 三段域等）静默跳过，
  // 脚本实际只校验 25/34 却输出「✅ 全覆盖」。放宽支持大写与三段域（split('.')[1] 取二级域）。
  const menuText = fs.readFileSync(MENU_MAP, 'utf8');
  const folderRows = [...menuText.matchAll(/^\| folder \| /gm)].length;
  const folders = [];
  for (const m of menuText.matchAll(/^\| folder \| `([A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*)` \|/gm)) {
    folders.push(m[1].split('.')[1]);
  }
  // [P1 2026-08-08] 提取数断言：提取数 < menu-map 实际 folder 行数 → 正则漏匹配（格式漂移/
  // 新增形态未覆盖），立即报错而非静默假绿（防止「菜单加了、手册忘了」对未识别面板失效）。
  if (folderRows === 0) {
    // [P2 2026-08-08] menu-map 无任何 folder 行（格式整体变化/文件异常）→ 同样不可静默
    // 「✅ 全覆盖」假绿。旧断言 `folders.length < folderRows` 在 0 < 0 时不触发，需独立守卫。
    console.error('❌ menu-map 未提取到任何 folder 面板（文件格式异常或结构变化），无法执行覆盖扫描');
    process.exit(1);
  }
  if (folders.length < folderRows) {
    console.error(`❌ folder 面板提取不完整：menu-map 有 ${folderRows} 行，只提取到 ${folders.length} 个（疑似正则漏匹配或格式漂移）`);
    process.exit(1);
  }
  const uniqueFolders = [...new Set(folders)].sort();

  // 2. guide 页面名（去 .md）
  const guidePages = fs
    .readdirSync(GUIDE_DIR)
    .filter((f) => f.endsWith('.md') && !['README.md', 'index.md'].includes(f))
    .map((f) => f.replace(/\.md$/, ''));

  // 3. 对照：面板二级域是否被某 guide 页名覆盖
  // [P2 2026-08-08] 旧匹配为双向裸子串 `p.includes(folder) || folder.includes(p)`——
  // 新页名若含某域名字串（如新增 skybox.md 使 sky 误判已覆盖）→ 漏报；且 camelCase 面板
  // vs kebab 页名归一化前不相等 → 集体误报。改为：别名映射优先，否则归一化精确相等。
  const pageSet = new Set(guidePages.map(normalize));
  const missing = [];
  for (const folder of uniqueFolders) {
    if (EXEMPT.has(folder)) continue;
    if (SETTINGS_OVERRIDDEN.has(folder)) continue; // settings.md 总览页已覆盖
    if (ALIAS_COVERED.has(folder)) continue; // 被其他 guide 页别名覆盖
    const aliasPage = ALIAS_FOLDER_TO_PAGE[folder];
    if (aliasPage) {
      // 别名页必须在 guide 目录真实存在，否则判缺口（页面被删/改名时不再静默通过）
      if (guidePages.includes(aliasPage)) continue;
      missing.push(`${folder}（别名 ${aliasPage} 页不存在）`);
      continue;
    }
    const normFolder = normalize(folder);
    if (pageSet.has(normFolder)) continue; // 归一化精确匹配（camelCase ↔ kebab 折叠）
    missing.push(folder);
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
