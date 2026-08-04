#!/usr/bin/env node
/**
 * gen-novel-index.mjs —— 全自动生成小说章节索引 `novel/README.md`。
 *
 * 背景：novel/README.md 原本由 AI 手动维护章节清单表格，长期漂移——
 *   漏列（磁盘有文件但索引没列）、重复（同文件被列两遍）、混入内部状态
 *   标记（如「已恢复」）。手写索引无法随章节文件增减自动同步。
 *
 * 本脚本让磁盘成为唯一事实源：扫描 novel/ 下所有子目录的章节 .md，
 * 解析编号 / 标题 / 相对路径，结合结构锁定的章元信息（10 主章 + 附录组）
 * 与「含 XX」内容摘要层（NOTES），重新生成整份 README.md。
 *
 * 设计原则：
 *   - 全文生成，禁止手改。重跑即同步，杜绝手写索引漂移。
 *   - 固定段（标题 / 引言 / 目录总览 / 各章简介 / 结尾）硬编码为结构常量，
 *     因其对应「代码目录锚定」这一锁定约定（AGENTS.md：10 章 + appendix 已锁定）。
 *   - 章节清单表 100% 由磁盘扫描得出。新增章节只需放一个 `NN-标题.md`，重跑即入列。
 *   - NOTES 是「含 XX」内容摘要的集中维护层（读者向技术覆盖说明），生成器会校验
 *     其 key 对应的文件在磁盘真实存在，防止路径漂移。未来可把 NOTES 搬进各章
 *     文件 frontmatter 的 `note:` 字段，实现零维护，届时本层可废弃。
 *
 * 用法：
 *   node scripts/gen-novel-index.mjs          # 写入 novel/README.md
 *   node scripts/gen-novel-index.mjs --check  # 校验是否已同步（CI 用，不写入）
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const NOVEL = path.join(ROOT, 'novel');
const README = path.join(NOVEL, 'README.md');
const CHECK = process.argv.includes('--check');

const BANNER =
  '<!-- 本文件由 scripts/gen-novel-index.mjs 自动生成，请勿手改。重跑：npm run gen:novelindex -->';

// ── 通用工具（复用 gen-docs-index.mjs 口径） ──────────────

/** 单元格转义：| 截断表格，换行破坏行结构。 */
function cell(s) {
  return String(s).replace(/\|/g, '\\|').replace(/\r?\n/g, ' ').trim();
}

/** 链接目标转义：含空格 / 括号用尖括号原样保留。 */
function href(rel) {
  return /[\s()]/.test(rel) ? `<${rel}>` : rel;
}

