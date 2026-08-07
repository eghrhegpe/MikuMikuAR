#!/usr/bin/env node
/**
 * gen-knowledge-symbols.mjs — 知识卡 `symbols:` 字段自动生成器 —— 从卡片 `source_files` 指向的源码提取导出符号，
 * 与 frontmatter 的 `symbols:` 列表做集合比对并同步。与 gen-funcmap.mjs 同构
 * （gen 写 / --check 校验），复用 _lib/source-graph.mjs 的 getExportedSymbols。
 *
 * 零依赖（仅 node:fs / node:path / node:url）。
 *   node scripts/gen-knowledge-symbols.mjs          # 同步写入（原地修改漂移的卡）
 *   node scripts/gen-knowledge-symbols.mjs --check  # 只校验不写，有漂移则退出码 1
 *
 * 比对语义：集合相等（顺序无关）。仅当符号真实增删（改名/移除/新增）时才重写该卡，
 * 纯顺序差异不动 —— 避免首次运行无谓触碰全部 234 张卡。
 *
 * 范围：仅处理已声明 `symbols:` 字段的卡；未声明的卡不自动发明（避免无差别改写）。
 * 不处理：use_when / category / tier / 正文 prose（属人类判断，不自动生成）。
 * 设计意图：知识卡符号生成器
 * 用法：
 *   node scripts/gen-knowledge-symbols.mjs                 # 默认行为
 *   node scripts/gen-knowledge-symbols.mjs --check # 启用 check
 */

import fs from 'node:fs';
import path from 'node:path';
import { getExportedSymbols } from './_lib/source-graph.mjs';
import { parseArgs } from './_lib/parse-args.mjs';
import { ROOT } from './_lib/scan-files.mjs';
// [P2 2026-08-08] frontmatter/source_files 解析收口共享库（此前逐字/近似复制，
// 与 gen-knowledge-adr/tests 三处易分叉）。parseSymbols/withUpdatedSymbols 因
// 「无字段=null vs 空列表=[]」语义与块重写需求，保留本文件实现。
import { parseFrontmatter, parseSourceFiles } from './_lib/frontmatter.mjs';

const KNOWLEDGE_DIR = path.join(ROOT, 'docs', 'knowledge');

// ---------- frontmatter 解析（parseFrontmatter/parseSourceFiles 来自 _lib/frontmatter.mjs） ----------

