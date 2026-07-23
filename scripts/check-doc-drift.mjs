#!/usr/bin/env node
/**
 * check-doc-drift.mjs
 * 文档漂移检查器 —— 比对「代码现实」与「架构文档声称」。
 *
 * 零依赖（仅 node:fs / node:path / node:url）。用法：
 *   node scripts/check-doc-drift.mjs            # 文本报告
 *   node scripts/check-doc-drift.mjs --json     # JSON（便于 CI 解析）
 *
 * 退出码：发现 ERROR 级漂移 → 1；否则 0（INFO 不阻断）。
 *
 * 检查项与信号分级（见对话评估）：
 *   [ERROR] 架构目录树引用了磁盘不存在的文件（文档声称 X 但代码无 X）
 *   [ERROR] status.md 未提及最新 ADR（ADR 索引滞后）
 *   [ERROR] 知识卡 source_files 指向磁盘不存在的文件（卡片自身漂移）
 *   [INFO ]  源码模块符号 0% 入文档（architecture.md 树 + function-map.md 均未覆盖）
 *            注：architecture.md 目录树本就是精选子集、function-map.md 自承部分过时，
 *            故覆盖率缺口列为 INFO，不阻断 CI，仅供人工补登参考。
 *
 * 设计取舍：
 *   - 陈旧引用检查**只扫目录树行**（├──/└──），不碰散文/代码块，避免把示例路径误判为缺文件。
 *   - 磁盘存在性扫描覆盖**整个仓库**（含根目录与 internal），排除 node_modules/.git/dist/build。
 */

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { getExportedSymbols } from './_lib/source-graph.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const asPosix = (p) => p.split(path.sep).join('/');

const CONFIG = {
  // 符号覆盖率扫描根（近期子系统集中地）。可加目录扩展覆盖面。
  sourceRoots: [
    'frontend/src/scene/env',
    'frontend/src/scene/motion',
    'frontend/src/scene/render',
    'frontend/src/menus',
    'frontend/src/core',
  ],
  archDoc: 'docs/architecture.md',
  funcDoc: 'docs/function-map.md',
  statusDoc: 'docs/status.md',
  adrDir: 'docs/adr',
  knowledgeDir: 'docs/knowledge',
  // 符号提取排除：测试桩 / 生成物 / 绑定层 / 模拟
  symbolExclude: [
    /\.test\.ts$/, /\.spec\.ts$/, /\.gen\.ts$/, /\.d\.ts$/,
    /wailsjs\//, /__tests__\//, /__mocks__\//, /node_modules\//,
  ],
  // 全仓库磁盘扫描排除（仅用于「文件是否还存在」判定）
  repoExclude: [/\/node_modules\//, /\/\.git\//, /\/dist\//, /\/build\//],
};

// ---------- 工具 ----------
const read = (rel) => {
  const p = path.join(ROOT, rel);
  return fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : '';
};

function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    const rel = asPosix(full);
    if (CONFIG.symbolExclude.some((re) => re.test(rel))) continue;
    if (e.isDirectory()) walk(full, out);
    else if (e.isFile() && rel.endsWith('.ts')) out.push(full);
  }
  return out;
}

function walkRepo(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    const rel = asPosix(full);
    if (CONFIG.repoExclude.some((re) => re.test(rel))) continue;
    if (e.isDirectory()) walkRepo(full, out);
    else if (e.isFile()) out.push(e.name);
  }
  return out;
}

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const appearsIn = (text, sym) =>
  new RegExp('\\b' + escapeRe(sym) + '\\b').test(text);

