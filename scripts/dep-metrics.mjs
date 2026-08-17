#!/usr/bin/env node
/**
 * dep-metrics.mjs — 依赖耦合台账：把「耦合度」变成可复算的刻度（Ca / Ce / I / 双向密耦 / 环参与）。
 *
 * 用法：
 *   node scripts/dep-metrics.mjs                          # markdown 台账（stdout）
 *   node scripts/dep-metrics.mjs --file docs/dep-metrics.md   # 写盘
 *   node scripts/dep-metrics.mjs --json                   # 机器可读快照（提交后与上期 git diff 看趋势）
 *   node scripts/dep-metrics.mjs --file docs/dep-metrics.md --check  # 只比对，不同步即 exit 1
 *
 * 指标口径（Robert Martin 耦合度量，勿自造刻度）：
 *   Ca =  afferent：被多少个 frontend/src 内部文件 import（入度）
 *   Ce =  efferent：它 import 了多少个内部文件（出度）
 *   I  =  Ce/(Ca+Ce) ∈ [0,1] 不稳定度：0≈稳定核心（人人接它），1≈叶梢（它接人人）；0/0 → —
 *   管路节点 = Ca≥10 且 Ce≥10 的文件（高入高出的中枢，一次改动易牵连全身）
 *   模块分组 / 环枚举：与 check:circular 同一实现（getModule / detectCycles / 代表环合并），
 *   白名单同读 scripts/circular-allowlist.json，且判定用同一把 key（`cycleSetKey` 节点集合，
 *   [ADR-268 决策 4]）—— 全仓只此一把尺，台账的「🆕 新增」恒等于门禁的阻断集合。
 * 边口径：解析成功的内部 import，**不含动态 import()**（[ADR-268] 环口径 = 模块加载期依赖，
 *   与 check:circular --strict 完全同源）；测试文件已被 source-graph 排除。
 *
 * 零依赖（node:fs / node:path / node:url）。
 * 设计意图：给 ADR-033「耦合评分 8/10」补一把可复算、可对比的尺子（锐评处方一落地）
 * 退出码：1（失败 / frontend/src 缺失）
 */

import fs from 'node:fs';
import path from 'node:path';
import { scanSourceGraph } from './_lib/source-graph.mjs';
import { parseArgs } from './_lib/parse-args.mjs';
import { ROOT } from './_lib/scan-files.mjs';
import { tarjanScc, nontrivialSccs, sccSummary } from './_lib/scc.mjs';

const SRC_DIR = path.join(ROOT, 'frontend', 'src');
const PIPE_MIN_CA = 10;
const PIPE_MIN_CE = 10;
const TOP_N = 15;

/**
 * 复用 check-circular 的导出的环检测函数。
 * ⚠️ check-circular.mjs 在【模块顶层】就 parseArgs(process.argv)（未知 flag 顶层 exit 1），
 *    本脚本的 flag 会被它误读成它的输入。import 期间临时递它裸 argv，取完恢复。
 *    （这正是锐评里「CLI 顶层副作用」耦合的具体样本；根治应把纯函数抽 _lib/circular.mjs，待另立项。）
 */
async function importCheckCircular() {
  const real = process.argv.slice();
  process.argv = real.slice(0, 2);
  try {
    return await import('./check-circular.mjs');
  } finally {
    process.argv.length = 0;
    process.argv.push(...real);
  }
}

/**
 * 与 check-circular.loadAllowlist 同一到期语义（处方二）：
 * 条目级 expires 过期 → 不计入 keys（对应环显示 🆕，与 --strict 阻断口径一致）；
 * reviewBy 仅展示（阻断是门禁的职责，台账不造第二把锁）。
 *
 * [ADR-268 决策 4] 直接复用 check-circular 的 loadAllowlist，不在此处二次解析 JSON——
 * 两份实现各解析一遍就是两把尺子的起点（key 口径漂移正是这么来的）。返回形状适配成台账用
 * （expired 只要计数）。
 */
