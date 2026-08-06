#!/usr/bin/env node
/**
 * gen-docs-index.mjs — 背景（ADR-225 后续）：文档站原本是「首页 → 叶子文档」两层结构，
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
 * 依赖：node:fs / node:path / node:url
 * 退出码：1（失败）
 * 设计意图：文档索引生成器（ADR 目录索引）
 */

import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './_lib/scan-files.mjs';
// [fix] CLI 健壮性契约：--help 自吐 JSDoc 退 0 / 未知 flag 退 1（2026-08-06）
const _HELP = new Set(['--help', '-h']);
const _KNOWN = new Set(['--check']);
const _REST = process.argv.slice(2);
if (_REST.some((a) => _HELP.has(a))) {
  const _SRC = fs.readFileSync(process.argv[1], 'utf-8');
  const _B = _SRC.indexOf('/**');
  const _X = _SRC.indexOf('*/', _B);
  console.log(_SRC.slice(_B, _X + 2).replace(/^ \* ?/gm, '').trim());
  process.exit(0);
}
const _UNK = _REST.filter((a) => a.startsWith('--') && !_KNOWN.has(a) && !_HELP.has(a));
if (_UNK.length) {
  console.error(`❌ 未知参数: ${_UNK.join(', ')}（--help 查看用法）`);
  process.exit(1);
}


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

/**
 * 提取 frontmatter 列表字段的全部项（`key:` 后逐行 `- 项`）。
 * 兼容单行形式（`key: 值`）；忽略 `#` 注释与模板占位符 `<...>`。
 */
function fmList(text, key) {
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!m) return [];
  const lines = m[1].split(/\r?\n/);
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
      inList = false; // 遇到下一个顶层键，列表结束
    }
  }
  return out;
}

// ── 1. ADR 索引 ───────────────────────────────────────────

/**
 * 状态归一化到展示桶。顺序敏感：
 * 「部分实施」既含「部分」又含「实施」，必须先于「已实施」匹配。
 */