// ---------- 检查 1：架构目录树引用完整性（ERROR） ----------
function checkTreeIntegrity() {
  const arch = read(CONFIG.archDoc);
  const treeFiles = new Set();
  const re = /[├└]──\s*([^\s#├└]+\.(?:ts|go))/g;
  let m;
  while ((m = re.exec(arch))) treeFiles.add(m[1]);

  const diskBases = new Set(walkRepo(ROOT));
  // 带斜杠的树条目是相对路径（如 core/state.ts → frontend/src/core/state.ts）；
  // 无斜杠的是 basename（如 motion-slot.ts）。两者判定方式不同。
  const existsRel = (token) =>
    fs.existsSync(path.join(ROOT, 'frontend/src', token)) ||
    fs.existsSync(path.join(ROOT, 'internal', token)) ||
    fs.existsSync(path.join(ROOT, token));

  const stale = [];
  for (const token of treeFiles) {
    const exists = token.includes('/') ? existsRel(token) : diskBases.has(token);
    if (!exists) stale.push(token);
  }
  return stale;
}

// ---------- 检查 2：status.md 是否涵盖最新 ADR（ERROR） ----------
function checkAdrIndex() {
  const dir = path.join(ROOT, CONFIG.adrDir);
  const files = fs.existsSync(dir) ? fs.readdirSync(dir) : [];
  const nums = files
    .map((f) => {
      const m = f.match(/adr-(\d+)-/);
      return m ? parseInt(m[1], 10) : null;
    })
    .filter((n) => n !== null);
  if (nums.length === 0) return { max: 0, statusMentionsMax: true };
  const max = nums.sort((a, b) => a - b)[nums.length - 1];
  const status = read(CONFIG.statusDoc);
  const statusMentionsMax = new RegExp('ADR-0*' + max).test(status);
  return { max, statusMentionsMax };
}

// ---------- 检查 3：源码模块符号覆盖率（INFO） ----------
function checkSymbolCoverage() {
  const arch = read(CONFIG.archDoc);
  const func = read(CONFIG.funcDoc);
  const files = CONFIG.sourceRoots.flatMap((r) => walk(path.join(ROOT, r)));
  const undocumentedByDir = {};
  let undocumented = 0;
  for (const f of files) {
    const syms = getExportedSymbols(f);
    if (syms.length === 0) continue;
    const inArch = syms.filter((s) => appearsIn(arch, s)).length;
    const inFunc = syms.filter((s) => appearsIn(func, s)).length;
    const coverage = Math.max(inArch, inFunc) / syms.length;
    if (coverage === 0 && !arch.includes(path.basename(f))) {
      undocumented++;
      const rel = asPosix(f).replace(asPosix(ROOT) + '/', '');
      const top = rel.split('/').slice(1, 3).join('/'); // frontend/src/<a>/<b>
      undocumentedByDir[top] = (undocumentedByDir[top] || 0) + 1;
    }
  }
  return { undocumented, undocumentedByDir };
}

// ---------- 检查 4：知识卡 source_files 完整性（ERROR + INFO） ----------
// 解析 frontmatter 中的 `source_files:` YAML 列表（零依赖手写，只针对该块）。
function parseSourceFiles(text) {
  const fm = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!fm) return [];
  const lines = fm[1].split(/\r?\n/);
  const out = [];
  let inBlock = false;
  for (const line of lines) {
    if (/^source_files\s*:/.test(line)) {
      inBlock = true;
      // 支持行内数组 source_files: [a, b]
      const inline = line.match(/\[([^\]]*)\]/);
      if (inline) {
        inline[1].split(',').forEach((s) => {
          const v = s.trim().replace(/^['"]|['"]$/g, '');
          if (v) out.push(v);
        });
        inBlock = false;
      }
      continue;
    }
    if (inBlock) {
      const item = line.match(/^\s*-\s*(.+?)\s*$/);
      if (item) {
        out.push(item[1].replace(/^['"]|['"]$/g, ''));
      } else if (/^\S/.test(line)) {
        inBlock = false; // 遇到下一个顶格 key，块结束
      }
    }
  }
  return out;
}

function checkKnowledgeCards() {
  const dir = path.join(ROOT, CONFIG.knowledgeDir);
  if (!fs.existsSync(dir)) {
    return { cards: 0, missingSources: [], coveredCount: 0 };
  }
  const cardFiles = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.md') && f.toLowerCase() !== 'readme.md');
  const missingSources = [];
  const covered = new Set();
  for (const cf of cardFiles) {
    const text = fs.readFileSync(path.join(dir, cf), 'utf8');
    const sources = parseSourceFiles(text);
    for (const src of sources) {
      const abs = path.join(ROOT, src);
      if (fs.existsSync(abs)) covered.add(src);
      else missingSources.push({ card: cf, src });
    }
  }
  return { cards: cardFiles.length, missingSources, coveredCount: covered.size };
}

// ---------- 检查 5：status.md 生成区是否同步（ERROR） ----------
function checkGeneratedStatus() {
  const script = path.join(ROOT, 'scripts', 'gen-status-index.mjs');
  try {
    execFileSync(process.execPath, [script, '--reverse', '--check'], {
      cwd: ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return null;
  } catch (error) {
    const detail = String(error.stderr || error.stdout || error.message).trim();
    return detail || 'gen-status-index --check 执行失败';
  }
}

// ---------- 主流程 ----------
function main() {
  const json = process.argv.includes('--json');
  const errors = [];

  const stale = checkTreeIntegrity();
  for (const s of stale) {
    errors.push(`架构目录树引用了磁盘不存在的文件：${s}`);
  }

  const adr = checkAdrIndex();
  if (!adr.statusMentionsMax) {
    errors.push(`status.md 未提及最新 ADR-${adr.max}（ADR 索引可能落后）`);
  }

  const cov = checkSymbolCoverage();

  const kc = checkKnowledgeCards();
  for (const ms of kc.missingSources) {
    errors.push(`知识卡 ${ms.card} 的 source_files 指向不存在的文件：${ms.src}`);
  }

  const generatedStatusError = checkGeneratedStatus();
  if (generatedStatusError) {
    errors.push(`status.md ADR 生成区未同步：${generatedStatusError}`);
  }

  if (json) {
    console.log(
      JSON.stringify({ adr, stale, coverage: cov, knowledge: kc, errors }, null, 2)
    );
    process.exit(errors.length ? 1 : 0);
  }

  console.log('══════════════════════════════════════════════');
  console.log(' 文档漂移检查报告 (check-doc-drift)');
  console.log('══════════════════════════════════════════════');
  console.log(`ADR 最大编号              : ${adr.max}`);
  console.log(`status.md 涵盖最新 ADR   : ${adr.statusMentionsMax ? '是 ✅' : '否 ❌'}`);
  console.log(`架构树陈旧引用            : ${stale.length ? stale.length + ' 个 ❌' : '无 ✅'}`);
  console.log(`知识卡数 / source 覆盖   : ${kc.cards} 张 / ${kc.coveredCount} 个源文件`);
  console.log(`知识卡失效 source_files  : ${kc.missingSources.length ? kc.missingSources.length + ' 个 ❌' : '无 ✅'}`);
  console.log(`符号 0% 未文档化模块     : ${cov.undocumented}（INFO）`);
  if (cov.undocumented) {
    const parts = Object.entries(cov.undocumentedByDir)
      .sort((a, b) => b[1] - a[1])
      .map(([d, n]) => `${d}: ${n}`);
    console.log('   按目录: ' + parts.join('，'));
  }
  console.log('────────────────────────────────────────────');
  if (errors.length) {
    console.log('❌ ERROR:');
    errors.forEach((e) => console.log('   ' + e));
    console.log('\n退出码 1（可接 CI 卡点）。');
  } else {
    console.log('✅ 未检测到 ERROR 级漂移。');
  }
  console.log('📋 INFO: 符号覆盖率缺口为参考项，不阻断；补登 architecture.md 树 / function-map.md 即可消除。');

  process.exit(errors.length ? 1 : 0);
}

main();