function adaptAllowlist(cc) {
  const a = cc.loadAllowlist();
  return { keys: a.keys, expired: a.expired.length, reviewBy: a.reviewBy, reviewOverdue: a.reviewOverdue };
}

/** I = Ce/(Ca+Ce)，0/0 → null */
function instability(ca, ce) {
  return ca + ce === 0 ? null : ce / (ca + ce);
}

const fmtI = (v) => (v === null ? '—' : v.toFixed(2));

/** 核心计算：文件级 + 模块级 Ca/Ce、耦合矩阵、双向密耦对、环清单（全部确定性排序） */
async function compute() {
  if (!fs.existsSync(SRC_DIR)) {
    console.error(`❌ frontend/src 目录不存在：${SRC_DIR}（子模块未检出或 cwd 错误）`);
    process.exit(1);
  }
  // [ADR-268] 与 check:circular 同口径：动态 import() 不计入（见文件头口径说明）。
  const { files, graph } = scanSourceGraph(SRC_DIR, { includeDynamic: false });
  if (files.length === 0) {
    console.error(`❌ 未扫描到任何 TS 文件（srcDir=${SRC_DIR}），疑似扫描异常`);
    process.exit(1);
  }

  const cc = await importCheckCircular();

  // ── 文件级 ──
  const fileSet = new Set(files.map((f) => f.rel));
  const ca = new Map([...fileSet].map((r) => [r, 0]));
  const ce = new Map([...fileSet].map((r) => [r, 0]));
  let edgeCount = 0;
  for (const [from, deps] of graph) {
    for (const to of deps) {
      if (!fileSet.has(to)) continue; // 只计内部边
      edgeCount++;
      ce.set(from, ce.get(from) + 1);
      ca.set(to, ca.get(to) + 1);
    }
  }
  const fileMetrics = [...fileSet].sort().map((rel) => ({
    rel, ca: ca.get(rel), ce: ce.get(rel),
    instability: instability(ca.get(rel), ce.get(rel)),
  }));

  // ── 模块级（分组口径 = check-circular 的 getModule）──
  const moduleName = (rel) => cc.getModule(rel);
  const modOf = new Map(); // name -> {files, ca, ce}
  for (const rel of fileSet) {
    const m = modOf.get(moduleName(rel)) || { name: moduleName(rel), files: 0, ca: 0, ce: 0 };
    m.files++;
    modOf.set(m.name, m);
  }
  const matrix = new Map(); // "from|to" -> 文件级边数（跨模块）
  for (const [from, deps] of graph) {
    const fm = moduleName(from);
    for (const to of deps) {
      if (!fileSet.has(to)) continue;
      const tm = moduleName(to);
      if (fm === tm) continue;
      const key = `${fm}|${tm}`;
      matrix.set(key, (matrix.get(key) || 0) + 1);
      modOf.get(fm).ce++;
      modOf.get(tm).ca++;
    }
  }

  // 双向密耦对：A→B 与 B→A 均有跨模块边
  const bidirectional = [];
  for (const [key, n] of [...matrix.entries()].sort()) {
    const [a, b] = key.split('|');
    if (a >= b) continue; // 每对只看一次（字典序小者发起）
    const back = matrix.get(`${b}|${a}`);
    if (back) bidirectional.push({ a, b, forward: n, backward: back });
  }

  // ── 环（与门禁同一实现）──
  const { moduleGraph } = cc.buildModuleGraph(graph);
  const rawCycles = cc.dedupeCycles(cc.detectCycles(moduleGraph));
  const repCycles = cc.representativeCycles(rawCycles);
  const allowlist = adaptAllowlist(cc);
  const cycles = repCycles
    .map((c) => {
      const key = cc.cycleSetKey(c);
      return { key, path: c.join(' → '), length: c.length - 1, allowlisted: allowlist.keys.has(key) };
    })
    .sort((x, y) => x.key.localeCompare(y.key));

  const cycleParticipation = new Map();
  for (const c of repCycles) {
    for (const m of new Set(c.slice(0, -1))) {
      cycleParticipation.set(m, (cycleParticipation.get(m) || 0) + 1);
    }
  }

  // ── 强连通分量（SCC）：结构口径，替代「环计数」作为耦合单位 ──
  // [锐评 2026-10-23] 环数是路径等价类计数，随任意一条边增删剧烈波动却不描述结构。
  // 实测模块层 14 节点报数百个代表环（2026-10-23 锐评现场 651，几轮重构后 551），
  // 而 Tarjan 给出 1 个 size=14 的 SCC——
  // 同一拓扑事实的两种记法，只有后者能回答「该把哪些文件一起拆/一起迁」。
  // 因此台账同时报两把尺子：环数留作历史对照（门禁仍在用），SCC 作为结构判据。
  const fileSccs = nontrivialSccs(tarjanScc([...fileSet], (n) => graph.get(n) || []));
  const moduleSccs = nontrivialSccs(tarjanScc([...moduleGraph.keys()], (n) => moduleGraph.get(n) || []));
  const fileScc = sccSummary(fileSccs);
  const moduleScc = sccSummary(moduleSccs);
  // 每个文件级 SCC 附模块构成（渲染期不再回查 cc，避免把门禁模块耦合进渲染函数）
  const fileSccsView = fileSccs.map((members) => {
    const byMod = new Map();
    for (const rel of members) {
      const m = moduleName(rel);
      byMod.set(m, (byMod.get(m) || 0) + 1);
    }
    const modules = [...byMod.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([name, n]) => ({ name, files: n }));
    return { size: members.length, modules, members };
  });

  // ── 折叠盲区：模块级 SCC 与「代表环」都看不见真实 SCC 的大半 ──
  // [锐评 2026-10-23] 实测：11 个非平凡文件级 SCC 里，模块折叠法能看见 0 个。
  //   原因一（10/11）：buildModuleGraph 丢弃模块内边（本仓 738 条），
  //     模块内环折叠成自环，而 detectCycles 用 path.includes 排自环 → 整类环消失。
  //   原因二（1/11）：唯一的跨模块 SCC（scene + scene/{camera,manager,motion}）
  //     在模块图上确实成环，但 representativeCycles 按节点集合归并、只留最短环，
  //     4 节点环被更短的 scene↔scene/camera 等路径挤掉 → 节点集恰为这 4 个的环 = 0。
  // 结论：环数与模块级 SCC 都只是「模块间边是否存在」的读数，不反映文件级真实结构。
  const realModuleSccs = fileSccs
    .map((members, i) => ({
      sccIndex: i,
      size: members.length,
      modules: [...new Set(members.map((f) => moduleName(f)))].sort(),
      members,
    }))
    .filter((g) => g.modules.length > 1);
  // 代表环的文件级支撑：环上每个模块都必须落在同一个文件级 SCC 内，否则是折叠假象
  let cyclesBacked = 0;
  for (const c of repCycles) {
    const mods = c.slice(0, -1);
    const backed = fileSccs.some((members) => {
      const mm = new Set(members.map((f) => moduleName(f)));
      return mods.every((m) => mm.has(m));
    });
    if (backed) cyclesBacked++;
  }

  // ── 第三个假象源：入口文件被折叠进 core ──
  // [锐评 2026-10-23] `core/main.ts` 入度=0（应用入口，没人 import 它），却与 core 其余 141 个
  // 文件合并成同一个模块节点。它指向 menus/library-setup 的那条边因此被记成 `core→menus`，
  // 让 menus 这个纯叶子模块在模块图上获得一条回边 → 凭空造出大量 core↔menus 环。
  // 实测：只排除 core/main.ts 一个文件，代表环 551→139（约 −75%），效果与排除全部入度为 0 的源文件相同。
  const inDeg = new Map([...fileSet].map((r) => [r, 0]));
  for (const [, deps] of graph) for (const to of deps) if (inDeg.has(to)) inDeg.set(to, inDeg.get(to) + 1);
  const entryFiles = [...inDeg.entries()].filter(([, d]) => d === 0).map(([r]) => r).sort();
  // 只剔除「模块图上的假回边来源」：入口文件本身不成环，剔除后环数即真实结构读数
  const graphNoEntry = new Map();
  for (const [from, deps] of graph) {
    if (inDeg.get(from) === 0) continue; // 入口不参与折叠（它没有上游，不可能是环的中间节点）
    graphNoEntry.set(from, deps);
  }
  const { moduleGraph: mgNoEntry } = cc.buildModuleGraph(graphNoEntry);
  const cyclesNoEntry = cc.representativeCycles(cc.dedupeCycles(cc.detectCycles(mgNoEntry)));

  const moduleMetrics = [...modOf.values()]
    .map((m) => ({
      ...m,
      instability: instability(m.ca, m.ce),
      cycles: cycleParticipation.get(m.name) || 0,
    }))
    .sort((x, y) => x.name.localeCompare(y.name));

  const totals = {
    files: files.length,
    fileEdges: edgeCount,
    modules: moduleMetrics.length,
    modulePairs: matrix.size,
    crossModuleFileEdges: [...matrix.values()].reduce((s, n) => s + n, 0),
    intraModuleEdges: edgeCount - [...matrix.values()].reduce((s, n) => s + n, 0),
    bidirectionalPairs: bidirectional.length,
    cycles: cycles.length,
    cyclesAllowlisted: cycles.filter((c) => c.allowlisted).length,
    cyclesNew: cycles.filter((c) => !c.allowlisted).length,
    meanFileCa: +(edgeCount / files.length).toFixed(2),
    meanFileCe: +(edgeCount / files.length).toFixed(2), // 总入度=总出度=边数
    pipeNodes: fileMetrics.filter((f) => f.ca >= PIPE_MIN_CA && f.ce >= PIPE_MIN_CE).length,
    fileSccCount: fileScc.count,
    fileSccFiles: fileScc.files,
    fileSccMax: fileScc.max,
    moduleSccCount: moduleScc.count,
    moduleSccMax: moduleScc.max,
    realModuleSccCount: realModuleSccs.length,
    realModuleSccMax: realModuleSccs.length ? Math.max(...realModuleSccs.map((g) => g.modules.length)) : 0,
    cyclesBacked,
    cyclesArtifact: cycles.length - cyclesBacked,
    entryFiles: entryFiles.length,
    cyclesNoEntry: cyclesNoEntry.length,
    allowlistReviewBy: allowlist.reviewBy,
    allowlistReviewOverdue: allowlist.reviewOverdue,
    allowlistExpiredEntries: allowlist.expired,
  };

  return { totals, fileMetrics, moduleMetrics, matrix, bidirectional, cycles, fileSccs: fileSccsView, moduleSccs, realModuleSccs, entryFiles };
}

