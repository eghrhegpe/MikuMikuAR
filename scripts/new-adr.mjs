#!/usr/bin/env node
/**
 * new-adr.mjs — 新 ADR 脚手架（占号 → 模板 → 标注 → 索引对账闭环）。
 *
 * 自动获取下一个 ADR 编号（本地目录 与 origin/main 取较大者 +1，防本地落后远端撞号），
 * 按 gen-status-index.mjs 契约生成标准格式。
 *
 * 内置防并发防线：
 *   1. 原子占位（wx / O_EXCL）：目标编号文件已存在则 EEXIST 失败退出，杜绝 TOCTOU 静默覆盖。
 *   2. 算号合并 origin/main：本地未 fetch 的新号不会与远端已立档的号冲突。
 *
 * 用法：
 *   node scripts/new-adr.mjs "标题"                        # 无副标题
 *   node scripts/new-adr.mjs "标题" "副标题"               # 有副标题
 *   node scripts/new-adr.mjs "标题" "副标题" "进行中"      # 自定义状态
 *   node scripts/new-adr.mjs "标题" --slug kebab-name      # 显式文件名 slug（默认从标题提取）
 *   node scripts/new-adr.mjs "标题" --related "ADR-113 / scene/env-water.ts"  # 预填「相关文档」行
 *   node scripts/new-adr.mjs "标题" --supersedes ADR-012,ADR-019  # 自动在被取代方状态行标注「被 [ADR-NNN] 取代」（幂等）
 *   node scripts/new-adr.mjs "标题" --dry-run              # 只计算并打印新编号，不写任何文件
 *   node scripts/new-adr.mjs --help                        # 显示用法退出 0（绝不占号）
 *   node scripts/new-adr.mjs --reserve "标题"              # 占号模式（状态=规划，空壳）
 *
 * 未知 --flag 一律报错退出 1（绝不落入位置参数位——历史教训：--help 曾被当标题误占号）。
 * 零依赖（仅 node:fs / node:path / node:child_process + _lib 正则）。
 * 设计意图：ADR 新建工具（占号防撞 + 取代标注自动化）
 * 退出码：1（失败）
 */

import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { RE_SUPERSEDED_BY } from './_lib/supersede-regex.mjs';
import { parseAdrHeader } from './_lib/frontmatter.mjs';

const ADR_DIR = path.resolve(process.cwd(), 'docs/adr');

// ── 参数解析（白名单 flag；未知 flag 拒绝，绝不落入位置参数位）─────────

const FLAG_SPECS = {
  '--reserve': 'bool',
  '--占位': 'bool',
  '--dry-run': 'bool',
  '--help': 'bool',
  '-h': 'bool',
  '--slug': 'value',
  '--related': 'value',
  '--supersedes': 'value',
};

function parseCli(argv) {
  const args = { reserve: false, dryRun: false, help: false, slug: null, related: null, supersedes: [], positional: [], unknown: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '-h') {
      args.help = true;
      continue;
    }
    if (!a.startsWith('--')) {
      args.positional.push(a);
      continue;
    }
    const spec = FLAG_SPECS[a];
    if (!spec) {
      args.unknown.push(a);
      continue;
    }
    if (spec === 'bool') {
      if (a === '--reserve' || a === '--占位') args.reserve = true;
      else if (a === '--dry-run') args.dryRun = true;
      else if (a === '--help' || a === '-h') args.help = true;
    } else {
      const v = argv[++i];
      if (v === undefined || v.startsWith('--')) {
        console.error(`❌ 参数 ${a} 缺少值`);
        process.exit(1);
      }
      if (a === '--slug') args.slug = v;
      else if (a === '--related') args.related = v;
      else if (a === '--supersedes') args.supersedes = v.split(/[，,]/).map(s => s.trim()).filter(Boolean);
    }
  }
  return args;
}

const args = parseCli(process.argv.slice(2));

// --help / -h：用法退出 0，绝不占号（防 --help 被当标题的误用）
if (args.help) {
  console.log(
    '用法: node scripts/new-adr.mjs "标题" ["副标题"] ["状态"] [--slug kebab-name] [--related 关联内容] [--supersedes ADR-0XX,...] [--dry-run] [--reserve] [--help]\n' +
      '  --slug        文件名 kebab-case（缺省从标题自动提取）\n' +
      '  --related     预填「相关文档」行（写入模板）\n' +
      '  --supersedes  被本 ADR 取代的既有 ADR（逗号分隔，自动在被取代方状态行标注「被 [ADR-NNN] 取代」，幂等）\n' +
      '  --dry-run     只计算并打印新编号，不写任何文件\n' +
      '  --reserve     占号模式（状态=规划，立空壳待并行任务补正文）'
  );
  process.exit(0);
}
// 未知 flag：拒绝而非当标题占号（历史教训：--help 曾被当标题误占 ADR 号）
if (args.unknown.length) {
  console.error(`❌ 未知参数: ${args.unknown.join(', ')}（--help 查看用法）`);
  process.exit(1);
}

const title = args.positional[0];
let subtitle = args.positional[1] || '';
let status = args.positional[2] || '提案';