/** 取章节文件首行 H1 作标题，回退文件名（去 .md 与前缀）。 */
function titleOf(rel, fallbackTitle) {
  const text = fs.readFileSync(path.join(NOVEL, rel), 'utf8');
  const m = text.match(/^#\s+(.+)$/m);
  if (m) return m[1].trim();
  return fallbackTitle;
}

// ── 结构锁定的章元信息（10 主章） ───────────────────────

const MAIN_CHAPTERS = [
  {
    num: '01',
    folder: '01-基础设施与依赖',
    name: '基础设施与依赖',
    codeDir: 'frontend/src/core/',
    blurb: '共享状态、配置、文件URL、图标、UI helpers、快捷键路由。',
  },
  {
    num: '02',
    folder: '02-UI交互',
    name: 'UI交互',
    codeDir: 'frontend/src/menus/',
    blurb: 'MenuStack、弹窗、设置页、模型库 UI、动作 UI、环境 UI、场景 UI。',
  },
  {
    num: '03',
    folder: '03-动作演算',
    name: '动作演算',
    codeDir: 'frontend/src/motion-algos/',
    blurb: '程序化动作、VMD 写入、VPD 解析、节拍检测、LipSync 算法。',
  },
  {
    num: '04',
    folder: '04-音频与换装',
    name: '音频与换装',
    codeDir: 'frontend/src/outfit/',
    blurb: '音频播放、VMD 同步、节拍挂载、换装系统、纹理变体、FBX 叠加层。',
  },
  {
    num: '05',
    folder: '05-布料物理',
    name: '布料物理',
    codeDir: 'frontend/src/physics/',
    blurb: 'XPBD 求解器、布料生成、SDF 碰撞、调试可视化、布料管理器。',
  },
  {
    num: '06',
    folder: '06-相机移动',
    name: '相机移动',
    codeDir: 'frontend/src/scene/camera/',
    blurb: '相机模式、自由飞行、相机 VMD 轨道、轨道坐标统一。',
  },
  {
    num: '07',
    folder: '07-环境渲染',
    name: '环境渲染',
    codeDir: 'frontend/src/scene/env/',
    blurb: '天空、地面、雾、云、水、粒子、风、环境预设、光照推导。',
  },
  {
    num: '08',
    folder: '08-模型管理',
    name: '模型管理',
    codeDir: 'frontend/src/scene/manager/',
    blurb: '模型注册表、PMX 加载、缩略图、材质系统、模型操作、预设、保存触发。',
  },
  {
    num: '09',
    folder: '09-程序化动作',
    name: '程序化动作',
    codeDir: 'frontend/src/scene/motion/',
    blurb: 'VMD 加载播放、程序化动作桥接、LipSync 桥接、播放控制。',
  },
  {
    num: '10',
    folder: '10-灯光与阴影',
    name: '灯光与阴影',
    codeDir: 'frontend/src/scene/render/',
    blurb: '渲染管线、灯光、阴影、性能降级、后处理。',
  },
];

// ── 附录组（4 固定组 + 其他） ───────────────────────────

const APPENDIX_GROUPS = [
  {
    folder: 'appendix/跨模块重构',
    name: '跨模块重构',
    blurb: '多模块同时动刀的工程事件。',
  },
  {
    folder: 'appendix/文档演进',
    name: '文档演进',
    blurb: '文档 / 测试体系本身的发展。',
  },
  {
    folder: 'appendix/Go后端',
    name: 'Go 后端',
    blurb: 'Go 代码与 Wails 框架。',
  },
  {
    folder: 'appendix/安全横切',
    name: '安全横切',
    blurb: '横切多模块的安全问题。',
  },
];

/** 附录·其他：无 NN 编号前缀，单独维护「类别」映射。 */
const OTHER_META = {
  '附录·其他/隐形的面板-代码块.md': '代码附录',
  '附录·其他/隐形的面板-代码块-巨石原始稿.md': '原始稿存档',
};

// ── 「含 XX」内容摘要层（读者向技术覆盖说明） ──────────
// key = 相对路径；value = 摘要文本（生成时统一包裹中文括号）。
// 新增含 XX 备注只需在此添加一项；生成器会校验 key 对应文件存在。

const NOTES = {
  '01-基础设施与依赖/19-声音与按键.md': '含 AudioBus + ShortcutRegistry',
  '01-基础设施与依赖/20-五种语言.md': '含 i18n 五语言 + 热切换',
  '02-UI交互/13-调目.md': '含滑条手感↩21',
  '02-UI交互/19-图书馆的摆书人.md': '含楼层记忆↩20',
  '02-UI交互/30-账本的合并术.md':
    '含 SetUIState 整体替换→合并、视图模式重启持久化、3 测试失败留待后修',
  '02-UI交互/31-目录的记忆术.md':
    '含 ADR-097 路径记忆统一：isLeafFlattenDir / computeRestoreSegments / modelToResourceItem 三公共函数 + 网格视图同步 + 78→103 测试覆盖',
  '02-UI交互/32-审核的微光.md':
    '含联邦大面板迁移审核：i18n 硬编码清理 + visibleWhen 动态求值 + schema 测试覆盖补全 + renderFolder headerToggle 修复',
  '06-相机移动/04-双轴分野.md':
    '含 ADR-100 控制×行为双轴拆分 P1–P2 + 自动运镜 restore 饥饿修复',
  '07-环境渲染/07-反射与幽灵粒子.md': '含 ADR-092 反射统一 + ghost-particle-sim',
  '07-环境渲染/10-水面苏醒.md':
    'ADR-115 风格化水面波光：法线扰动+Sun Glitter+焦散暴露+无限水面+双尺度波高',
  '08-模型管理/10-不显影的证件照.md':
    '含缩略图三层缺陷：zip 路径错配 / 冻结快照不重绘 / resource_root 迁移孤儿',
  '08-模型管理/11-锁死的钥匙与沉默的笔.md':
    '含 ADR-119 单一源收口后写侧传参不对称：actor 漏 inst / replace 漏 innerPath，commit 52ba99a + 6fe8007',
  'appendix/跨模块重构/18-审计报告的最后一页.md': '含中段盘点↩14',
  'appendix/文档演进/11-回声的几何.md':
    '含 ADR-206 测试基础设施收敛：死代码清理 + 两层 mock 架构 + 断言质量 + 大文件拆分',
};

// ── 文件名解析 ───────────────────────────────────────────

/**
 * 解析章节文件名，返回展示编号 label 与排序键 sortKey。
 *   NN-标题.md  → 数字（去前导零），按数字排序
 *   00-序章.md  → "0"，排最前
 *   尾章-*.md   → "—"，排最后
 *   番外-*.md   → "番外"，排最后
 *   无编号       → 原样，排中间
 */
function parseName(file) {
  const base = file.replace(/\.md$/, '');
  if (/^尾章-/.test(base)) return { base, label: '—', sortKey: 2000 };
  if (/^番外-/.test(base)) return { base, label: '番外', sortKey: 2000 };
  const m = base.match(/^(\d{2})-(.*)$/);
  if (m) {
    const n = parseInt(m[1], 10);
    return { base, label: String(n), sortKey: n };
  }
  return { base, label: base, sortKey: 1000 };
}

/**
 * 由文件名派生展示标题（不读 H1：部分章节文件 H1 含「第 N 章 ·」噪音前缀，
 * 与索引表去编号的标题风格不一致）。
 *   NN-xxx.md    → xxx
 *   00-序章.md   → 序章
 *   尾章-xxx.md  → 尾章·xxx
 *   番外-xxx.md  → xxx
 */
function deriveTitle(base) {
  if (/^尾章-/.test(base)) return base.replace('尾章-', '尾章·');
  if (/^番外-/.test(base)) return base.replace('番外-', '');
  if (/^00-/.test(base)) return base.replace(/^00-/, '');
  return base.replace(/^\d{2}-/, '');
}

/** 扫描某文件夹下全部章节 .md，返回按 (sortKey, base) 排序的条目。 */
function scanFolder(folder) {
  const dir = path.join(NOVEL, folder);
  if (!fs.existsSync(dir)) {
    console.warn(`⚠️  跳过 ${folder}（目录不存在）`);
    return [];
  }
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.md'))
    .map((file) => {
      const rel = `${folder}/${file}`;
      const { base, label, sortKey } = parseName(file);
      const title = deriveTitle(base);
      const note = NOTES[rel];
      return { rel, label, sortKey, base, title, note };
    })
    .sort((a, b) => a.sortKey - b.sortKey || a.base.localeCompare(b.base, 'zh-CN'));
}

/** 生成标准章节清单表（| 章 | 标题 |）。 */
function buildTable(entries) {
  const rows = ['| 章 | 标题 |', '|----|------|'];
  for (const e of entries) {
    const link = `[${cell(e.title)}](${href(e.rel)})`;
    rows.push(`| ${e.label} | ${link}${e.note ? `（${e.note}）` : ''} |`);
  }
  return rows.join('\n');
}

/** 生成附录·其他（| 类别 | 标题 |）。 */
function buildOtherTable() {
  const rows = ['| 类别 | 标题 |', '|------|------|'];
  for (const [rel, cat] of Object.entries(OTHER_META)) {
    const title = titleOf(rel, rel.replace(/\.md$/, '').replace(/^.*\//, ''));
    rows.push(`| ${cat} | [${cell(title)}](${href(rel)}) |`);
  }
  return rows.join('\n');
}

// ── 主流程 ───────────────────────────────────────────────

function buildReadme() {
  const out = [];
  out.push(BANNER);
  out.push('');
  out.push('# 编码奇谭：MikuMikuAR 联邦演义');
  out.push('');
  out.push(
    '> 在一个 PMX 模型散落于各城邦的世界里，一个桌面壳不发明任何东西，只让所有城邦共享同一个模型库。'
  );
  out.push('');
  out.push('---');
  out.push('');
  out.push('## 目录结构总览');
  out.push('');
  out.push(
    '本小说按 `frontend/src/` 代码目录锚定 10 章 + 1 个附录容器。**改了代码 → 看路径前缀 → 命中对应章 → 更新该章尾部。**'
  );
  out.push('');
  out.push('| 章号 | 文件夹 | 对应代码目录 |');
  out.push('|------|--------|------------|');
  for (const c of MAIN_CHAPTERS) {
    out.push(`| ${c.num} | \`${c.folder}/\` | \`${c.codeDir}\` |`);
  }
  out.push('');
  out.push(
    '附录 `appendix/` 收纳非代码目录锚定的章节，分 4 组：跨模块重构 / 文档演进 / Go后端 / 安全横切。'
  );
  out.push('');
  out.push('判定规则与决策链路详见 [AGENTS.md](AGENTS.md)。');
  out.push('');
  out.push('---');
  out.push('');

  // 10 主章
  for (const c of MAIN_CHAPTERS) {
    out.push(`## ${c.num}-${c.name} · 对应 \`${c.codeDir}\``);
    out.push('');
    out.push(c.blurb);
    out.push('');
    out.push(buildTable(scanFolder(c.folder)));
    out.push('');
    out.push('---');
    out.push('');
  }

  // 4 附录组
  for (const g of APPENDIX_GROUPS) {
    out.push(`## 附录 · ${g.name}`);
    out.push('');
    out.push(g.blurb);
    out.push('');
    out.push(buildTable(scanFolder(g.folder)));
    out.push('');
    out.push('---');
    out.push('');
  }

  // 附录·其他
  out.push('## 附录 · 其他');
  out.push('');
  out.push(buildOtherTable());
  out.push('');
  out.push('---');
  out.push('');

  out.push(
    '**章节计数**：本目录不再维护章节总数统计表。新增章节只需在对应章文件夹放置 `NN-标题.md`，重跑 `npm run gen:novelindex` 即自动入列；索引由脚本生成，请勿手改。'
  );
  out.push('');

  return out.join('\n');
}

function main() {
  // NOTES 校验：key 对应文件必须真实存在，否则索引会指向幽灵章节
  for (const rel of Object.keys(NOTES)) {
    if (!fs.existsSync(path.join(NOVEL, rel))) {
      console.warn(`⚠️  NOTES 引用了不存在的文件：${rel}（请核对或删除该 NOTES 项）`);
    }
  }
  // OTHER_META 校验
  for (const rel of Object.keys(OTHER_META)) {
    if (!fs.existsSync(path.join(NOVEL, rel))) {
      console.warn(`⚠️  OTHER_META 引用了不存在的文件：${rel}`);
    }
  }

  const expected = buildReadme().replace(/\s+$/, '') + '\n';
  const actual = fs.existsSync(README) ? fs.readFileSync(README, 'utf8') : null;

  if (CHECK) {
    if (actual === expected) {
      console.log('✅ novel/README.md 索引已同步');
      return;
    }
    console.error('❌ novel/README.md 未同步，请运行：npm run gen:novelindex');
    process.exit(1);
  }

  if (actual === expected) {
    console.log('✓ novel/README.md 已是最新，无需写入');
    return;
  }
  fs.writeFileSync(README, expected, 'utf8');
  console.log('✅ 已生成 novel/README.md');
}

main();
