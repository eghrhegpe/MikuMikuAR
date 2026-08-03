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
import { toPosix } from './_lib/to-posix.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

const CONFIG = {
  // 符号覆盖率扫描根（近期子系统集中地）。可加目录扩展覆盖面。
  sourceRoots: [
    'frontend/src/scene',
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
    /i18n\/locales\//,  // 翻译数据文件（非逻辑模块，无需知识卡覆盖）
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
    const rel = toPosix(full);
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
    const rel = toPosix(full);
    if (CONFIG.repoExclude.some((re) => re.test(rel))) continue;
    if (e.isDirectory()) walkRepo(full, out);
    else if (e.isFile()) out.push(e.name);
  }
  return out;
}

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const appearsIn = (text, sym) =>
  new RegExp('\\b' + escapeRe(sym) + '\\b').test(text);

// 知识卡 API 符号检查：跳过极短 token 与常见框架/内置符号，降低误报噪声。
const API_SYMBOL_MIN_LEN = 3;
const API_SYMBOL_DENYLIST = new Set([
  'console', 'Math', 'Object', 'Array', 'Promise', 'JSON', 'Map', 'Set',
  'String', 'Number', 'Boolean', 'Error', 'Date', 'Symbol', 'RegExp',
  'require', 'super', 'void', 'MeshBuilder', 'Vector2', 'Vector3', 'Color3',
  'Color4', 'Quaternion', 'Matrix', 'Scene', 'Observable', 'Observer',
  'TransformNode', 'AbstractMesh', 'Mesh', 'Material', 'Texture', 'Node',
  'PBRMaterial', 'StandardMaterial', 'Scalar', 'Tools', 'Animation',
  'requestAnimationFrame', 'setTimeout', 'clearTimeout', 'setInterval',
]);