// 解析 symbols: 块（行内数组 / 块列表），无该字段返回 null
function parseSymbols(fm) {
  const lines = fm.split(/\r?\n/);
  let idx = -1;
  for (let i = 0; i < lines.length; i++) {
    if (/^symbols\s*:/.test(lines[i])) {
      idx = i;
      break;
    }
  }
  if (idx === -1) return null;
  const out = [];
  for (let i = idx + 1; i < lines.length; i++) {
    const line = lines[i];
    if (/^\S/.test(line)) break; // 下一个顶格 key
    if (line.trim() === '') break; // 空行（块结束）
    const item = line.match(/^\s*-\s*(.+?)\s*$/);
    if (item) out.push(item[1].replace(/^['"]|['"]$/g, ''));
  }
  return out;
}

// 用新符号列表替换 frontmatter 中的 symbols: 块；本无该字段返回 null。
function withUpdatedSymbols(fm, newSymbols) {
  const lines = fm.split(/\r?\n/);
  let idx = -1;
  for (let i = 0; i < lines.length; i++) {
    if (/^symbols\s*:/.test(lines[i])) {
      idx = i;
      break;
    }
  }
  if (idx === -1) return null;
  let end = idx + 1;
  while (end < lines.length) {
    const line = lines[end];
    if (/^\S/.test(line) || line.trim() === '') break;
    end++;
  }
  const block = ['symbols:'];
  for (const s of newSymbols) block.push('  - ' + s);
  return [...lines.slice(0, idx), ...block, ...lines.slice(end)].join('\n');
}

// ---------- 符号收集 ----------
// Go 顶层符号提取：函数（含方法接收者）/类型/变量/常量。
function getGoSymbols(filePath) {
  const text = fs.readFileSync(filePath, 'utf8');
  const syms = new Set();
  const reFunc = /^func\s+(?:\([^)]*\)\s+)?([A-Za-z0-9_]+)/gm;
  for (const [re, idx] of [
    [reFunc, 1],
    [/^type\s+([A-Za-z0-9_]+)/gm, 1],
    [/^var\s+([A-Za-z0-9_]+)/gm, 1],
    [/^const\s+([A-Za-z0-9_]+)/gm, 1],
  ]) {
    let m;
    while ((m = re.exec(text))) syms.add(m[idx]);
  }
  // [P2 2026-08-08] 分组声明：var ( … ) / const ( … ) / type ( … ) 块内成员
  // 此前只锚定 `^var name` 单行 → a11y_windows.go 的 procReg*、library.go 的
  // maxZipEntryFileSize、plaza_config.go 的 plazaGitHubOwner 等全漏提（实证）。
  // 块内 `// 注释` 行首非标识符，天然跳过。
  const reGroup = /^(?:var|const|type)\s*\(([\s\S]*?)^\)/gm;
  let gm;
  while ((gm = reGroup.exec(text))) {
    for (const line of gm[1].split('\n')) {
      const mm = line.match(/^\s*([A-Za-z0-9_]+)/);
      if (mm) syms.add(mm[1]);
    }
  }
  return [...syms].sort();
}

// 模块级：本次运行中缺失/读失败的 source_files（gen 写模式静默清空人工 symbols 的数据安全守卫）
const missingSources = [];
// 模块级：类型不受支持的 source_files（如 .java）——无 export 关键字恒空，显式告警不假装支持
const unsupportedSources = [];

function collectSymbols(sourceFiles) {
  const set = new Set();
  for (const src of sourceFiles) {
    const abs = path.join(ROOT, src);
    if (!fs.existsSync(abs)) {
      // [P2 2026-08-08] 源文件缺失不再静默：叠加 pre-commit 写模式 + git add docs/，
      // 源文件被改名/暂缺时卡上人工 symbols 会被静默删除并 stage → 显式记录供主流程提醒。
      missingSources.push(`${src}（不存在）`);
      continue;
    }
    // [P2 2026-08-08] 仅支持 TS/JS（getExportedSymbols）与 Go（getGoSymbols）：
    // 其余类型（.java 等）无 export 关键字恒空且无提示 → 显式告警，避免假装支持
    const ext = path.extname(src);
    if (ext !== '.go' && !['.ts', '.tsx', '.js', '.jsx'].includes(ext)) {
      unsupportedSources.push(src);
      continue;
    }
    let syms = [];
    try {
      syms = src.endsWith('.go') ? getGoSymbols(abs) : getExportedSymbols(abs);
    } catch {
      missingSources.push(`${src}（读取失败）`);
      continue;
    }
    syms.forEach((s) => set.add(s));
  }
  return [...set].sort();
}

// 集合相等（顺序无关）
function setsEqual(a, b) {
  if (a.length !== b.length) return false;
  const sb = new Set(b);
  return a.every((x) => sb.has(x));
}

// ---------- 主流程 ----------
function main() {
  const { check: checkMode , help, unknown} = parseArgs(process.argv.slice(2), { bools: ['check'] });
  if (help) {
    const _src = fs.readFileSync(process.argv[1], 'utf-8');
    const _s = _src.indexOf('/**');
    const _e = _src.indexOf('*/', _s);
    console.log(_src.slice(_s, _e + 2).replace(/^ \* ?/gm, '').trim());
    process.exit(0);
  }
  if (unknown && unknown.length) {
    console.error(`❌ 未知参数: ${unknown.join(', ')}（--help 查看用法）`);
    process.exit(1);
  }
  if (!fs.existsSync(KNOWLEDGE_DIR)) {
    console.log('知识卡目录不存在：' + KNOWLEDGE_DIR);
    process.exit(0);
  }
  const cards = fs
    .readdirSync(KNOWLEDGE_DIR)
    .filter((f) => f.endsWith('.md') && f.toLowerCase() !== 'readme.md' && f.toLowerCase() !== 'index.md');

  let updated = 0;
  let drift = 0;
  let skippedNoField = 0;

  for (const cf of cards) {
    const file = path.join(KNOWLEDGE_DIR, cf);
    const text = fs.readFileSync(file, 'utf8');
    const fm = parseFrontmatter(text);
    if (!fm) continue;
    const sources = parseSourceFiles(fm);
    if (sources.length === 0) continue;

    const existing = parseSymbols(fm);
    if (existing === null) {
      skippedNoField++;
      continue; // 未声明 symbols: 不自动发明
    }

    const target = collectSymbols(sources);
    if (setsEqual(existing, target)) continue; // 集合一致（顺序无关）→ 不碰

    if (checkMode) {
      drift++;
      const added = target.filter((s) => !existing.includes(s));
      const removed = existing.filter((s) => !target.includes(s));
      const parts = [];
      if (added.length) parts.push('+[' + added.join(', ') + ']');
      if (removed.length) parts.push('-[' + removed.join(', ') + ']');
      console.log(`⚠ ${cf} symbols 漂移 ${parts.join(' ')}`);
      // [P2 2026-08-08] 缺失/读失败的源文件会导致 removed 误判：显式提示避免误删人工 symbols
      if (removed.length && missingSources.length) {
        console.warn(`   ↳ 注意：${missingSources.length} 个 source_files 缺失/读失败，removed 可能是误判，请核对后再同步`);
      }
    } else {
      const newFm = withUpdatedSymbols(fm, target);
      if (newFm === null) continue;
      const newText = text.replace(
        /^---\r?\n[\s\S]*?\r?\n---/,
        '---\n' + newFm + '\n---'
      );
      fs.writeFileSync(file, newText);
      updated++;
    }
  }

  if (checkMode) {
    // [P2 2026-08-08] check 分支也输出缺失/不支持源文件告警（此前提前 exit 不显示）
    if (missingSources.length > 0) {
      console.warn(`⚠ ${missingSources.length} 个 source_files 缺失/读失败（其贡献符号已跳过）：`);
      for (const ms of missingSources.slice(0, 10)) console.warn(`   - ${ms}`);
      if (missingSources.length > 10) console.warn(`   ...（共 ${missingSources.length} 个）`);
    }
    if (unsupportedSources.length > 0) {
      console.warn(`⚠ ${unsupportedSources.length} 个 source_files 类型不受支持（仅支持 TS/JS/Go，其符号未同步）：`);
      for (const us of unsupportedSources.slice(0, 10)) console.warn(`   - ${us}`);
      if (unsupportedSources.length > 10) console.warn(`   ...（共 ${unsupportedSources.length} 个）`);
    }
    if (drift === 0) {
      console.log(
        `✅ 知识卡 symbols: 与源码导出符号一致（扫描 ${cards.length} 张卡，跳过无字段 ${skippedNoField} 张）`
      );
      process.exit(0);
    }
    console.log(
      `❌ ${drift} 张卡 symbols 漂移，请运行：node scripts/gen-knowledge-symbols.mjs 同步`
    );
    process.exit(1);
  }

  if (missingSources.length > 0) {
    // [P2 2026-08-08] gen 写模式：源文件缺失/读失败显式告警，防止静默清空人工 symbols
    console.warn(`⚠ ${missingSources.length} 个 source_files 缺失/读失败（其贡献符号已跳过）：`);
    for (const ms of missingSources.slice(0, 10)) console.warn(`   - ${ms}`);
    if (missingSources.length > 10) console.warn(`   ...（共 ${missingSources.length} 个）`);
  }

  if (unsupportedSources.length > 0) {
    // [P2 2026-08-08] 类型不受支持的源文件显式告警（仅支持 TS/JS/Go，Java 等恒空）
    console.warn(`⚠ ${unsupportedSources.length} 个 source_files 类型不受支持（仅支持 TS/JS/Go，其符号未同步）：`);
    for (const us of unsupportedSources.slice(0, 10)) console.warn(`   - ${us}`);
    if (unsupportedSources.length > 10) console.warn(`   ...（共 ${unsupportedSources.length} 个）`);
  }

  console.log(
    updated === 0
      ? `✅ 知识卡 symbols: 已是最新，无需修改（扫描 ${cards.length} 张卡）`
      : `✅ 已同步 ${updated} 张卡的 symbols: 字段`
  );
  process.exit(0);
}

main();