if (!title) {
  console.error('用法: node scripts/new-adr.mjs "标题" ["副标题"] ["状态"] [--slug ...] [--supersedes ADR-0XX,...] [--dry-run] [--reserve]');
  process.exit(1);
}
if (args.reserve) {
  status = '规划';
}

// ── slug（显式 --slug 优先，否则从标题自动提取；保留中文支持）────────

function toSlug(titleText, explicit) {
  if (explicit) {
    const s = explicit
      .toLowerCase()
      .replace(/[^a-z0-9\u4e00-\u9fff-]+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '');
    if (!s) {
      console.error('❌ --slug 为空或全为非法字符（允许 a-z/0-9/中文/-）');
      process.exit(1);
    }
    return s;
  }
  return titleText
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fff]+/g, '-')
    .replace(/^-|-$/g, '');
}
const slug = toSlug(title, args.slug);

// ── 编号占号（双源取号：本地目录 与 origin/main 取较大者 +1）─────────

function maxAdrNumFrom(list) {
  const nums = list
    .map(f => { const m = f.match(/adr-(\d+)-/); return m ? parseInt(m[1], 10) : 0; })
    .filter(n => n > 0);
  return nums.length > 0 ? Math.max(...nums) : 0;
}

const localFiles = fs.readdirSync(ADR_DIR).filter(f => /^adr-\d+-/.test(f));
const localMax = maxAdrNumFrom(localFiles);
let remoteMax = 0;
let mergedRemote = false;
try {
  const remoteOut = execSync('git ls-tree -r --name-only origin/main -- docs/adr', {
    cwd: process.cwd(),
    stdio: 'pipe',
  }).toString();
  const remoteFiles = remoteOut.split('\n').map(s => s.trim()).filter(Boolean);
  if (remoteFiles.length) { remoteMax = maxAdrNumFrom(remoteFiles); mergedRemote = true; }
} catch {
  // 降级路径：无 origin/main 远端引用时仅用本地编号，不阻断创建
}
const next = Math.max(localMax + 1, remoteMax + 1);
const srcNote = mergedRemote ? `本地最大 ${localMax} / 远端最大 ${remoteMax}` : `本地最大 ${localMax}`;

// ── dry-run：只算号不写文件 ──────────────────────────────────────────

if (args.dryRun) {
  console.log(`[占号] ${srcNote} → 新编号 ADR-${next}（文件 adr-${next}-${slug}.md）`);
  console.log('[dry-run] 未写入任何文件');
  process.exit(0);
}

// ── 原子占位（wx = O_EXCL）+ 写文件 ───────────────────────────────────

const filename = `adr-${next}-${slug}.md`;
const filepath = path.join(ADR_DIR, filename);
// 防并发撞号：open 前先校验「同编号任意 slug」是否已存在。
// wx/O_EXCL 只能防同文件名，两个并发进程用不同标题算到同一 next 时
// 文件名不同 → 都不会 EEXIST → 产出同号异名双文件；此校验在占位前拦截。
const sameNumFile = fs
  .readdirSync(ADR_DIR)
  .find((f) => new RegExp(`^adr-${next}-`).test(f));
if (sameNumFile) {
  console.error(`❌ ADR-${next} 编号已被占用（已存在 ${sameNumFile}），疑似并发创建或本地落后远端。`);
  console.error(`   当前 ${srcNote}，请先 \`git fetch\` 再从最大号 +1 重新运行，或人工核对编号。`);
  process.exit(1);
}
let fd;
try {
  fd = fs.openSync(filepath, 'wx');
} catch (e) {
  if (e && e.code === 'EEXIST') {
    console.error(`❌ ADR-${next} 编号已被占用（${filepath} 已存在），疑似并发创建或本地落后远端。`);
    console.error(`   当前 ${srcNote}，请先 \`git fetch\` 再从最大号 +1 重新运行，或人工核对编号。`);
    process.exit(1);
  }
  throw e;
}
fs.writeSync(fd, content0(title, subtitle, status, next, args.reserve, args.related));
fs.closeSync(fd);

console.log(`✅ 已创建 ADR-${next}: ${subtitle ? `${title} — ${subtitle}` : title}${args.reserve ? '（占号模式）' : ''}`);
console.log(`   ℹ 编号分配：${srcNote} → ADR-${next}`);
console.log(`   文件: ${filepath}`);
console.log(`   > **状态**: ${status}（${new Date().toISOString().slice(0, 10)}）`);

// ── 被取代标注：在被取代方状态行内联追加「被 [ADR-NNN] 取代」（幂等）──

