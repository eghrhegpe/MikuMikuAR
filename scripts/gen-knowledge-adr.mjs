#!/usr/bin/env node
/**
 * gen-knowledge-adr.mjs — 知识卡 `adr:` 关联自动补全 —— 从卡片 source_files 指向的源码扫描 `[doc:adr-NNN]` 显式标记，
 * 同步进 frontmatter 的 `adr:` 列表（仅补全当前无 adr 关联的 architecture 卡）。
 *
 * 背景：32 张 architecture 卡 frontmatter 无 `adr:` 关联，导致 ADR 反查表 / 关联图
 * / 路由「其次阅读」推导缺数据。源码中 `[doc:adr-NNN]` 是作者手写的权威关联标注，
 * 扫描 source_files 即可可靠补全（裸 `ADR-NNN` 提及不采信，避免噪音）。
 *
 * 用法：
 *   node scripts/gen-knowledge-adr.mjs            # 补全并写入
 *   node scripts/gen-knowledge-adr.mjs --check    # 只校验不写入（CI）
 *
 * 零依赖（仅 node:fs / node:path）。
 * 设计意图：知识卡 ADR 关联生成器
 * 退出码：1（失败）
 */

import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from './_lib/parse-args.mjs';
import { ROOT } from './_lib/scan-files.mjs';
// [P2-2] 非知识卡清单统一走共享库
import { KNOWLEDGE_NON_CARDS as NON_CARDS } from './_lib/knowledge-cards.mjs';
// [P2-3/P2-4 2026-08-08] source_files 解析收口共享库：旧正则只收 `frontend/` 前缀
// （Go/backend 卡被静默排除）且作用于整个 frontmatter（scope:/tests: 下 - frontend/... 被当
// source → 目录路径 EISDIR 崩溃隐患）。parseSourceFiles 限定 source_files 块、任意路径、
// 兼容行内数组/引号。
import { parseSourceFiles } from './_lib/frontmatter.mjs';

const KNOW_DIR = path.join(ROOT, 'docs', 'knowledge');

/** 提取 frontmatter 块。 */
function fmBlock(text) {
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  return m ? m[1] : '';
}

/** 提取 frontmatter 单字段。 */
function fm(text, key) {
  const m = fmBlock(text).match(new RegExp('^' + key + '\\s*:\\s*(.+)$', 'm'));
  return m ? m[1].trim() : undefined;
}

