#!/usr/bin/env node
/**
 * gen-docs-index.mjs —— 生成文档站「分区枢纽层」索引页。
 *
 * 背景（ADR-225 后续）：文档站原本是「首页 → 叶子文档」两层结构，
 * 中间缺分区索引，导致 nav / 首页 features 只能硬编码到具体叶子文档
 * （如 /adr/adr-001-...、/buglog/2026-07-11-...），语义脆弱且随时间漂移。
 *
 * 本脚本为四个规模化目录生成 index.md 分区枢纽：
 *   - docs/adr/index.md       规范索引（按状态分桶导航）
 *   - docs/knowledge/index.md 知识卡（按 category 聚合，leaf 折叠计数）
 *   - docs/buglog/index.md    Bug 日志（按年月倒序分组）
 *   - docs/releases/index.md  发版记录（版本号语义化倒序）
 *
 * 设计原则：**全文生成，禁止手改**。索引内容 100% 从磁盘扫描得出，
 * 新增/删除/改名文档后重跑即同步，杜绝手写索引漂移
 * （对照：docs/knowledge/README.md 手写索引标题写「232 张」，实际已 235 张）。
 *
 * 用法：
 *   node scripts/gen-docs-index.mjs           # 写入
 *   node scripts/gen-docs-index.mjs --check   # 校验是否已同步（CI 用，不写入）
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const DOCS = path.join(ROOT, 'docs');
const CHECK = process.argv.includes('--check');

const BANNER = (script) =>
  `<!-- 本文件由 scripts/${script} 自动生成，请勿手改。重跑：npm run gen:docsindex -->`;

// ── 通用工具 ──────────────────────────────────────────────

function mdFiles(relDir) {
  const dir = path.join(DOCS, relDir);
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((f) => f.endsWith('.md'));
}

function read(relDir, file) {
  return fs.readFileSync(path.join(DOCS, relDir, file), 'utf8');
}

/** 取正文首个 `# 标题`，回退文件名（去掉 .md 后缀）。 */
function h1(text, fallback) {
  const m = text.match(/^#\s+(.+)$/m);
  return m ? m[1].trim() : String(fallback).replace(/\.md$/, '');
}

/** 表格单元格转义：| 会截断表格，换行会破坏行结构。 */
function cell(s) {
  return String(s).replace(/\|/g, '\\|').replace(/\r?\n/g, ' ').trim();
}

/**
 * Markdown 链接目标转义。
 * buglog 存在 8 个含空格的历史文件名（如 `CORS：Wails WebView 跨域被拦.md`），
 * 裸写会被解析器在空格处截断成 `](./CORS：Wails` + 游离文本。
 * CommonMark 的尖括号形式可原样保留空格，且中文路径无需百分号编码（可读性优于 encodeURI）。
 */
function href(rel) {
  return /[\s()]/.test(rel) ? `<${rel}>` : rel;
}

/** 提取 frontmatter 单字段（仅扫描首个 --- 块）。 */
function fm(text, key) {
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!m) return undefined;
  const line = m[1].match(new RegExp('^' + key + '\\s*:\\s*(.+)$', 'm'));
  if (!line) return undefined;
  const v = line[1].trim();
  // 模板占位符 <a|b|c> 视为未填写
  return v.startsWith('<') ? undefined : v;
}

// ── 1. ADR 索引 ───────────────────────────────────────────

/**
 * 状态归一化到展示桶。顺序敏感：
 * 「部分实施」既含「部分」又含「实施」，必须先于「已实施」匹配。
 */
const ADR_BUCKETS = [
  // 归档类优先：「⚠️ 已过时 — 被 ADR-113 取代」同时含「过时」与后续描述词，须先截胡
  { key: '已归档', re: /废弃|作废|取消|被取代|放弃|过时|归档|搁置|落档|superseded/i },
  // 「部分实施 / 部分实现」既含「部分」又含「实施」，必须先于「已实施」匹配
  { key: '推进中', re: /部分实施|部分实现|实施中|进行中|推进中|开发中/ },
  {
    key: '已落地',
    re: /已完成|已实施|已落地|已实现|已修复|已采纳|已裁决|已定性|已收口|实施完毕|完成|采纳|通过|accepted/i,
  },
  { key: '规划中', re: /规划|提案|草案|计划|待定|待实施|已立项/ },
];

function adrBucket(status) {
  for (const b of ADR_BUCKETS) if (b.re.test(status)) return b.key;
  return '其他';
}