// 我们的 RE_SUPERSEDED_BY 检测的是状态行（gen-adr-supersede 契约），故标注必须进状态行而非独立行。
function annotateSuperseded(targetRefs, supersedingNum) {
  let ok = true;
  for (const ref of targetRefs) {
    const m = String(ref).match(/(\d{1,3})/);
    if (!m) {
      console.error(`❌ --supersedes 无法解析「${ref}」，需形如 ADR-012 或 012`);
      ok = false;
      continue;
    }
    const tNum = parseInt(m[1], 10);
    const tPad = String(tNum).padStart(3, '0');
    const fname = fs.readdirSync(ADR_DIR).find(f => new RegExp(`^adr-${tPad}-`).test(f));
    if (!fname) {
      console.error(`❌ 未找到 adr-${tPad}-* 文件`);
      ok = false;
      continue;
    }
    const fp = path.join(ADR_DIR, fname);
    const hdr = parseAdrHeader(fp);
    if (hdr.error || hdr.statusLine < 0) {
      console.error(`❌ adr-${tPad} 无法定位状态行（${hdr.error || '未找到状态行'}），无法插入标注`);
      ok = false;
      continue;
    }
    const raw = fs.readFileSync(fp, 'utf8');
    const eol = raw.includes('\r\n') ? '\r\n' : '\n';
    const lines = raw.split(/\r?\n/);
    const statusLine = lines[hdr.statusLine];
    const existing = statusLine.match(RE_SUPERSEDED_BY);
    if (existing) {
      const existingNum = parseInt(existing[1], 10);
      if (existingNum === supersedingNum) {
        console.log(`⏭ adr-${tPad} 状态行已有「被 [ADR-${existingNum}] 取代」标注，跳过（幂等）`);
        continue;
      }
      // 已被更早的 ADR 取代：更新为新取代者而非静默丢弃本次请求（防陈旧标注）
      console.warn(`⚠ adr-${tPad} 已标注「被 [ADR-${existingNum}] 取代」，本次 --supersedes 更新为 [ADR-${supersedingNum}]`);
      lines[hdr.statusLine] = statusLine.replace(
        existing[0],
        `⚠️ 被 [ADR-${supersedingNum}](adr-${supersedingNum}-${slug}.md) 取代（new-adr.mjs 自动标注）`
      );
      fs.writeFileSync(fp, lines.join(eol), 'utf8');
      console.log(`✅ adr-${tPad} 状态行标注已更新为「被 [ADR-${supersedingNum}] 取代」`);
      continue;
    }
    const insert = ` ⚠️ 被 [ADR-${supersedingNum}](adr-${supersedingNum}-${slug}.md) 取代（new-adr.mjs 自动标注）`;
    // 行尾追加（table 格式 `| **状态** | ... |` 插在末位 | 前，避免破坏表格）
    const lastPipe = statusLine.lastIndexOf('|');
    if (statusLine.trimStart().startsWith('|') && lastPipe >= 0) {
      lines[hdr.statusLine] =
        statusLine.slice(0, lastPipe) + insert + statusLine.slice(lastPipe);
    } else {
      lines[hdr.statusLine] = statusLine + insert;
    }
    fs.writeFileSync(fp, lines.join(eol), 'utf8');
    console.log(`✅ adr-${tPad} 状态行已标注「被 [ADR-${supersedingNum}] 取代」`);
  }
  return ok;
}

if (args.supersedes.length) {
  if (!annotateSuperseded(args.supersedes, next)) {
    console.error('❌ 被取代标注处理失败，请检查 --supersedes 参数');
    process.exit(1);
  }
}

// ── 索引对账（硬性契约）：status.md + 取代关系 ────────────────────────

try {
  execSync('node scripts/gen-status-index.mjs --reverse', { cwd: process.cwd(), stdio: 'pipe' });
  console.log('✅ 已自动同步 docs/status.md 的 ADR 索引');
} catch (err) {
  console.warn('⚠ 自动同步 status.md 失败（ADR 文件已创建），请手动运行: npm run gen:status');
  if (err && err.message) console.warn('   ' + err.message.split('\n')[0]);
}

try {
  execSync('node scripts/gen-adr-supersede.mjs', { cwd: process.cwd(), stdio: 'pipe' });
  console.log('✅ 取代关系对账完成（gen-adr-supersede）');
} catch (err) {
  // 取代对账为提示性（新建 ADR 可能只是交叉引用），失败 warn 不阻断
  console.warn('⚠ gen-adr-supersede 对账提示（ADR 文件已创建），可手动运行: npm run gen:adr-supersede');
  if (err && err.message) console.warn('   ' + err.message.split('\n')[0]);
}

console.log('ℹ 健康检查请手动运行: npm run check:adr-health');

// ── 模板 ──────────────────────────────────────────────────────────────

function content0(t, sub, st, n, r, related) {
  const today = new Date().toISOString().slice(0, 10);
  const fullTitle = sub ? `${t} — ${sub}` : t;
  return `# ADR-${n}: ${fullTitle}

> **状态**: ${st}（${today}）
> **日期**: ${today}
${r ? '\n> **占号**: 本 ADR 为占位立档，待并行任务完成后补充正文。\n' : ''}
## 背景

<!-- 为什么要做这个决策？解决了什么问题？ -->

## 决策

<!-- 做了什么决定？ -->

## 备选方案

<!-- 考虑了哪些方案？为什么没选？ -->

## 影响

<!-- 涉及哪些文件？需要同步修改什么？ -->

## 相关文档

${related ? `> ${related}\n` : '<!-- 关联的 ADR / 知识卡 / 代码文件 -->\n'}`;
}