// 从 architecture.md 目录树行中提取所有引用的文件名（basename）
function getArchTreeBasenames() {
  const arch = read(CONFIG.archDoc);
  const names = new Set();
  const re = /[├└]──\s*([^\s#├└]+\.(?:ts|go))/g;
  let m;
  while ((m = re.exec(arch))) {
    // token 可能是 core/state.ts 或 motion-slot.ts → 统一取 basename
    names.add(path.basename(m[1]));
  }
  return names;
}

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
  const archTreeBasenames = getArchTreeBasenames();
  const undocumentedByDir = {};
  let undocumented = 0;
  for (const f of files) {
    const syms = getExportedSymbols(f);
    if (syms.length === 0) continue;
    const inArch = syms.filter((s) => appearsIn(arch, s)).length;
    const inFunc = syms.filter((s) => appearsIn(func, s)).length;
    const coverage = Math.max(inArch, inFunc) / syms.length;
    if (coverage === 0 && !archTreeBasenames.has(path.basename(f))) {
      undocumented++;
      const rel = toPosix(f).replace(toPosix(ROOT) + '/', '');
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

// ---------- 检查 8/9/10：知识卡 frontmatter 治理（ADR-218） ----------
// 8 (ERROR) category 枚举校验；9 (ERROR) tier 枚举校验；10 (WARN) architecture 卡须登记 UI 入口
// （有「## UI 入口」小节，或引用集中式菜单地图 menu-map.md —— 避免双写漂移）。
// 另含（ERROR）必填字段齐全（kind/name/category）、模板占位符 <...> 未填充、kind 为 snake_case。
const CATEGORY_ENUM = ['rendering', 'env', 'motion', 'ui', 'core', 'backend', 'physics', 'scene'];
const TIER_ENUM = ['architecture', 'leaf'];
const UI_ENTRY_HEADING = '## UI 入口';
const UI_ENTRY_REF = 'menu-map.md'; // 集中式菜单地图（scripts/gen-menu-map.mjs 自动生成）

// 解析 frontmatter 全部标量字段（key -> 值字符串；块列表的 key 记为空串，行内数组也记为存在）
function parseFrontmatterFields(text) {
  const fm = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  const map = {};
  if (!fm) return map;
  for (const line of fm[1].split(/\r?\n/)) {
    const m = line.match(/^([A-Za-z_][\w-]*)\s*:\s*(.*)$/);
    if (m) map[m[1]] = m[2].trim();
  }
  return map;
}

const PLACEHOLDER_RE = /^<.*>$/;
const KIND_RE = /^[a-z][a-z0-9_]*$/;
const REQUIRED_FIELDS = ['kind', 'name', 'category'];

// （ADR-218 痛点）frontmatter 结构治理
//  - 必填字段齐全（kind / name / category）
//  - 模板占位符 <...> 未填充（如把 README 模板直接粘进真卡忘改）
//  - kind 为 snake_case 自由标识符（非固定枚举）
//  - category / tier 枚举（沿用既有逻辑）
function checkKnowledgeMeta() {
  const dir = path.join(ROOT, CONFIG.knowledgeDir);
  if (!fs.existsSync(dir)) return { errors: [], warns: [] };
  const errors = [];
  const warns = [];
  for (const cf of fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.md') && f.toLowerCase() !== 'readme.md')) {
    const text = fs.readFileSync(path.join(dir, cf), 'utf8');
    // 无 frontmatter 的非知识卡文件（如 routes.md 路由表）跳过治理检查
    if (!/^---\r?\n/.test(text)) continue;
    const fields = parseFrontmatterFields(text);

    // 必填字段
    for (const key of REQUIRED_FIELDS) {
      const v = fields[key];
      if (v === undefined || v === '') {
        errors.push(`知识卡 ${cf} 缺少必填字段 ${key}`);
      }
    }

    // 模板占位符（未填充的 <...>）
    for (const [k, v] of Object.entries(fields)) {
      if (v !== '' && PLACEHOLDER_RE.test(v)) {
        errors.push(`知识卡 ${cf} 的 ${k} 含未填充模板占位符: ${v}`);
      }
    }

    // kind 格式（自由 snake_case 标识符，非固定枚举）
    const kind = fields['kind'];
    if (kind && kind !== '' && !KIND_RE.test(kind)) {
      errors.push(`知识卡 ${cf} 的 kind 非法: ${kind}（应为 snake_case，如 camera_angle）`);
    }

    // category 枚举
    const category = fields['category'];
    if (category !== undefined && category !== '' && !CATEGORY_ENUM.includes(category)) {
      errors.push(`知识卡 ${cf} 的 category 非法: ${category}（应为 ${CATEGORY_ENUM.join('|')} 之一）`);
    }
    // tier 枚举
    const tier = fields['tier'];
    if (tier !== undefined && tier !== '' && !TIER_ENUM.includes(tier)) {
      errors.push(`知识卡 ${cf} 的 tier 非法: ${tier}（应为 ${TIER_ENUM.join('|')} 之一）`);
    }
    // frontmatter 字段语义校验（ADR-230）：路径类值（frontend/...）只允许出现在
    // source_files / tests / scope 三个字段内；其余字段（invariants/use_when 等）混入路径
    // 说明脚本重建 frontmatter 时污染了字段（历史事故：gen-knowledge-tests 曾把 tests 路径
    // 残留在 invariants 块内，26 张卡受影响）。
    {
      const fmBlock = (text.match(/^---\r?\n([\s\S]*?)\r?\n---/) || [])[1] || '';
      const PATH_FIELDS = new Set(['source_files', 'tests', 'scope']);
      let curField = null;
      for (const line of fmBlock.split(/\r?\n/)) {
        const fieldMatch = line.match(/^([a-z_]+):/);
        if (fieldMatch) {
          curField = fieldMatch[1];
          continue;
        }
        if (
          curField &&
          !PATH_FIELDS.has(curField) &&
          /^\s*-\s*(frontend\/\S+\.ts)\s*$/.test(line)
        ) {
          errors.push(`知识卡 ${cf} 的 ${curField} 字段混入 frontend/ 路径行（仅 source_files/tests/scope 允许）: ${line.trim()}`);
          break;
        }
      }
    }
    // UI 入口要求（ADR-218）：仅对 source_files 含 menus/ 或 ui/ 的 architecture 卡强制——
    // 纯逻辑卡（env 系统 / motion 管道 / physics 等）本就无菜单入口，豁免。
    if (tier === 'architecture' && !text.includes(UI_ENTRY_HEADING) && !text.includes(UI_ENTRY_REF)) {
      const fmBlock = (text.match(/^---\r?\n([\s\S]*?)\r?\n---/) || [])[1] || '';
      const sources = [...fmBlock.matchAll(/^\s*-\s*(frontend\/\S+)\s*$/gm)].map((m) => m[1]);
      const hasUiSource = sources.some((s) => /\/menus\/|\/ui\//.test(s));
      if (hasUiSource) {
        warns.push(`architecture 卡 ${cf} 缺少「${UI_ENTRY_HEADING}」小节且未引用 ${UI_ENTRY_REF}（ADR-218）`);
      }
    }
  }
  return { errors, warns };
}

// ---------- 检查 11：知识索引（README 索引 / routes 路由表）链接存在性（ERROR） ----------
// README 索引表与 routes 路由表是手写索引，链接指向 ./xxx.md 知识卡；
// 卡被归档/删除后索引易残留断链（历史:preset-manager/watch-import 曾漏网）。
// 扫描两份索引的所有 ./xxx.md 链接,目标卡不存在即报 ERROR。
const KNOWLEDGE_INDEX_FILES = ['README.md', 'routes.md'];
const INDEX_LINK_RE = /\]\(\.\/([a-zA-Z0-9-]+\.md)\)/g;

function checkKnowledgeIndexLinks() {
  const dir = path.join(ROOT, CONFIG.knowledgeDir);
  if (!fs.existsSync(dir)) return { errors: [] };
  const errors = [];
  for (const idx of KNOWLEDGE_INDEX_FILES) {
    const file = path.join(dir, idx);
    if (!fs.existsSync(file)) continue;
    const text = fs.readFileSync(file, 'utf8');
    for (const m of text.matchAll(INDEX_LINK_RE)) {
      const target = m[1];
      if (!fs.existsSync(path.join(dir, target))) {
        errors.push(`知识索引 ${idx} 链接指向不存在的卡：${target}`);
      }
    }
  }
  return { errors };
}
// 与检查 4（卡片 source_files 是否真实存在）互补：从「代码现实」出发，
// 扫描 sourceRoots 下每个 .ts 源文件，确认至少有 1 张知识卡的 source_files 引用了它。
// 列为 INFO（不阻断 CI），用于揭示「代码有模块、知识库无卡片」的盲区，指导持续补登。
function checkKnowledgeCoverage() {
  const dir = path.join(ROOT, CONFIG.knowledgeDir);
  if (!fs.existsSync(dir)) {
    return { total: 0, byDir: {}, files: [] };
  }
  const cardFiles = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.md') && f.toLowerCase() !== 'readme.md');
  const referenced = new Set();
  for (const cf of cardFiles) {
    const text = fs.readFileSync(path.join(dir, cf), 'utf8');
    for (const src of parseSourceFiles(text)) {
      referenced.add(toPosix(src));
    }
  }
  const byDir = {};
  const files = [];
  let total = 0;
  for (const root of CONFIG.sourceRoots) {
    for (const f of walk(path.join(ROOT, root))) {
      const rel = toPosix(f).replace(toPosix(ROOT) + '/', '');
      if (referenced.has(rel)) continue;
      total++;
      files.push(rel);
      const top = rel.split('/').slice(1, 3).join('/'); // frontend/src/<a>/<b>
      byDir[top] = (byDir[top] || 0) + 1;
    }
  }
  return { total, byDir, files };
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

// ---------- 检查 6：知识卡「对外 API」符号真实存在性（INFO） ----------
// 设计：构建 sourceRoots 下全部 .ts 导出符号的全局索引（含 re-export 目标，
// 故 barrel 入口文件声明的上游函数也能命中），对每张卡正文中 `` `name(...)` ``
// 形式的符号逐一校验：是否出现在全局导出索引，或其自身 source_files 源码文本中。
// 全部查无 → 标记为可疑（捕捉编造/更名的函数名，如 enterAR / buildModelDetailLevel）。
// 列为 INFO：误报（引用框架/外部符号）不阻断 CI，仅供人工复核。
function buildGlobalExportIndex() {
  const index = new Map(); // name -> Set(relPath)
  for (const root of CONFIG.sourceRoots) {
    for (const f of walk(path.join(ROOT, root))) {
      let syms = [];
      try {
        syms = getExportedSymbols(f);
      } catch {
        continue;
      }
      const rel = toPosix(f).replace(toPosix(ROOT) + '/', '');
      for (const s of syms) {
        if (!index.has(s)) index.set(s, new Set());
        index.get(s).add(rel);
      }
    }
  }
  return index;
}

function checkCardApiSymbols(globalIndex) {
  const dir = path.join(ROOT, CONFIG.knowledgeDir);
  if (!fs.existsSync(dir)) return { checked: 0, flagged: [] };
  const cardFiles = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.md') && f.toLowerCase() !== 'readme.md');
  const flagged = [];
  let checked = 0;
  for (const cf of cardFiles) {
    const text = fs.readFileSync(path.join(dir, cf), 'utf8');
    const sources = parseSourceFiles(text);
    const body = text.replace(/^---[\s\S]*?---/, ''); // 去 frontmatter
    const callRe = /`([A-Za-z_$][\w$]*)\s*\(/g;
    let m;
    const candidates = new Set();
    while ((m = callRe.exec(body))) {
      const name = m[1];
      if (name.length < API_SYMBOL_MIN_LEN) continue;
      if (API_SYMBOL_DENYLIST.has(name)) continue;
      candidates.add(name);
    }
    if (candidates.size === 0) continue;
    // 卡片自身 source_files 的源码文本（兜底：未导出但被调用的内部符号）
    let localText = '';
    for (const src of sources) {
      const abs = path.join(ROOT, src);
      if (fs.existsSync(abs)) localText += '\n' + fs.readFileSync(abs, 'utf8');
    }
    const missing = [];
    for (const c of candidates) {
      if (globalIndex.has(c)) continue;
      if (localText && appearsIn(localText, c)) continue;
      missing.push(c);
    }
    if (missing.length > 0 && missing.length === candidates.size) {
      checked++;
      flagged.push({ card: cf, missing: [...missing].slice(0, 15) });
    }
  }
  return { checked, flagged };
}

// ---------- 检查 7：AGENTS.md 不应手列事实索引（WARN） ----------
// 设计：根 AGENTS.md 与 frontend/AGENTS.md 只承载「命令 + 约定 + 指针」，
// 不手列目录树 / ADR 状态表等事实索引（易漂移，且已被 gen:funcmap / gen:status 覆盖）。
// 命中以下任一特征 → WARN（不进 errors，不阻断 EXIT）：
//   (a) 手工目录树：含 box-drawing 缩进树（├── / └──）
//   (b) 手工 ADR 状态表：行首 `| ADR-<n> |`（区别于 `docs/adr/adr-<n>-*.md` 链接引用）
function checkAgentsNoHandcraftedIndex() {
  const targets = ['AGENTS.md', 'frontend/AGENTS.md'];
  const warns = [];
  for (const rel of targets) {
    const text = read(rel);
    if (!text) continue;
    const lines = text.split('\n');
    let treeHits = 0;
    let adrTableHits = 0;
    for (const line of lines) {
      if (/^[│├└]\s*[├└]──\s/.test(line) || /^\s*├──\s/.test(line) || /^\s*└──\s/.test(line)) {
        treeHits++;
      }
      if (/^\|\s*ADR-\d+\s*\|/.test(line)) {
        adrTableHits++;
      }
    }
    if (treeHits > 0) warns.push(`${rel} 含手工目录树特征（${treeHits} 行 ├──/└──），应改为指针指向 gen:funcmap`);
    if (adrTableHits > 0) warns.push(`${rel} 含手工 ADR 状态表（${adrTableHits} 行 | ADR-xxx |），应改为指针指向 gen:status`);
  }
  return warns;
}

// ── INFO 基线 ──

const BASELINE_FILE = path.join(ROOT, 'docs', '.doc-check-baseline.json');

function readBaseline() {
  try { return JSON.parse(fs.readFileSync(BASELINE_FILE, 'utf8')); } catch { return null; }
}

function writeBaseline(counts) {
  const data = { ...counts, updatedAt: new Date().toISOString().slice(0, 10) };
  fs.writeFileSync(BASELINE_FILE, JSON.stringify(data, null, 2) + '\n');
}

const BASELINE_TRACKED = [
  ['undocumentedModules', '符号 0% 未文档化模块'],
  ['uncoveredSourceFiles', '知识卡未覆盖源文件'],
  ['apiSymbolFlaggedCards', '知识卡 API 符号可疑卡'],
];

function getInfoCounts(cov, rev, apiSym) {
  return {
    undocumentedModules: cov.undocumented,
    uncoveredSourceFiles: rev.total,
    apiSymbolFlaggedCards: apiSym.flagged.length,
  };
}

// ---------- 主流程 ----------
function main() {
  const json = process.argv.includes('--json');
  const baselineMode = process.argv.includes('--baseline');
  const baselineUpdate = process.argv.includes('--baseline-update');
  const errors = [];

  // --baseline-update：手动确认当前基线
  if (baselineUpdate) {
    // 先跑一遍检查获取最新数据
    const cov = checkSymbolCoverage();
    const rev = checkKnowledgeCoverage();
    const globalIndex = buildGlobalExportIndex();
    const apiSym = checkCardApiSymbols(globalIndex);
    const counts = getInfoCounts(cov, rev, apiSym);
    writeBaseline(counts);
    console.log(`✅ 基线已更新: ${JSON.stringify(counts)}`);
    process.exit(0);
  }

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

  const km = checkKnowledgeMeta();
  for (const e of km.errors) {
    errors.push(`知识卡治理：${e}`);
  }
  const knowledgeMetaWarns = km.warns;

  const kix = checkKnowledgeIndexLinks();
  for (const e of kix.errors) {
    errors.push(`知识索引断链：${e}`);
  }

  const rev = checkKnowledgeCoverage();

  const globalIndex = buildGlobalExportIndex();
  const apiSym = checkCardApiSymbols(globalIndex);

  const generatedStatusError = checkGeneratedStatus();
  const agentsWarns = checkAgentsNoHandcraftedIndex();
  if (generatedStatusError) {
    errors.push(`status.md ADR 生成区未同步：${generatedStatusError}`);
  }

  // ── INFO 基线对比（不阻断，仅 warning） ──
  const infoCounts = getInfoCounts(cov, rev, apiSym);
  const baseline = readBaseline();
  const infoWarnings = [];
  let baselineChanged = false;

  if (baseline) {
    for (const [key, label] of BASELINE_TRACKED) {
      if (infoCounts[key] > baseline[key]) {
        infoWarnings.push(`${label} 从 ${baseline[key]} 增至 ${infoCounts[key]}`);
      }
      if (infoCounts[key] !== baseline[key]) {
        baselineChanged = true;
      }
    }

    // 自动更新基线（只在指标改善时，且非 --baseline 只读模式）
    if (!baselineMode && baselineChanged) {
      const improved = BASELINE_TRACKED.some(([k]) => infoCounts[k] < baseline[k]);
      if (improved) {
        writeBaseline(infoCounts);
      }
    }
  } else if (!baselineMode) {
    // 首次运行，创建基线
    writeBaseline(infoCounts);
  }

  if (json) {
    console.log(
      JSON.stringify({ adr, stale, coverage: cov, knowledge: kc, reverse: rev, apiSymbols: apiSym, agentsWarns, errors }, null, 2)
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
  console.log(`知识卡治理 category/tier  : ${km.errors.length ? km.errors.length + ' 个 ❌' : '无 ✅'}`);
  console.log(`architecture 卡缺 UI 入口 : ${knowledgeMetaWarns.length ? knowledgeMetaWarns.length + ' 张（WARN）' : '无 ✅'}`);
  console.log(`知识索引断链(README/routes): ${kix.errors.length ? kix.errors.length + ' 个 ❌' : '无 ✅'}`);
  console.log(`符号 0% 未文档化模块     : ${cov.undocumented}（INFO）`);
  console.log(`知识卡未覆盖源文件       : ${rev.total} 个（INFO）`);
  if (rev.total) {
    const parts = Object.entries(rev.byDir)
      .sort((a, b) => b[1] - a[1])
      .map(([d, n]) => `${d}: ${n}`);
    console.log('   按目录: ' + parts.join('，'));
  }
  console.log(`知识卡 API 符号可疑卡     : ${apiSym.flagged.length} 张（INFO）`);
  if (apiSym.flagged.length) {
    for (const f of apiSym.flagged.slice(0, 20)) {
      console.log(`   ⚠ ${f.card} — 查无符号: ${f.missing.join(', ')}`);
    }
  }
  if (cov.undocumented) {
    const parts = Object.entries(cov.undocumentedByDir)
      .sort((a, b) => b[1] - a[1])
      .map(([d, n]) => `${d}: ${n}`);
    console.log('   按目录: ' + parts.join('，'));
  }
  console.log('────────────────────────────────────────────');
  if (agentsWarns.length) {
    console.log(`⚠ AGENTS.md 手写事实索引（WARN，不阻断）: ${agentsWarns.length} 项`);
    agentsWarns.forEach((w) => console.log('   ⚠ ' + w));
  }
  if (infoWarnings.length) {
    console.log('⚠ INFO 基线变更（仅参考，不阻断）:');
    infoWarnings.forEach((w) => console.log('   ⚠ ' + w));
    // 显示具体新增未覆盖文件，让 AI/人知道变了什么
    if (rev.total && rev.files?.length) {
      console.log('   新增未覆盖源文件:');
      for (const f of rev.files.slice(0, 20)) console.log('      ' + f);
      if (rev.files.length > 20) console.log(`      ...及其他 ${rev.files.length - 20} 个`);
    }
    if (cov.undocumented && cov.undocumentedByDir) {
      const parts = Object.entries(cov.undocumentedByDir)
        .sort((a, b) => b[1] - a[1])
        .map(([d, n]) => `${d}: ${n}`);
      console.log('   符号覆盖率缺口按目录: ' + parts.join('，'));
    }
    console.log('   更新基线: node scripts/check-doc-drift.mjs --baseline-update');
  }

  // 基线状态行
  if (baseline) {
    const improved = baselineChanged && BASELINE_TRACKED.some(([k]) => infoCounts[k] < baseline[k]);
    const status = improved ? '✅ 基线改善' : baselineChanged ? '⚪ 基线变化' : '✅ 基线清洁';
    const brief = `${cov.undocumented}/${rev.total}/${apiSym.flagged.length}`;
    console.log(`📊 INFO 基线: ${brief}（${status}）`);
  }

  if (errors.length) {
    console.log('❌ ERROR:');
    errors.forEach((e) => console.log('   ' + e));
    console.log('\n退出码 1（可接 CI 卡点）。');
  } else {
    console.log('✅ 未检测到 ERROR 级漂移。');
  }
  // 兜底提示：仅当上方未输出「INFO 基线变更」详情块时（首次无基线/基线未变更），
  // 才单独提示消除缺口的方式，避免同一信息重复三遍。
  if (infoWarnings.length === 0) {
    if (cov.undocumented > 0) {
      console.log(`📋 INFO: 符号 0% 未文档化模块 ${cov.undocumented} 个为参考项，不阻断；补登 architecture.md 树 / function-map.md 即可消除。`);
    }
    if (rev.total > 0) {
      console.log(`📋 INFO: ${rev.total} 个源文件尚无知识卡覆盖为参考项，不阻断；为其建立 docs/knowledge/ 知识卡并登记 source_files 即可消除。`);
    }
  }

  process.exit(errors.length ? 1 : 0);
}

main();