/** 提取 frontmatter 列表字段全部项。 */
function fmList(text, key) {
  const lines = fmBlock(text).split(/\r?\n/);
  const out = [];
  let inList = false;
  for (const line of lines) {
    const head = line.match(new RegExp('^' + key + '\\s*:\\s*(.*)$'));
    if (head) {
      inList = true;
      const inline = head[1].replace(/#.*$/, '').trim();
      if (inline && !inline.startsWith('<')) out.push(inline);
      continue;
    }
    if (!inList) continue;
    const item = line.match(/^\s*-\s*(.+)$/);
    if (item) {
      const v = item[1].replace(/#.*$/, '').trim();
      if (v && !v.startsWith('<')) out.push(v);
    } else if (/^\S/.test(line)) {
      inList = false;
    }
  }
  return out;
}

/** 扫描 source_files 源码里的 `[doc:adr-NNN]` 显式标记，返回升序 ADR-NNN 列表。 */
function scanDocAdrMarkers(sourceFiles) {
  const found = new Set();
  for (const sf of sourceFiles) {
    const abs = path.join(ROOT, sf);
    if (!fs.existsSync(abs)) continue;
    let src;
    // [P2-4 2026-08-08] 读失败 try/catch：共享 parseSourceFiles 可能返回目录路径
    // （scope:/tests: 等字段被误当 source 的历史风险），readFileSync(目录) 抛 EISDIR
    // 未捕获异常会整脚本崩溃 → 跳过并告警。
    try {
      src = fs.readFileSync(abs, 'utf8');
    } catch {
      console.warn(`   ⚠ 无法读取 ${sf}（跳过）`);
      continue;
    }
    // [P2-1/P2-2 2026-08-08] 旧正则 `/\[doc:adr-(\d+)\]/g` 只认精确形式：
    // ① 带后缀标记 `[doc:adr-199 P2-3]`、`[doc:adr-123 P1]` 等数十处全漏
    //    （ai-config-store.md 的 ADR-199 关联永久丢失，实证）；
    // ② 合并标记 `[doc:adr-176/178]`、`[doc:adr-163/adr-164/adr-166]` 整段无匹配。
    // 现改为捕获整个 token 内文本，按 `/` 或空白分段后只取「纯数字或 adr-NNN」段——
    // 后缀 `P2-3` 含连字符且非 adr- 前缀，天然不提取。
    for (const m of src.matchAll(/\[doc:adr-([^\]]*)\]/g)) {
      for (const seg of m[1].split(/[\/\s]+/)) {
        const nm = seg.match(/^(?:adr-)?(\d+)$/);
        if (nm) found.add(parseInt(nm[1], 10));
      }
    }
  }
  return [...found]
    .sort((a, b) => a - b)
    .map((n) => `ADR-${String(n).padStart(3, '0')}`);
}

/** 把 adr 列表写入 frontmatter：先移除旧的空 `adr: []` 行，再在 `tier:` 行后插入 `adr:` 块。 */
function writeAdrBlock(text, adrList) {
  const fm = fmBlock(text);
  if (!fm) return text;
  // 移除旧的空列表行（`adr: []`），避免 frontmatter 出现两处 adr: 键（VitePress 解析失败）
  const fmNoEmptyAdr = fm.replace(/^adr\s*:\s*\[\]\s*$/m, '').replace(/\n{2,}/g, '\n');
  const adrBlock = adrList.map((a) => `  - ${a}`).join('\n');
  const newFm = fmNoEmptyAdr.replace(
    /^(tier:\s*.+)$/m,
    `$1\nadr:\n${adrBlock}`
  );
  return text.replace(/^---\r?\n[\s\S]*?\r?\n---/, `---\n${newFm}\n---`);
}

function main() {
  const args = parseArgs(process.argv.slice(2), {
    bools: ['check'],
    strings: [],
    defaults: {},
  });
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
  const isCheck = args.check;

  if (!fs.existsSync(KNOW_DIR)) {
    console.error('❌ docs/knowledge/ 不存在，请确认在仓库根目录运行');
    process.exit(1);
  }

  // 收集：architecture 卡且 frontmatter 无 adr 关联
  const targets = [];
  for (const f of fs.readdirSync(KNOW_DIR).filter((f) => f.endsWith('.md'))) {
    if (NON_CARDS.has(f)) continue;
    const text = fs.readFileSync(path.join(KNOW_DIR, f), 'utf8');
    const fmTxt = fmBlock(text);
    if (!fmTxt) continue;
    const tier = fm(text, 'tier');
    if (tier !== 'architecture') continue;
    const existing = fmList(text, 'adr').filter((a) => a !== '[]');
    if (existing.length) continue; // 已有手写关联，不动
    // [P2-3 2026-08-08] 改用共享 parseSourceFiles（限定 source_files 块、任意路径）：
    // 旧 `/^\s*-\s*(frontend\/\S+)\s*$/gm` 只收 frontend/ → Go/backend 卡（go-app/go-library 等
    // 约 14 张）静默排除，即使 internal/ 源码有 [doc:adr-] 标记也永远不补 adr 字段。
    const sources = parseSourceFiles(fmTxt);
    const adrs = scanDocAdrMarkers(sources);
    if (adrs.length) targets.push({ file: f, text, adrs });
  }

  if (isCheck) {
    if (targets.length) {
      console.error(`❌ ${targets.length} 张 architecture 卡缺 adr 关联（源码有 [doc:adr-] 标记），请运行：npm run gen:adr`);
      for (const t of targets) console.error(`   - ${t.file} → ${t.adrs.join(', ')}`);
      process.exit(1);
    }
    console.log('✅ 所有 architecture 卡均已登记 adr 关联');
    return;
  }

  let written = 0;
  for (const t of targets) {
    const newText = writeAdrBlock(t.text, t.adrs);
    if (newText === t.text) continue;
    fs.writeFileSync(path.join(KNOW_DIR, t.file), newText, 'utf8');
    written++;
    console.log(`✅  ${t.file} → ${t.adrs.join(', ')}`);
  }
  console.log(written ? `✅ 已补全 ${written} 张卡的 adr 关联` : '✅ 无需补全');
}

main();
