#!/usr/bin/env node
/**
 * gen-tier.mjs — 知识卡 tier 分层标注（ADR-218 P3 配套）
 *
 * 判定信号（数据校准后，见 ADR-218 修订说明）：
 *   - invariants/use_when 字段为纯桩（215 张有 key，0 张非空）→ 不可判别，弃用。
 *   - 真正判别信号 = import 广度（模块被多少个不同顶层 feature 目录引用）。
 *
 * 流程：
 *   Pass 1  信任已标 tier 的卡（金标准种子），跳过不碰。
 *   Pass 2  反向 import 图算广度：广度 ≥ 2 个不同顶层目录 → architecture（可自动写）。
 *   Pass 3  其余（广度 < 2 / 缺 source_files / 模块缺失）进 tier-review.md 队列，附建议 + 理由，人工复核。
 *
 * 设计克制：
 *   - 默认预览：只产出 tier-review.md + 打印摘要，不动任何卡（符合「不经确认不动大改动」）。
 *   - --apply：仅把 广度≥2 的 architecture 卡写入 frontmatter；leaf/边界仍留人工，避免误把 facade 藏进机器视图。
 *   - --check：尚有未标卡则退出码 1（人工补全后的 CI 门）。
 *
 * 复用 scripts/_lib/source-graph.mjs（scanSourceGraph / resolveSourceImport），零新依赖。
 * 设计意图：知识卡 tier 生成器
 * 用法：
 *   node scripts/gen-tier.mjs                 # 默认行为
 *   node scripts/gen-tier.mjs --check # 启用 check
 * 依赖：node:fs / node:path / node:url / 本地模块
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { scanSourceGraph } from './_lib/source-graph.mjs';
import { toPosix } from './_lib/to-posix.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const KDIR = path.join(ROOT, 'docs', 'knowledge');
const SRC_DIR = path.join(ROOT, 'frontend', 'src');
const REVIEW_FILE = path.join(KDIR, 'tier-review.md');
const SRC_PREFIX = 'frontend/src/';

// ---------- frontmatter 解析 ----------
function parseFrontmatter(text) {
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  return m ? m[1] : null;
}
function getField(fm, key) {
  if (!fm) return null;
  const lines = fm.split('\n');
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].startsWith(key + ':')) {
      const inline = lines[i].slice(key.length + 1).trim();
      if (inline && !inline.startsWith('[') && !inline.startsWith('-')) return inline;
      const items = [];
      if (inline.startsWith('[')) {
        inline.replace(/^\[/, '').replace(/\]$/, '').split(',').forEach((s) => {
          const t = s.trim();
          if (t && t !== '[]') items.push(t);
        });
        if (items.length) return items;
        return [];
      }
      for (let j = i + 1; j < lines.length; j++) {
        const l = lines[j];
        if (/^\S/.test(l) && !l.startsWith('-')) break;
        const mm = l.match(/^\s*-\s*(.+?)\s*$/);
        if (mm) items.push(mm[1]);
      }
      return items;
    }
  }
  return null;
}
function toRelSource(raw) {
  // 卡里写的是 frontend/src/... 或 src/...，统一成相对 frontend/src 的 rel
  let s = String(raw).trim();
  if (s.startsWith(SRC_PREFIX)) s = s.slice(SRC_PREFIX.length);
  else if (s.startsWith('src/')) s = s.slice(4);
  return toPosix(s);
}

// ---------- 建图 ----------
function buildReverseGraph() {
  const { files, graph } = scanSourceGraph(SRC_DIR);
  const reverse = new Map(); // rel -> Set(importer rel)
  const rels = files.map((f) => f.rel);
  for (const rel of rels) reverse.set(rel, new Set());
  for (const rel of rels) {
    const deps = graph.get(rel);
    if (!deps) continue;
    for (const dep of deps) {
      if (!reverse.has(dep)) reverse.set(dep, new Set());
      reverse.get(dep).add(rel);
    }
  }
  return reverse;
}
function topLevelDir(rel) {
  const i = rel.indexOf('/');
  return i === -1 ? '(root)' : rel.slice(0, i);
}

// ---------- 主程序 ----------
const mode = process.argv.includes('--apply') ? 'apply' : process.argv.includes('--check') ? 'check' : 'preview';

const reverse = buildReverseGraph();

// 收集所有卡
const cardFiles = fs
  .readdirSync(KDIR)
  .filter((f) => f.endsWith('.md') && f.toLowerCase() !== 'readme.md' && f !== 'routes.md' && f !== 'tier-review.md' && f !== 'index.md' && f !== 'menu-map.md' && f !== 'graph.md');

const seeds = []; // 已标卡（信任跳过）
const untagged = []; // 待定
for (const f of cardFiles) {
  const text = fs.readFileSync(path.join(KDIR, f), 'utf8');
  const fm = parseFrontmatter(text);
  const tier = getField(fm, 'tier');
  const tierVal = Array.isArray(tier) ? tier[0] : tier;
  if (tierVal && String(tierVal).trim() && !/^<.*>$/.test(String(tierVal).trim())) {
    seeds.push({ file: f, tier: String(tierVal).trim() });
    continue;
  }
  const sfRaw = getField(fm, 'source_files');
  const sources = Array.isArray(sfRaw) ? sfRaw : sfRaw ? [sfRaw] : [];
  const rels = sources.map(toRelSource).filter((s) => s);
  untagged.push({ file: f, sources: rels, sourcesRaw: sources });
}

// 算广度
const reviewRows = [];
const autoArch = [];
for (const c of untagged) {
  if (c.sources.length === 0) {
    reviewRows.push({ file: c.file, breadth: 0, dirs: '', suggestion: 'leaf', note: '无 source_files，无法算广度，建议 leaf 或补 source_files' });
    continue;
  }
  const dirSet = new Set();
  let missing = 0;
  const ownRels = new Set(c.sources);
  let importerCount = 0;
  for (const rel of c.sources) {
    if (!reverse.has(rel)) {
      missing++;
      continue;
    }
    for (const imp of reverse.get(rel)) {
      if (ownRels.has(imp)) continue; // 排除卡自身模块间的互引
      dirSet.add(topLevelDir(imp));
      importerCount++;
    }
  }
  const breadth = dirSet.size;
  if (missing === c.sources.length) {
    reviewRows.push({ file: c.file, breadth: 0, dirs: '', suggestion: 'leaf', note: 'source_files 模块在磁盘未找到，建议 leaf 或核对路径' });
  } else if (breadth >= 2) {
    autoArch.push({ file: c.file, breadth, dirs: [...dirSet].join(',') });
  } else {
    const sug = breadth === 1 ? 'leaf' : 'leaf';
    const note = breadth === 1
      ? `仅被 1 个顶层目录引用（${[...dirSet].join(',')}），单调用方倾向 → 建议 leaf`
      : '未检测到外部引用，纯叶子/内部用途 → 建议 leaf';
    reviewRows.push({ file: c.file, breadth, dirs: [...dirSet].join(','), suggestion: sug, note });
  }
}

// ---------- 输出 ----------
function writeTier(file, tier) {
  const p = path.join(KDIR, file);
  const text = fs.readFileSync(p, 'utf8');
  const newText = text.replace(/^---\r?\n/, `---\ntier: ${tier}\n`);
  fs.writeFileSync(p, newText);
}

if (mode === 'check') {
  const remaining = untagged.length;
  console.log(`未标 tier 卡: ${remaining}`);
  if (remaining > 0) {
    console.log('仍为标注的卡:');
    for (const c of untagged) console.log(`  ${c.file} (sources=${c.sources.join(',') || '无'})`);
    process.exit(1);
  }
  console.log('✅ 全部知识卡已标 tier。');
  process.exit(0);
}

if (mode === 'apply') {
  for (const a of autoArch) writeTier(a.file, 'architecture');
  console.log(`已自动写入 tier: architecture → ${autoArch.length} 张卡`);
}

// 写 review 队列
const lines = [
  '# 知识卡 tier 标注复核队列（ADR-218 P3）',
  '',
  `> 生成时间：${new Date().toISOString().slice(0, 10)} ｜ 模式：${mode}`,
  `> 机器自动判 architecture（import 广度 ≥ 2 顶层目录）：**${autoArch.length} 张**（--apply 已写入 / 待写入）`,
  `> 需人工复核：**${reviewRows.length} 张**`,
  '',
  '## 一、机器已自动标 architecture（广度 ≥ 2）',
  '',
  '| 卡 | 广度 | 引用顶层目录 |',
  '|----|------|--------------|',
  ...autoArch.map((a) => `| ${a.file} | ${a.breadth} | ${a.dirs} |`),
  '',
  '## 二、待人工复核（建议 tier + 理由）',
  '',
  '| 卡 | 广度 | 引用顶层目录 | 建议 | 理由 |',
  '|----|------|--------------|------|------|',
  ...reviewRows.map((r) => `| ${r.file} | ${r.breadth} | ${r.dirs || '—'} | ${r.suggestion} | ${r.note} |`),
  '',
];
fs.writeFileSync(REVIEW_FILE, lines.join('\n'));

console.log(`\n=== gen-tier 摘要（${mode}）===`);
console.log(`已标种子卡（信任跳过）: ${seeds.length}`);
console.log(`未标卡: ${untagged.length}`);
console.log(`  机器自动 architecture（广度≥2）: ${autoArch.length}`);
console.log(`  人工复核队列: ${reviewRows.length}`);
console.log(`\n复核队列已写入: ${path.relative(ROOT, REVIEW_FILE)}`);
if (mode === 'preview') {
  console.log('（预览模式未改动任何卡；加 --apply 写入 architecture 标注）');
}