const ADR_BUCKETS = [
  // 归档类判定要精确,不能任意位置含「废弃/搁置/过时」就归档——
  // 否则「已完成主体 + 局部搁置」(ADR-168 E 远期搁置)会被整篇误归。
  // 三档匹配:① 状态行开头即废弃语义;② ⚠️/🗑️/📋 强调标记后紧跟废弃词(§6 局部过时等限定语不触发);
  //           ③ 明确调研落档 / 归档登记。
  { key: '已归档', re: /^(?:已废弃|已过时|已放弃|已搁置|已退役|废弃|放弃|搁置|归档|落档|作废|取消|被取代|已被|superseded)|(?:⚠️|🗑️|📋)\s*\*{0,2}(?:已废弃|已过时|已放弃|已搁置|已退役|被取代|已被)|(?:调研归档|调研落档|归档登记)/i },
  // 「部分实施 / 部分实现」既含「部分」又含「实施」，必须先于「已实施」匹配
  { key: '推进中', re: /部分实施|部分实现|实施中|进行中|推进中|开发中/ },
  {
    key: '已落地',
    re: /已完成|已实施|已落地|已实现|已修复|已采纳|已裁决|已定性|已收口|已交付|实施完毕|完成|采纳|通过|accepted/i,
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
    // 支持子编号,如 ADR-061.1(parseFloat 保持 61.1 与 61 不冲突)
    const mT = line.match(/^#\s+ADR-([\d.]+):\s*(.+)/);
    if (mT) {
      num = parseFloat(mT[1]);
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
    .filter((f) => /^adr-[\d.]+-.+\.md$/.test(f))
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
const KNOWLEDGE_NON_CARDS = new Set(['index.md', 'README.md', 'routes.md', 'menu-map.md', 'graph.md', 'tier-review.md']);

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
      adrList: fmList(text, 'adr'),
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

  // ── ADR 反查（从卡片 frontmatter 的 adr: 列表反向聚合） ──
  const adrMeta = new Map(); // 编号 → { file, title }
  for (const f of mdFiles('adr').filter((f) => /^adr-\d+-.+\.md$/.test(f))) {
    const h = parseAdrHead(f);
    if (h) adrMeta.set(h.num, { file: f, title: h.title });
  }
  const adrRefs = new Map(); // 编号 → [卡片]
  for (const c of cards) {
    for (const a of c.adrList || []) {
      const m = String(a).match(/ADR-(\d+)/i);
      if (!m) continue;
      const num = parseInt(m[1], 10);
      if (!adrRefs.has(num)) adrRefs.set(num, []);
      adrRefs.get(num).push(c);
    }
  }
  if (adrRefs.size) {
    out.push('## ADR 反查');
    out.push('');
    out.push(
      '> 从卡片 `adr:` 字段**反向聚合**：某条决策影响了哪些子系统。' +
        '正向导航见 [决策记录索引](../adr/index.md)。'
    );
    out.push('');
    out.push('| ADR | 主题 | 关联卡片 |');
    out.push('|-----|------|----------|');
    for (const [num, list] of [...adrRefs.entries()].sort((a, b) => a[0] - b[0])) {
      const meta = adrMeta.get(num);
      const id = `ADR-${String(num).padStart(3, '0')}`;
      const link = meta ? `[${id}](${href('../adr/' + meta.file)})` : id;
      const title = meta ? cell(meta.title) : '—';
      const cardsLink = list.map((c) => `[${cell(c.name)}](./${c.file})`).join(' · ');
      out.push(`| ${link} | ${title} | ${cardsLink} |`);
    }
    out.push('');
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

// ── 4b. 代码审核索引 ───────────────────────────────────────

/**
 * audit/ 审核台账索引：命名混杂三类——
 *   1. YYYY-MM-DD-xxx.md    按日期归档（2026-07-xx / 2026-08-xx）
 *   2. round-N-xxx.md       审核轮次序列（round-1-water 等，按 N 排序）
 *   3. 专题名.md            无日期/轮次的专题审核（deadcode-baseline-* 等，按标题排序）
 * 汇总视图（执行摘要/风险全景/优先级）保留在 README.md，本索引承担明细导航。
 */

/**
 * 解析 round-N 审核报告的模块结论小节：
 *   ## <文件名> (N行)
 *   **总体结论：<通过/有条件通过/不通过>
 * 返回 [{ file, conclusion }]。
 * 旧格式 fallback（无 ## 小节，如 round-1）：解析 H1 后首部的「**总体结论：**」+「**文件：**`xxx.ts`」。
 * 注：小节内取**首个**总体结论（审核时刻结论）；修复后的最终状态在报告正文，表内给报告链接。
 */
function parseRoundConclusions(f) {
  const text = read('audit', f);
  const lines = text.split('\n');
  const rows = [];
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^##\s+([\w.-]+\.ts)\s*(?:\((\d+)\s*行?\))?/);
    if (!m) continue;
    let conclusion = '';
    for (let j = i + 1; j < Math.min(i + 4, lines.length); j++) {
      const cm = lines[j].match(/\*\*总体结论[：:]\s*([^\*\n]+)/);
      if (cm) {
        conclusion = cm[1].trim();
        break;
      }
    }
    rows.push({ file: m[1], conclusion: conclusion || '—' });
  }
  if (rows.length > 0) return rows;
  // 旧格式 fallback：H1 标题后首部找「总体结论」+「文件：`xxx.ts`」
  // 注意 `**文件：** `frontend/...` 格式：加粗闭合 `**` 在冒号后（`文件：` 被加粗包裹）
  const head = lines.slice(0, 6).join('\n');
  const c = head.match(/\*\*总体结论[：:]\s*([^\*\n]+)/);
  const fl = head.match(/\*\*文件[：:]\*\*\s*`?([\w./-]+\.ts)`?/);
  if (c) {
    rows.push({ file: fl ? fl[1].split('/').pop() : f.replace(/^round-\d+-/, '').replace(/\.md$/, ''), conclusion: c[1].trim() });
  }
  return rows;
}

function buildAuditIndex() {
  const dated = [];
  const rounds = [];
  const topical = [];
  for (const f of mdFiles('audit')) {
    if (f === 'index.md' || f === 'README.md') continue;
    const d = f.match(/^(\d{4})-(\d{2})-(\d{2})-/);
    if (d) {
      dated.push({ file: f, year: d[1], month: d[2], day: d[3] });
      continue;
    }
    const r = f.match(/^round-(\d+)-/);
    if (r) {
      rounds.push({ file: f, n: parseInt(r[1], 10) });
      continue;
    }
    topical.push(f);
  }
  dated.sort((a, b) => b.file.localeCompare(a.file)); // 日期倒序
  rounds.sort((a, b) => a.n - b.n); // 轮次正序
  topical.sort((a, b) => a.localeCompare(b, 'zh-CN'));

  const byMonth = new Map();
  for (const d of dated) {
    const k = `${d.year}-${d.month}`;
    if (!byMonth.has(k)) byMonth.set(k, []);
    byMonth.get(k).push(d);
  }

  const out = [];
  out.push(BANNER('gen-docs-index.mjs'));
  out.push('');
  out.push('# 代码审核索引');
  out.push('');
  out.push(
    `> 审核台账共 **${dated.length + rounds.length + topical.length}** 篇：${dated.length} 篇按日期归档、` +
      `${rounds.length} 篇轮次记录、${topical.length} 篇专题审核。每篇记录审核范围、发现与结论。`
  );
  out.push('');
  out.push('> 汇总视图（执行摘要 / 风险全景 / 改进优先级）见 [审核总索引](./README.md)。');
  out.push('');
  for (const [ym, items] of byMonth) {
    const [y, mo] = ym.split('-');
    out.push(`## ${y} 年 ${Number(mo)} 月（${items.length}）`);
    out.push('');
    for (const it of items) {
      out.push(`- \`${it.file.slice(0, 10)}\` [${cell(h1(read('audit', it.file), it.file))}](${href('./' + it.file)})`);
    }
    out.push('');
  }
  if (rounds.length) {
    out.push(`## 审核轮次（${rounds.length}）`);
    out.push('');
    // 轮次结论表：解析 round-N 报告内「## <文件> (N行)」小节 + 紧随的「**总体结论：**」行，
    // 自动产出 轮次|文件|结论|报告——替代手写速查表（曾漏 round-8/9）。
    out.push('| 轮次 | 文件 | 结论 | 报告 |');
    out.push('|------|------|------|------|');
    for (const r of rounds) {
      const rows = parseRoundConclusions(r.file);
      const rLabel = `第${'①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳'[r.n - 1] ?? r.n}轮`;
      const reportCell = `[报告](${href('./' + r.file)})`;
      if (rows.length === 0) {
        // 报告无结构化小节（旧格式）：整篇一行
        out.push(`| ${rLabel} | ${cell(h1(read('audit', r.file), r.file))} | — | ${reportCell} |`);
        continue;
      }
      for (const row of rows) {
        out.push(`| ${rLabel} | ${row.file} | ${row.conclusion} | ${reportCell} |`);
      }
    }
    out.push('');
  }
  if (topical.length) {
    out.push(`## 专题审核（${topical.length}）`);
    out.push('');
    out.push('> 无统一日期/轮次前缀的审核记录（命名规范确立前），按标题排序。');
    out.push('');
    for (const f of topical) {
      out.push(`- [${cell(h1(read('audit', f), f))}](${href('./' + f)})`);
    }
    out.push('');
  }
  return out.join('\n');
}

// ── 5. 用户指南索引 ────────────────────────────────────────

/**
 * guide/ 首页索引：与其他分区（adr/knowledge/buglog/releases）保持一致——
 * 文档索引表格形态，替代原来的 layout: home 营销大首页（hero + features）。
 */
function buildGuideIndex() {
  const entries = [];
  for (const f of mdFiles('guide').sort((a, b) => a.localeCompare(b))) {
    if (f === 'README.md' || f === 'index.md') continue;
    const text = read('guide', f);
    entries.push({
      file: f,
      title: fm(text, 'title') || h1(text, f),
      desc: fm(text, 'description') || '',
    });
  }

  const out = [];
  out.push(BANNER('gen-docs-index.mjs'));
  out.push('');
  out.push('# 用户指南');
  out.push('');
  out.push(`> 按功能讲解入口路径与操作步骤，共 **${entries.length}** 篇。新功能持续建档，重跑 \`npm run gen:docsindex\` 自动入列。`);
  out.push('');
  out.push('| 指南页 | 说明 |');
  out.push('|--------|------|');
  for (const e of entries) {
    out.push(`| [${cell(e.title)}](${href('./' + e.file)}) | ${cell(e.desc) || '—'} |`);
  }
  out.push('');
  return out.join('\n');
}

// ── 主流程 ────────────────────────────────────────────────

const TARGETS = [
  { rel: 'guide/index.md', build: buildGuideIndex, label: '用户指南' },
  { rel: 'adr/index.md', build: buildAdrIndex, label: '决策记录' },
  { rel: 'knowledge/index.md', build: buildKnowledgeIndex, label: '知识卡' },
  { rel: 'buglog/index.md', build: buildBuglogIndex, label: 'Bug 日志' },
  { rel: 'releases/index.md', build: buildReleasesIndex, label: '发版记录' },
  { rel: 'audit/index.md', build: buildAuditIndex, label: '代码审核' },
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
      if (!CHECK) console.log(`✅ docs/${t.rel}（${t.label}）已是最新`);
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