/** 复用 gen-status-index.mjs 的首部解析口径（编号 / 标题 / 状态）。 */
function parseAdrHead(file) {
  const text = read('adr', file);
  const lines = text.split(/\r?\n/).slice(0, 20);
  let num = null;
  let title = '';
  let status = '';
  for (const line of lines) {
    const mT = line.match(/^#\s+ADR-(\d+):\s*(.+)/);
    if (mT) {
      num = parseInt(mT[1], 10);
      title = mT[2].trim();
      continue;
    }
    const mS =
      line.match(/^>\s*\*\*状态\*\*\s*[：:]\s*(.+)/) ||
      line.match(/^[-*]\s*\*\*状态\*\*\s*[：:]\s*(.+)/) ||
      line.match(/^\s*\*\*状态\*\*\s*[：:]\s*(.+)/) ||
      line.match(/^\|\s*\*\*状态\*\*\s*\|\s*(.+?)\s*\|\s*$/);
    if (mS) status = mS[1].trim();
  }
  if (num === null) return null;
  return { num, file, title: title || file, status: status || '（未标注）' };
}

/** 长状态串截断：ADR-220 等含大段进度描述，索引表只留首句。 */
function shortStatus(s) {
  const head = s.split(/（|\(/)[0].trim() || s;
  return head.length > 24 ? head.slice(0, 24) + '…' : head;
}

function buildAdrIndex() {
  const entries = mdFiles('adr')
    .filter((f) => /^adr-\d+-.+\.md$/.test(f))
    .map(parseAdrHead)
    .filter(Boolean)
    .sort((a, b) => b.num - a.num);

  const grouped = new Map();
  for (const e of entries) {
    const k = adrBucket(e.status);
    if (!grouped.has(k)) grouped.set(k, []);
    grouped.get(k).push(e);
  }
  const order = ['推进中', '规划中', '已落地', '已归档', '其他'];
  const buckets = order.filter((k) => grouped.has(k));

  const out = [];
  out.push(BANNER('gen-docs-index.mjs'));
  out.push('');
  out.push('# 决策记录（ADR）');
  out.push('');
  out.push(
    `> 架构决策日志，共 **${entries.length}** 篇（ADR-001 起按编号递增）。` +
      '决策一旦写下即不可变；状态变化以各 ADR 文件首部「状态」行为准。'
  );
  out.push('');
  out.push('## 按状态分布');
  out.push('');
  out.push('| 状态 | 数量 | 含义 |');
  out.push('|------|------|------|');
  const meaning = {
    推进中: '已开工，尚未收口（含部分实施）',
    规划中: '已立项，等待实施',
    已落地: '实施完成，代码已合入',
    已归档: '被取代、放弃、过时或搁置，保留供追溯',
    其他: '状态行缺失或表述不可归类',
  };
  for (const k of buckets) {
    out.push(`| [${k}](#${k}) | ${grouped.get(k).length} | ${meaning[k]} |`);
  }
  out.push('');
  out.push(
    '> 本文件为 ADR **规范索引**（按状态分组导航，可锚点跳转）。带日期的全量列表见 [项目现状 · ADR 索引](../status.md)（附表，由 `scripts/gen-status-index.mjs` 生成）。'
  );
  out.push('');

  for (const k of buckets) {
    out.push(`## ${k}`);
    out.push('');
    out.push('| ADR | 主题 | 状态 |');
    out.push('|-----|------|------|');
    for (const e of grouped.get(k)) {
      const id = `ADR-${String(e.num).padStart(3, '0')}`;
      out.push(`| [${id}](${href('./' + e.file)}) | ${cell(e.title)} | ${cell(shortStatus(e.status))} |`);
    }
    out.push('');
  }
  return out.join('\n');
}

// ── 2. 知识卡索引 ─────────────────────────────────────────

const KNOWLEDGE_ORDER = ['env', 'scene', 'physics', 'rendering', 'motion', 'ui', 'core', 'backend'];
const CATEGORY_LABEL = {
  env: '环境系统',
  scene: '场景编排',
  physics: '物理系统',
  rendering: '渲染系统',
  motion: '动作系统',
  ui: 'UI / 菜单',
  core: '核心基础设施',
  backend: '后端',
};
/** 非知识卡的目录成员（索引 / 路由表 / 机器生成地图），单列不参与分类统计。 */
const KNOWLEDGE_NON_CARDS = new Set(['index.md', 'README.md', 'routes.md', 'menu-map.md']);

function buildKnowledgeIndex() {
  const cards = [];
  const extras = [];
  for (const f of mdFiles('knowledge').sort((a, b) => a.localeCompare(b))) {
    if (KNOWLEDGE_NON_CARDS.has(f)) {
      if (f !== 'index.md') extras.push(f);
      continue;
    }
    const text = read('knowledge', f);
    cards.push({
      file: f,
      name: fm(text, 'name') || f.replace(/\.md$/, ''),
      category: fm(text, 'category') || '未分类',
      tier: fm(text, 'tier') || 'architecture',
      adr: fm(text, 'adr'),
    });
  }

  const groups = new Map();
  for (const c of cards) {
    if (!groups.has(c.category)) groups.set(c.category, []);
    groups.get(c.category).push(c);
  }
  const weight = (cat) => {
    if (cat === '未分类') return KNOWLEDGE_ORDER.length + 1;
    const i = KNOWLEDGE_ORDER.indexOf(cat);
    return i === -1 ? KNOWLEDGE_ORDER.length : i;
  };
  const cats = [...groups.keys()].sort((a, b) => weight(a) - weight(b) || a.localeCompare(b));

  const out = [];
  out.push(BANNER('gen-docs-index.mjs'));
  out.push('');
  out.push('# 知识卡索引');
  out.push('');
  out.push(
    `> 原子化架构知识层，共 **${cards.length}** 张卡：记录「某个子系统**现在**长啥样、去哪找」。` +
      '与 ADR（为什么这么决定）互补——知识卡引用而不复制 ADR 结论。'
  );
  out.push('');
  out.push(
    '> 卡片格式规范、立卡判据、`source_files` 铁律见 [知识卡层导读](./README.md)；' +
      'AI 检索入口见 [路由表](./routes.md)；菜单全景见 [menu-map](./menu-map.md)（机器生成）。'
  );
  out.push('');
  out.push('## 分类总览');
  out.push('');
  out.push('| 分类 | 卡片数 | 说明 |');
  out.push('|------|--------|------|');
  for (const cat of cats) {
    const label = CATEGORY_LABEL[cat] || (cat === '未分类' ? '未标注 category（待补）' : '扩展分类');
    out.push(`| [${cat}](#${cat}) | ${groups.get(cat).length} | ${label} |`);
  }
  out.push('');

  for (const cat of cats) {
    const label = CATEGORY_LABEL[cat];
    out.push(`## ${cat}`);
    out.push('');
    if (label) out.push(`**${label}**`);
    else if (cat === '未分类') out.push('**未标注 `category` 字段**——补齐 frontmatter 后会自动归入对应分类。');
    out.push('');
    const items = groups.get(cat).sort((a, b) => a.file.localeCompare(b.file));
    const arch = items.filter((c) => c.tier !== 'leaf');
    const leaf = items.filter((c) => c.tier === 'leaf');
    if (arch.length) {
      out.push('| 卡片 | 关联 ADR |');
      out.push('|------|----------|');
      for (const c of arch) {
        out.push(`| [${cell(c.name)}](${href('./' + c.file)}) | ${c.adr ? cell(c.adr) : '—'} |`);
      }
      out.push('');
    }
    if (leaf.length) {
      // leaf 卡是机器索引对象（工具函数 / 桩 / barrel），折叠为一行避免淹没主结构
      const links = leaf.map((c) => `[${c.file.replace(/\.md$/, '')}](${href('./' + c.file)})`).join(' · ');
      out.push(`> 叶子模块 / 工具函数（${leaf.length} 张）：${links}`);
      out.push('');
    }
  }

  if (extras.length) {
    out.push('## 索引与路由（非卡片）');
    out.push('');
    for (const f of extras) {
      const title = h1(read('knowledge', f), f);
      out.push(`- [${cell(title)}](${href('./' + f)})`);
    }
    out.push('');
  }
  return out.join('\n');
}

// ── 3. Bug 日志索引 ───────────────────────────────────────

function buildBuglogIndex() {
  // 目录里混着三类文件：
  //   1. YYYY-MM-DD-xxx.md   现行命名规范（README.md 定义），按年月归档
  //   2. 中文描述名.md        规范确立前的早期记录，无日期可排，单列一节
  //   3. README.md            写作规范本身，非 bug 记录
  const dated = [];
  const legacy = [];
  let spec = null;
  for (const f of mdFiles('buglog')) {
    if (f === 'index.md') continue;
    if (f === 'README.md') {
      spec = f;
      continue;
    }
    const m = f.match(/^(\d{4})-(\d{2})-\d{2}-/);
    if (m) dated.push({ file: f, year: m[1], month: m[2] });
    else legacy.push(f);
  }
  dated.sort((a, b) => b.file.localeCompare(a.file)); // 日期倒序
  legacy.sort((a, b) => a.localeCompare(b, 'zh-CN'));

  const byMonth = new Map();
  for (const d of dated) {
    const k = `${d.year}-${d.month}`;
    if (!byMonth.has(k)) byMonth.set(k, []);
    byMonth.get(k).push(d);
  }

  const out = [];
  out.push(BANNER('gen-docs-index.mjs'));
  out.push('');
  out.push('# Bug 日志索引');
  out.push('');
  out.push(
    `> 排障记录共 **${dated.length + legacy.length}** 篇：${dated.length} 篇按日期归档、` +
      `${legacy.length} 篇早期记录（命名规范确立前）。每篇记录现象、根因、修复与验证方式，供回归时快速比对。`
  );
  out.push('');
  if (spec) {
    out.push(`> 写作规范见 [${cell(h1(read('buglog', spec), spec))}](${href('./' + spec)})。`);
    out.push('');
  }
  for (const [ym, items] of byMonth) {
    const [y, mo] = ym.split('-');
    out.push(`## ${y} 年 ${Number(mo)} 月（${items.length}）`);
    out.push('');
    for (const it of items) {
      const title = h1(read('buglog', it.file), it.file);
      out.push(`- \`${it.file.slice(0, 10)}\` [${cell(title)}](${href('./' + it.file)})`);
    }
    out.push('');
  }
  if (legacy.length) {
    out.push(`## 早期记录（${legacy.length}）`);
    out.push('');
    out.push('> 命名规范（`YYYY-MM-DD-简短英文描述.md`）确立前的记录，按标题排序。');
    out.push('');
    for (const f of legacy) {
      out.push(`- [${cell(h1(read('buglog', f), f))}](${href('./' + f)})`);
    }
    out.push('');
  }
  return out.join('\n');
}

// ── 4. 发版记录索引 ───────────────────────────────────────

/** 语义化版本比较：字符串序会把 v1.2.10 排在 v1.2.9 之前。 */
function cmpVersionDesc(a, b) {
  const pa = a.replace(/^v/, '').split('.').map(Number);
  const pb = b.replace(/^v/, '').split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pb[i] || 0) - (pa[i] || 0);
    if (d) return d;
  }
  return 0;
}