// ── 渲染 ──

function topRows(fileMetrics, key, n) {
  return [...fileMetrics]
    .sort((a, b) => (b[key] - a[key]) || a.rel.localeCompare(b.rel))
    .slice(0, n);
}

function renderMd(d) {
  const L = [];
  L.push('# 依赖耦合台账（dep-metrics）');
  L.push('');
  L.push('> 由 `scripts/dep-metrics.mjs` 自动生成（`npm run dep:metrics`）——勿手改。');
  L.push('> 口径：`frontend/src` 内部已解析 import 边（测试文件除外）；模块分组与环检测与 `check:circular` 同源，白名单同读 `scripts/circular-allowlist.json`。');
  L.push('> [ADR-268] 边与环均按「加载期依赖」计：动态 import() 惰性求值、不产生部分初始化绑定，故不计入（与 check:circular --strict 完全同口径，冒烟测试 check-cli.smoke.test.mjs 断言台账白名单外环恒为 0）。');
  L.push('');
  L.push('## 1. 总账');
  L.push('');
  L.push('| 指标 | 值 |');
  L.push('|------|----|');
  L.push(`| 模块文件数 | ${d.totals.files} |`);
  L.push(`| 文件级依赖边 | ${d.totals.fileEdges} |`);
  L.push(`| 模块数 | ${d.totals.modules} |`);
  L.push(`| 跨模块有向对 / 文件边 | ${d.totals.modulePairs} / ${d.totals.crossModuleFileEdges} |`);
  L.push(`| 双向密耦模块对 | ${d.totals.bidirectionalPairs} |`);
  L.push(`| 代表环（白名单内 / 外） | ${d.totals.cycles}（${d.totals.cyclesAllowlisted} / ${d.totals.cyclesNew}） |`);
  L.push(`| 文件级强连通分量（非平凡） | ${d.totals.fileSccCount} 个 / 覆盖 ${d.totals.fileSccFiles} 文件 / 最大 ${d.totals.fileSccMax} |`);
  L.push(`| 模块折叠法 SCC（非平凡） | ${d.totals.moduleSccCount} 个 / 最大 ${d.totals.moduleSccMax} ⚠️ 见 7.2 盲区 |`);
  L.push(`| 文件级支撑的真实模块 SCC | ${d.totals.realModuleSccCount} 个 / 最大 ${d.totals.realModuleSccMax} |`);
  L.push(`| 代表环中有结构支撑的 | ${d.totals.cyclesBacked} / ${d.totals.cycles}（其余 ${d.totals.cyclesArtifact} 为折叠假象） |`);
  L.push(`| 白名单复核到期日（reviewBy） | ${d.totals.allowlistReviewBy ?? '未设置'}${d.totals.allowlistReviewOverdue ? ' ⏰ 已过期（--strict 阻断中）' : ''}${d.totals.allowlistExpiredEntries ? `（过期条目 ${d.totals.allowlistExpiredEntries}）` : ''} |`);
  L.push(`| 文件平均扇入/扇出 | ${d.totals.meanFileCa} / ${d.totals.meanFileCe} |`);
  L.push(`| 管路节点数（Ca≥${PIPE_MIN_CA} 且 Ce≥${PIPE_MIN_CE}） | ${d.totals.pipeNodes} |`);
  L.push('');
  L.push('## 2. 尺子定义（勿自造刻度）');
  L.push('');
  L.push('- **Ca**（afferent）＝被多少个内部文件 import；**Ce**（efferent）＝它 import 了多少个内部文件。');
  L.push('- **I** ＝ Ce/(Ca+Ce)：0≈稳定核心，1≈叶梢；0/0 记「—」。');
  L.push(`- **管路节点**：Ca≥${PIPE_MIN_CA} 且 Ce≥${PIPE_MIN_CE}——高入高出的中枢，牵一发动全身。`);
  L.push('- **环**：模块级全量简单环枚举后按节点集合并为最短代表环（同门禁）。⚠️ 折叠法有系统性盲区，见 7.2。');
  L.push('- **强连通分量（SCC）**：Tarjan 求「互相可达」的极大节点集。与「环」的区别是结构 vs 记账：');
  L.push('  环数是路径等价类的计数，任何一条边增删都会让它剧烈波动却不描述结构；SCC 直接回答');
  L.push('  「哪些文件必须一起理解/一起迁移」。**判读耦合请用 SCC，环数只作历史对照与门禁输入。**');
  L.push('- **折叠盲区**：把文件折叠成模块会丢弃模块内边（本仓 ' + d.totals.intraModuleEdges +
    '/' + d.totals.fileEdges + ' 条），模块内环折叠成自环后');
  L.push('  被 `path.includes` 排除 ⇒ 整类消失；跨模块环又被「只留最短代表环」挤掉。实测 ' +
    d.totals.fileSccCount + ' 个真实 SCC');
  L.push('  里折叠法可见 0 个，' + d.totals.cycles + ' 个代表环里只有 ' + d.totals.cyclesBacked +
    ' 个有文件级支撑。**环数不是耦合强度。**');
  L.push('');

  const byCa = topRows(d.fileMetrics, 'ca', TOP_N);
  const byCe = topRows(d.fileMetrics, 'ce', TOP_N);
  const byProd = [...d.fileMetrics]
    .map((f) => ({ ...f, prod: f.ca * f.ce }))
    .sort((a, b) => (b.prod - a.prod) || a.rel.localeCompare(b.rel))
    .slice(0, 10);

  L.push(`## 3. 文件级耦合 Top（各 ${TOP_N}）`);
  L.push('');
  L.push('### 3.1 被接最多（Ca）');
  L.push('');
  L.push('| 文件 | Ca | Ce | I |');
  L.push('|------|----|----|---|');
  for (const f of byCa) L.push(`| \`${f.rel}\` | ${f.ca} | ${f.ce} | ${fmtI(f.instability)} |`);
  L.push('');
  L.push('### 3.2 接人最多（Ce）');
  L.push('');
  L.push('| 文件 | Ca | Ce | I |');
  L.push('|------|----|----|---|');
  for (const f of byCe) L.push(`| \`${f.rel}\` | ${f.ca} | ${f.ce} | ${fmtI(f.instability)} |`);
  L.push('');
  L.push('### 3.3 耦合乘积 Top10（管路节点候补）');
  L.push('');
  L.push('| 文件 | Ca | Ce | Ca×Ce | I |');
  L.push('|------|----|----|-------|---|');
  for (const f of byProd) L.push(`| \`${f.rel}\` | ${f.ca} | ${f.ce} | ${f.prod} | ${fmtI(f.instability)} |`);
  L.push('');

  const modNames = d.moduleMetrics.map((m) => m.name);
  L.push('## 4. 模块耦合矩阵（行=接入方 → 列=被接方，格=跨模块文件边数）');
  L.push('');
  L.push(`| from\\to | ${modNames.join(' | ')} |`);
  L.push(`|---${'|---'.repeat(modNames.length)}|`);
  for (const a of modNames) {
    const cells = modNames.map((b) => {
      if (a === b) return '·';
      const n = d.matrix.get(`${a}|${b}`);
      return n ? `**${n}**` : '';
    });
    L.push(`| \`${a}\` | ${cells.join(' | ')} |`);
  }
  L.push('');

  L.push('## 5. 模块台账（按总耦合降序）');
  L.push('');
  L.push('| 模块 | 文件数 | Ca | Ce | I | 环参与 |');
  L.push('|------|--------|----|----|---|--------|');
  for (const m of [...d.moduleMetrics].sort((a, b) => (b.ca + b.ce - (a.ca + a.ce)) || a.name.localeCompare(b.name))) {
    L.push(`| \`${m.name}\` | ${m.files} | ${m.ca} | ${m.ce} | ${fmtI(m.instability)} | ${m.cycles} |`);
  }
  L.push('');

  L.push('## 6. 双向密耦模块对（两城互搭吊桥）');
  L.push('');
  L.push('| 模块 A | 模块 B | A→B | B→A |');
  L.push('|--------|--------|-----|-----|');
  for (const p of d.bidirectional) L.push(`| \`${p.a}\` | \`${p.b}\` | ${p.forward} | ${p.backward} |`);
  L.push('');

  L.push('## 7. 强连通分量（结构口径 · 判读耦合用这个）');
  L.push('');
  L.push('> 「哪些文件必须一起理解」——SCC 内任意两点互相可达，改一个就得同时看懂另一个。');
  L.push('> 环数（第 8 节）会随边增删剧烈波动，SCC 不会：**同样的拓扑，环数可以差十倍，SCC 不变。**');
  L.push('');
  L.push(`### 7.1 文件级 SCC（${d.totals.fileSccCount} 个 / 覆盖 ${d.totals.fileSccFiles} 文件 / 最大 ${d.totals.fileSccMax}）`);
  L.push('');
  if (d.fileSccs.length === 0) {
    L.push('无非平凡 SCC（文件图是 DAG）。');
  } else {
    L.push('| # | 大小 | 模块构成 | 成员 |');
    L.push('|---|------|----------|------|');
    d.fileSccs.forEach((c, i) => {
      const comp = c.modules.map((m) => `${m.name}×${m.files}`).join(', ');
      L.push(`| ${i + 1} | ${c.size} | ${comp} | ${c.members.join('<br>')} |`);
    });
  }
  L.push('');
  L.push('### 7.2 模块级 SCC 与折叠盲区（读第 8 节前必看）');
  L.push('');
  L.push('**这一节是台账最重要的读数。** 模块级 SCC 与代表环都建立在「把文件折叠成模块」之上，');
  L.push('而折叠会丢弃模块内边——本仓 ' + d.totals.fileEdges + ' 条文件边里 **' +
    d.totals.intraModuleEdges + ' 条是模块内边**，被折叠法整类丢弃。');
  L.push('');
  L.push('| 口径 | 读数 | 含义 |');
  L.push('|------|------|------|');
  L.push(`| 模块折叠法 SCC | ${d.totals.moduleSccCount} 个 / 最大 ${d.totals.moduleSccMax} 模块 | 只反映「模块间边是否存在」 |`);
  L.push(`| 文件级支撑的真实模块 SCC | ${d.totals.realModuleSccCount} 个 / 最大 ${d.totals.realModuleSccMax} 模块 | 由文件级 SCC 反推，能指导拆分 |`);
  L.push(`| 代表环中有文件级支撑的 | ${d.totals.cyclesBacked} / ${d.totals.cycles} | 其余 ${d.totals.cyclesArtifact} 个是折叠假象 |`);
  L.push(`| 代表环（剔除 ${d.totals.entryFiles} 个入度为 0 的入口文件后） | ${d.totals.cyclesNoEntry} | 更接近结构事实 |`);
  L.push('');
  if (d.realModuleSccs.length === 0) {
    L.push('无跨模块的文件级 SCC——所有真实环都在单个模块内部。');
  } else {
    L.push('真实跨模块 SCC（文件级反推）：');
    for (const g of d.realModuleSccs) {
      L.push(`- size=${g.size} 文件 / ${g.modules.length} 模块：\`${g.modules.join('`, `')}\``);
    }
  }
  L.push('');
  L.push(`> 盲区成因：① 模块内环折叠成自环，\`detectCycles\` 用 \`path.includes\` 排自环 ⇒ 整类环消失；`);
  if (d.totals.realModuleSccCount > 0) {
    L.push(`> ② 跨模块 SCC 在模块图上确实成环，但 \`representativeCycles\` 按节点集合归并、只留最短环，`);
    L.push(`> 被更短的二元环挤掉。**因此 ${d.totals.cycles} 个代表环里只有 ${d.totals.cyclesBacked} 个有结构支撑**——`);
  } else {
    L.push(`> ② 跨模块 SCC 已为 0（模块图是 DAG），但折叠法仍报 ${d.totals.cycles} 个代表环：`);
    L.push(`> 这些环全部由「模块内边被丢弃 + 入口文件被折叠进模块」两个记账假象产生，**没有一个有结构支撑**——`);
  }
  L.push('> 环数不能用来判断耦合，只能用作门禁的回归棘轮。');
  L.push('');
  L.push(`> **第三个假象源：入口文件被折叠进模块。** 本仓 ${d.totals.entryFiles} 个文件入度为 0（应用入口与独立叶子），`);
  L.push('> 其中 `core/main.ts` 与 `core` 其余文件合并成同一个模块节点。它指向 `menus/library-setup` 的那条边');
  L.push(`> 因此被记成 \`core→menus\`，让 menus 这个纯叶子模块凭空获得回边。剔除全部入口文件后代表环 **${d.totals.cycles} → ${d.totals.cyclesNoEntry}**，`);
  L.push(`> 而只剔除 \`core/main.ts\` 一个文件效果完全相同——**那消失的 ${d.totals.cycles - d.totals.cyclesNoEntry} 个环全部由「应用入口住在 core 里」这一个记账选择产生。**`);
  L.push('> 入口文件天然入度 0，不可能是环的中间节点；把它们折叠进业务模块是度量口径缺陷，不是架构缺陷。');
  L.push('');

  L.push('## 8. 残留环清单（代表环 · 历史对照 + 门禁输入）');
  L.push('');
  L.push('| 环 | 长度 | 白名单 |');
  L.push('|----|------|--------|');
  for (const c of d.cycles) L.push(`| \`${c.path}\` | ${c.length} | ${c.allowlisted ? '✅ 已知' : '🆕 新增'} |`);
  L.push('');
  L.push('---');
  L.push('*趋势对比：`node scripts/dep-metrics.mjs --json` 落盘快照文件随 git 提交，台账变化即 diff。*');
  return L.join('\n');
}

