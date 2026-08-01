#!/usr/bin/env node
/**
 * gen-ui-entry.mjs
 * 知识卡「## UI 入口」小节自动生成器（ADR-218 配套）。
 *
 * 背景：check-doc-drift 对 source_files 含 menus/ 或 ui/ 的 architecture 卡
 * 强制要求登记 UI 入口（「## UI 入口」小节或引用 menu-map.md）。
 * 本脚本按知识卡 frontmatter 的 source_files 反查 menu-map.md「入口一览」表，
 * 自动生成 UI 入口小节，消除人工补写的重复劳动，且与机器生成的菜单地图天然防漂移。
 *
 * 用法：
 *   node scripts/gen-ui-entry.mjs            # 扫描并写入缺失的 UI 入口小节
 *   node scripts/gen-ui-entry.mjs --check    # 只校验不写入（CI）
 *
 * 写入位置：插到「## 不变量」之前（README 模板顺序：… → 与其他子系统关系 →
 * UI 入口 → 不变量 → 验证入口）；若无「## 不变量」则追加到文件末尾。
 *
 * 零依赖（仅 node:fs / node:path）。
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from './_lib/parse-args.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const KNOW_DIR = path.join(ROOT, 'docs', 'knowledge');
const MENU_MAP = path.join(KNOW_DIR, 'menu-map.md');

const UI_ENTRY_HEADING = '## UI 入口';
const UI_ENTRY_REF = 'menu-map.md';

/** 解析 menu-map.md「入口一览」表：文件 basename → [入口函数…] */
function parseEntryTable(text) {
  const map = new Map();
  const re = /^\| `(\w+)\(\)` \| `([\w.-]+\.ts)` \|$/gm;
  let m;
  while ((m = re.exec(text))) {
    const fn = m[1];
    const file = m[2];
    if (!map.has(file)) map.set(file, []);
    if (!map.get(file).includes(fn)) map.get(file).push(fn);
  }
  return map;
}

/** 提取 frontmatter 块（首个 --- 之间）。 */
function fmBlock(text) {
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  return m ? m[1] : '';
}

/** 提取 frontmatter 单字段。 */
function fm(text, key) {
  const m = fmBlock(text).match(new RegExp('^' + key + '\\s*:\\s*(.+)$', 'm'));
  return m ? m[1].trim() : undefined;
}

/** 生成 UI 入口小节文本（方案 A：统一一键引用 menu-map.md，不做入口函数细节双写）。 */
function buildEntrySection(card, entryTable) {
  // menu-map.md 是机器生成的菜单事实源（菜单层级 / 入口函数 / 快捷键），
  // 知识卡仅引用而不复制，避免双写漂移（ADR-218 静态归 menu-map、动态归知识卡）。
  void entryTable; // 不再反查入口函数
  return (
    UI_ENTRY_HEADING +
    '\n' +
    '\n' +
    `- 菜单层级 / 入口函数 / 快捷键统一由 [${UI_ENTRY_REF}](./${UI_ENTRY_REF}) 机器生成（勿手改）。\n` +
    `- 运行时动态生成的菜单项（renderCustom / slideRow 等）无法静态提取，缺口由本卡正文说明。\n`
  );
}

/** 把小节插入正文：优先插到「## 不变量」前，否则追加末尾。 */
function insertSection(text, section) {
  const idx = text.indexOf('## 不变量');
  if (idx === -1) return text.replace(/\s*$/, '\n\n') + section;
  const before = text.slice(0, idx).replace(/\s*$/, '');
  const after = text.slice(idx);
  return before + '\n\n' + section + after;
}

function main() {
  const args = parseArgs(process.argv.slice(2), {
    bools: ['check'],
    strings: [],
    defaults: {},
  });
  const isCheck = args.check;

  if (!fs.existsSync(KNOW_DIR)) {
    console.error('❌ docs/knowledge/ 不存在，请确认在仓库根目录运行');
    process.exit(1);
  }
  const entryTable = parseEntryTable(fs.readFileSync(MENU_MAP, 'utf8'));

  // 扫描 source_files 含 menus/ 或 ui/ 的 architecture 卡：
  // 缺 UI 入口的插入，已有旧格式（入口函数明细）的统一重写为一行引用。
  const targets = [];
  for (const f of fs.readdirSync(KNOW_DIR).filter((f) => f.endsWith('.md'))) {
    if (f === 'README.md' || f === 'index.md') continue;
    const text = fs.readFileSync(path.join(KNOW_DIR, f), 'utf8');
    const fmText = fmBlock(text);
    if (!fmText) continue; // 非知识卡（routes/graph 等）
    const tier = fm(text, 'tier');
    if (tier !== 'architecture') continue;
    const sources = [...fmText.matchAll(/^\s*-\s*(frontend\/\S+)\s*$/gm)].map((m) => m[1]);
    const menuSources = sources.filter((s) => /\/menus\/|\/ui\//.test(s));
    if (!menuSources.length) continue;
    targets.push({ file: f, text, menuSources });
  }

  if (isCheck) {
    if (targets.length) {
      console.error(`❌ ${targets.length} 张 architecture 卡缺 UI 入口，请运行：npm run gen:ui-entry`);
      for (const t of targets) console.error(`   - ${t.file}`);
      process.exit(1);
    }
    console.log('✅ 所有 architecture 卡均已登记 UI 入口');
    return;
  }

  let written = 0;
  for (const t of targets) {
    const section = buildEntrySection(t, entryTable);
    const newText = insertSection(t.text, section);
    if (newText === t.text) continue;
    fs.writeFileSync(path.join(KNOW_DIR, t.file), newText, 'utf8');
    written++;
    const fns = [...new Set(t.menuSources.flatMap((s) => entryTable.get(path.basename(s)) || []))];
    console.log(`✍️  ${t.file}${fns.length ? ' → ' + fns.join(', ') : ' → 引用 menu-map.md'}`);
  }
  console.log(written ? `✅ 已补齐 ${written} 张卡的 UI 入口` : '✅ 无需补齐');
}

main();