function buildReleasesIndex() {
  const versions = [];
  const others = [];
  for (const f of mdFiles('releases')) {
    if (f === 'index.md') continue;
    if (/^v\d+(\.\d+)*\.md$/.test(f)) versions.push(f);
    else others.push(f);
  }
  versions.sort((a, b) => cmpVersionDesc(a.replace(/\.md$/, ''), b.replace(/\.md$/, '')));

  const out = [];
  out.push(BANNER('gen-docs-index.mjs'));
  out.push('');
  out.push('# 发版记录索引');
  out.push('');
  out.push(`> 版本号倒序，共 **${versions.length}** 个已发布版本。`);
  out.push('');
  if (others.length) {
    out.push('## 流程文档');
    out.push('');
    for (const f of others) {
      out.push(`- [${cell(h1(read('releases', f), f))}](${href('./' + f)})`);
    }
    out.push('');
  }
  out.push('## 版本列表');
  out.push('');
  out.push('| 版本 | 首项更新 |');
  out.push('|------|----------|');
  for (const f of versions) {
    const text = read('releases', f);
    // 版本页的 h1 恒等于版本号本身（如 `# v1.7.0`），做标题列无信息量；
    // 改取首个三级标题（功能条目名），回退首个列表项，再回退占位符。
    const hi =
      (text.match(/^###\s+(.+)$/m) || [])[1] ||
      (text.match(/^[-*]\s+(.+)$/m) || [])[1] ||
      '—';
    out.push(`| [${f.replace(/\.md$/, '')}](${href('./' + f)}) | ${cell(hi)} |`);
  }
  out.push('');
  return out.join('\n');
}

// ── 主流程 ────────────────────────────────────────────────

const TARGETS = [
  { rel: 'adr/index.md', build: buildAdrIndex, label: '决策记录' },
  { rel: 'knowledge/index.md', build: buildKnowledgeIndex, label: '知识卡' },
  { rel: 'buglog/index.md', build: buildBuglogIndex, label: 'Bug 日志' },
  { rel: 'releases/index.md', build: buildReleasesIndex, label: '发版记录' },
];

function main() {
  let stale = 0;
  for (const t of TARGETS) {
    const abs = path.join(DOCS, t.rel);
    if (!fs.existsSync(path.dirname(abs))) {
      console.warn(`⚠️  跳过 ${t.rel}（目录不存在）`);
      continue;
    }
    const expected = t.build().replace(/\s+$/, '') + '\n';
    const actual = fs.existsSync(abs) ? fs.readFileSync(abs, 'utf8') : null;
    if (actual === expected) {
      if (!CHECK) console.log(`✓ docs/${t.rel}（${t.label}）已是最新`);
      continue;
    }
    if (CHECK) {
      console.error(`❌ docs/${t.rel} 未同步，请运行：npm run gen:docsindex`);
      stale++;
      continue;
    }
    fs.writeFileSync(abs, expected, 'utf8');
    console.log(`✅ 已生成 docs/${t.rel}（${t.label}）`);
  }
  if (CHECK) {
    if (stale) process.exit(1);
    console.log(`✅ 分区索引全部同步（${TARGETS.length} 个）`);
  }
}

main();