function renderJson(d) {
  return JSON.stringify(
    {
      totals: d.totals,
      files: d.fileMetrics,
      modules: d.moduleMetrics,
      matrix: [...d.matrix.entries()].sort().map(([k, edges]) => {
        const [from, to] = k.split('|');
        return { from, to, edges };
      }),
      bidirectional: d.bidirectional,
      cycles: d.cycles,
      fileSccs: d.fileSccs,
      moduleSccs: d.moduleSccs,
      realModuleSccs: d.realModuleSccs.map((g) => ({ size: g.size, modules: g.modules, members: g.members })),
      entryFiles: d.entryFiles,
    },
    null,
    2,
  ) + '\n';
}

// ── 主流程 ──

async function main() {
  const args = parseArgs(process.argv.slice(2), {
    bools: ['json', 'check'],
    strings: ['file'],
    defaults: { json: false, file: null, check: false },
  });
  if (args.help) {
    const src = fs.readFileSync(process.argv[1], 'utf-8');
    const s = src.indexOf('/**');
    const e = src.indexOf('*/', s);
    console.log(src.slice(s, e + 2).replace(/^ \* ?/gm, '').trim());
    process.exit(0);
  }
  if (args.unknown && args.unknown.length) {
    console.error(`❌ 未知参数: ${args.unknown.join(', ')}（--help 查看用法）`);
    process.exit(1);
  }

  const data = await compute();
  const output = args.json ? renderJson(data) : renderMd(data);

  // [ADR-268] --check：台账与活代码是否同步。此前 docs/dep-metrics.md 只靠 pre-commit 的
  // `dep-metrics.mjs --file` 重写（提交时静默改文件），CI 侧无人比对 → 台账可以陈旧一整天
  // 而全链路绿灯（本次锐评现场：18:05 的台账在 18:47 仍写着 2003 边 / 696 环）。
  if (args.check) {
    const outFile = path.resolve(ROOT, args.file || 'docs/dep-metrics.md');
    const existing = fs.existsSync(outFile) ? fs.readFileSync(outFile, 'utf8') : '';
    if (existing !== output) {
      console.error(`❌ ${outFile} 未同步，请运行：npm run gen:dep-metrics`);
      console.error(`   台账读数 files=${data.totals.files} edges=${data.totals.fileEdges} cycles=${data.totals.cycles}（白名单外 ${data.totals.cyclesNew}）`);
      process.exit(1);
    }
    console.log(`✅ ${outFile} 已同步（files=${data.totals.files} edges=${data.totals.fileEdges} cycles=${data.totals.cycles}）`);
    process.exit(0);
  }

  if (args.file) {
    const outFile = path.resolve(ROOT, args.file);
    fs.writeFileSync(outFile, output, 'utf8');
    console.error(`✅ 已写入 ${outFile}（files=${data.totals.files} edges=${data.totals.fileEdges} cycles=${data.totals.cycles}）`);
  } else {
    console.log(output);
    console.error(`   files=${data.totals.files} edges=${data.totals.fileEdges} modules=${data.totals.modules} cycles=${data.totals.cycles}（白名单外 ${data.totals.cyclesNew}）`);
  }
}

main();
