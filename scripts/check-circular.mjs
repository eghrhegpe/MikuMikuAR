#!/usr/bin/env node
/**
 * check-circular.mjs — 检测 frontend/src 模块间的跨模块循环依赖。
 *
 * 用法：
 *   node scripts/check-circular.mjs              # 检测并输出报告
 *   node scripts/check-circular.mjs --strict     # 发现循环依赖时 exit 1（CI 阻塞）
 *   node scripts/check-circular.mjs --json       # JSON 输出
 *   node scripts/check-circular.mjs --scope core # 只检测指定模块及其依赖
 *   node scripts/check-circular.mjs --update-allowlist # 将当前所有环写入白名单
 *   node scripts/check-circular.mjs --edges      # 报告环时附文件级 import 边（定位具体引入点）
 *   node scripts/check-circular.mjs --snapshot <file> # 保存环 + 边为基线快照
 *   node scripts/check-circular.mjs --diff <file>     # 与基线对比：标出新增环、已消失环及引入环的新增边
 *
 * 白名单：scripts/circular-allowlist.json 记录「已知架构环」。
 * --strict 模式只对白名单之外的“新增环”exit 1，历史环仅告警。
 *
 * 归因链路：--edges 看环由哪些 import 边构成；--snapshot/--diff
 * 对比两次扫描，定位「哪条新 import 引入了环」（--diff --strict 按新增环退出码）。
 *
 * 退出码：无新增循环依赖 → 0；有新增循环依赖 → 1（--strict 模式）
 * 设计意图：循环依赖检查（source-graph 分析）
 * 依赖：node:fs / node:path / node:url / 本地模块
 */
import fs from 'node:fs';

import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { scanSourceGraph, resolveSourceImport } from './_lib/source-graph.mjs';
import { parseArgs } from './_lib/parse-args.mjs';
import { ROOT } from './_lib/scan-files.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SRC_DIR = path.join(ROOT, 'frontend', 'src');
const ALLOWLIST_PATH = path.join(__dirname, 'circular-allowlist.json');

const args = parseArgs(process.argv.slice(2), {
    bools: ['strict', 'json', 'update-allowlist', 'edges'],
    strings: ['scope', 'snapshot', 'diff'],
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

// ── 模块映射 ──

/**
 * 将文件路径映射到模块名
 */
export function getModule(relativePath) {
    const parts = relativePath.split('/');
    if (parts.length === 0) return 'unknown';
    const topDir = parts[0];
    if (topDir === '__tests__') return 'test';
    if (parts.length === 1) return 'core';
    if (topDir === 'scene' && parts.length > 2) {
        return `scene/${parts[1]}`;
    }
    return topDir;
}

/**
 * 构建模块级依赖图
 */
export function buildModuleGraph(fileGraph) {
    const moduleGraph = new Map();
    // 模块对 → 具体文件级 import 边（用于 --edges 归因）
    const moduleEdges = new Map(); // "srcMod|dstMod" -> [{from, to}]

    for (const [file, deps] of fileGraph) {
        const sourceModule = getModule(file);
        if (sourceModule === 'test') continue;

        if (!moduleGraph.has(sourceModule)) {
            moduleGraph.set(sourceModule, new Set());
        }

        for (const dep of deps) {
            const targetModule = getModule(dep);
            if (targetModule === 'test') continue;
            // 只记录跨模块依赖
            if (targetModule !== sourceModule) {
                moduleGraph.get(sourceModule).add(targetModule);
                const key = `${sourceModule}|${targetModule}`;
                if (!moduleEdges.has(key)) moduleEdges.set(key, []);
                moduleEdges.get(key).push({ from: file, to: dep });
            }
        }
    }

    return { moduleGraph, moduleEdges };
}

// ── 循环依赖检测 ──

/**
 * 全量枚举所有简单环（Johnson 简化版：以环内字典序最小节点为起点，
 * 只访问 `> start` 的节点，保证每个环恰好报告一次）。
 *
 * [P1 2026-08-06] 旧版 DFS 后向边算法只报「回边指向当前栈内节点」的环，
 * 目标已被访问完成（cross edge）时跳过 → 钻石结构漏报真实环（例：
 * a→b,b→a,a→c,c→b,c→a 漏掉 3-环 a→c→b→a）。在已有白名单 2-环上新增
 * 两条边即可引入新环且门禁静默——门禁级缺陷。本实现每个环以最小节点
 * 为起点全量 DFS，不漏报；模块图节点仅 ~20，指数级最坏代价可忽略。
 */
export function detectCycles(graph) {
    const cycles = [];
    const nodes = [...graph.keys()];

    function dfs(start, node, path) {
        for (const dep of graph.get(node) || []) {
            if (dep === start) {
                cycles.push([...path, start]);
            } else if (dep > start && !path.includes(dep)) {
                dfs(start, dep, [...path, dep]);
            }
        }
    }

    for (const start of nodes) {
        dfs(start, start, [start]);
    }

    return cycles;
}

/**
 * 规范化循环路径为稳定 key（从字典序最小节点起始，旋转不变）
 */
export function normalizeCycleKey(cycle) {
    const minIdx = cycle.slice(0, -1).reduce((min, val, idx, arr) =>
        val < arr[min] ? idx : min, 0);
    const body = cycle.slice(0, -1);
    const rotated = [...body.slice(minIdx), ...body.slice(0, minIdx), body[minIdx]];
    return rotated.join('→');
}

/**
 * 去重循环路径
 */
export function dedupeCycles(cycles) {
    const seen = new Set();
    const unique = [];

    for (const cycle of cycles) {
        const key = normalizeCycleKey(cycle);
        if (!seen.has(key)) {
            seen.add(key);
            unique.push(cycle);
        }
    }

    return unique;
}

/**
 * 按节点集合归并环（SCC 语义的报告单位）：同一组节点的排列组合只保留最短代表环。
 *
 * [P2 2026-08-06] 全量枚举（detectCycles）保证不漏报，但 14 节点稠密图会爆出 1625 条
 * 环（--edges 输出 2.1MB，触发 execFileSync maxBuffer 限制，smoke 失败）。循环依赖治理
 * 关心的是「哪些模块互相依赖成环」而非同一组节点的每条排列，故按节点集合归并：
 * 每组只报最短环，输出/白名单/快照均用代表环，量级从 1625 降到 ~50。
 */
export function representativeCycles(cycles) {
    const bySet = new Map(); // 节点集合 key（排序 join）→ 最短环
    for (const c of cycles) {
        const body = c.slice(0, -1);
        const key = [...body].sort().join('+');
        const existing = bySet.get(key);
        if (!existing || c.length < existing.length) bySet.set(key, c);
    }
    return [...bySet.values()];
}

// ── 白名单 ──

function loadAllowlist() {
    if (!fs.existsSync(ALLOWLIST_PATH)) return new Set();
    try {
        const data = JSON.parse(fs.readFileSync(ALLOWLIST_PATH, 'utf8'));
        return new Set((data.cycles || []).map(c => c.key));
    } catch (e) {
        console.error(`⚠️  白名单解析失败（${ALLOWLIST_PATH}）：${e.message}`);
        return new Set();
    }
}

function saveAllowlist(cycles) {
    const data = {
        $comment: '已知架构循环依赖白名单。CI (--strict) 只对本清单之外的新增环阻断。修复一个环后请运行 node scripts/check-circular.mjs --update-allowlist 收紧清单。',
        updatedAt: new Date().toISOString().slice(0, 10),
        cycles: cycles
            .map(c => ({ key: normalizeCycleKey(c), path: c.join(' → ') }))
            .sort((a, b) => a.key.localeCompare(b.key)),
    };
    fs.writeFileSync(ALLOWLIST_PATH, JSON.stringify(data, null, 2) + '\n', 'utf8');
}

// ── 基线快照（--snapshot / --diff） ──

/**
 * 保存当前环依赖快照：环 key 列表 + 模块对 → 文件级边。
 * 用于 --diff 对比两次扫描，定位「新增环由哪些新增 import 边引起」。
 */
function saveSnapshot(snapshotPath, cycles, moduleEdges) {
    const edges = {};
    for (const [key, list] of moduleEdges) {
        edges[key] = list;
    }
    const data = {
        $comment: '环形依赖基线快照。由 check-circular.mjs --snapshot 生成，供 --diff 对比。',
        updatedAt: new Date().toISOString().slice(0, 10),
        cycleKeys: cycles.map(normalizeCycleKey).sort(),
        edges,
    };
    fs.writeFileSync(snapshotPath, JSON.stringify(data, null, 2) + '\n', 'utf8');
    console.log(`✅ 快照已保存：${cycles.length} 个环 → ${path.relative(ROOT, snapshotPath)}`);
}

function loadSnapshot(snapshotPath) {
    if (!fs.existsSync(snapshotPath)) {
        console.error(`❌ 快照文件不存在：${snapshotPath}`);
        process.exit(2);
    }
    const data = JSON.parse(fs.readFileSync(snapshotPath, 'utf8'));
    return {
        cycleKeys: new Set(data.cycleKeys || []),
        edges: data.edges || {},
    };
}

/**
 * 定位 from 文件中 import to 的具体行号（用于 diff 归因精确到行）。
 * 复用 source-graph 的解析逻辑：逐行匹配 import 语句，取 resolved 后与 to 比对。
 * @returns {number|null} 首个命中的行号（1-based），未命中返回 null
 */
function findImportLine(fromFile, toRel) {
    const srcDir = SRC_DIR;
    const fullPath = path.join(srcDir, fromFile);
    if (!fs.existsSync(fullPath)) return null;
    const text = fs.readFileSync(fullPath, 'utf8');
    const lines = text.split('\n');
    // 匹配 import/export ... from '...'（含跨行），记录语句起始行
    const reFrom = /(?:^|\n)\s*(?:\/\/[^\n]*\n)*\s*(?:import|export)\b[\s\S]*?\bfrom\s+['"]([^'"]+)['"]/g;
    // 匹配 import '...' 纯副作用与动态 import
    const reSide = /(?:^|\n)\s*(?:\/\/[^\n]*\n)*\s*import\s+['"]([^'"]+)['"]/g;
    const reDyna = /await\s+import\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
    for (const re of [reFrom, reSide, reDyna]) {
        let m;
        while ((m = re.exec(text))) {
            const spec = m[1];
            const resolved = resolveSourceImport(spec, fullPath, srcDir);
            if (resolved === toRel) {
                // 计算起始行号：m.index 前的换行数 + 1（语句起始可能在换行后）
                const line = text.slice(0, m.index).split('\n').length;
                return line;
            }
        }
    }
    return null;
}

/**
 * 对比当前扫描与基线快照：
 * - 新增环（基线无）
 * - 每个新增环路径上的新增文件级边（基线 edges 中不存在 from→to 的文件级 import）
 */
function diffAgainstSnapshot(snapshotPath, cycles, moduleEdges) {
    const base = loadSnapshot(snapshotPath);
    const currentKeys = new Set(cycles.map(normalizeCycleKey));

    const addedCycles = cycles.filter(c => !base.cycleKeys.has(normalizeCycleKey(c)));
    const fixedCycles = [...base.cycleKeys].filter(k => !currentKeys.has(k));

    // 基线文件级边集合：`from → to` 归一化 key
    const baseFileEdges = new Set();
    for (const list of Object.values(base.edges || {})) {
        for (const { from, to } of list) baseFileEdges.add(`${from} → ${to}`);
    }

    console.log(`基线快照: ${base.cycleKeys.size} 个环 | 当前: ${currentKeys.size} 个环`);
    if (fixedCycles.length > 0) {
        console.log(`🟢 已消失 ${fixedCycles.length} 个环（基线有、当前无）：`);
        for (const k of fixedCycles) console.log(`  ${k}`);
    }
    if (addedCycles.length === 0) {
        console.log('✅ 无新增环');
        return false;
    }
    console.log(`🔴 新增 ${addedCycles.length} 个环（基线无）：\n`);
    for (const cycle of addedCycles) {
        const header = `  ${cycle.join(' → ')}`;
        const lines = [header];
        for (let i = 0; i < cycle.length - 1; i++) {
            const key = `${cycle[i]}|${cycle[i + 1]}`;
            const edges = moduleEdges.get(key) || [];
            // 文件级新增边：基线快照的文件级边集合中不存在
            const newEdges = edges.filter(({ from, to }) => !baseFileEdges.has(`${from} → ${to}`));
            if (newEdges.length > 0) {
                for (const { from, to } of newEdges.slice(0, 5)) {
                    const line = findImportLine(from, to);
                    const loc = line ? `:${line}` : '';
                    lines.push(`    [新增边] ${from}${loc} → ${to}`);
                }
                if (newEdges.length > 5) lines.push(`    … 共 ${newEdges.length} 条新增文件级边`);
            } else if (!base.edges[key]) {
                lines.push(`    （模块对 ${cycle[i]}→${cycle[i+1]} 基线已存在，文件级边均非新增）`);
            }
        }
        console.log(lines.join('\n'));
    }
    return true;
}

// ── 主流程 ──

function main() {
const { graph: fileGraph } = scanSourceGraph(SRC_DIR, { scope: args.scope });

const { moduleGraph, moduleEdges } = buildModuleGraph(fileGraph);
const rawCycles = detectCycles(moduleGraph);
const cycles = dedupeCycles(rawCycles);
// [P2 2026-08-06] 输出/判定/快照统一用「节点集合归并的代表环」：全量枚举保证不漏报，
// 但稠密模块图会爆出 1625 条路径变体（--edges 输出 2.1MB 触发 execFileSync maxBuffer）。
// 治理口径 = 代表环（每组节点最短环）；新增环检测 = 出现新的代表环。
const reportCycles = representativeCycles(cycles);

if (args['update-allowlist']) {
    // [P2 2026-08-06] 白名单「只减不增」护栏：旧实现无条件把当前全部环（含新增环）写入
    // 白名单，任何人可静默吸收新回归（ADR-238 L179 已警示）。现改为：有新增环则拒绝，
    // 仅允许移除已修复环（fixed）收紧清单。判定基于代表环（节点集合口径）。
    const existingAllowlist = loadAllowlist();
    const currentKeys = new Set(reportCycles.map(normalizeCycleKey));
    const addedKeys = [...currentKeys].filter((k) => !existingAllowlist.has(k));
    const fixedKeys = [...existingAllowlist].filter((k) => !currentKeys.has(k));

    if (addedKeys.length > 0) {
        console.error(`❌ --update-allowlist 拒绝：检测到 ${addedKeys.length} 个新增环（代表环口径），白名单只允许减少不允许增加：`);
        for (const k of addedKeys.slice(0, 20)) console.error(`   ${k}`);
        if (addedKeys.length > 20) console.error(`   ...（共 ${addedKeys.length} 个）`);
        console.error('   新增环应先修复代码消除；确认为已知环请人工编辑 circular-allowlist.json。');
        process.exit(1);
    }
    if (fixedKeys.length === 0) {
        console.log(`✅ 白名单无需更新（无新增环、无已修复环）`);
        process.exit(0);
    }
    saveAllowlist(reportCycles);
    console.log(`✅ 白名单已更新：移除 ${fixedKeys.length} 个已修复环 → ${path.relative(ROOT, ALLOWLIST_PATH)}`);
    process.exit(0);
}

// --snapshot：保存基线快照后退出（供 --diff 对比）
if (args.snapshot) {
    saveSnapshot(args.snapshot, reportCycles, moduleEdges);
    process.exit(0);
}

// --diff：与基线快照对比，标出新增环及引入环的新增边
if (args.diff) {
    const hasNew = diffAgainstSnapshot(args.diff, reportCycles, moduleEdges);
    process.exit(args.strict && hasNew ? 1 : 0);
}

const allowlist = loadAllowlist();
const known = [];
const added = [];
for (const cycle of reportCycles) {
    (allowlist.has(normalizeCycleKey(cycle)) ? known : added).push(cycle);
}
const currentKeys = new Set(reportCycles.map(normalizeCycleKey));
const fixedKeys = [...allowlist].filter(k => !currentKeys.has(k));

if (args.json) {
    console.log(JSON.stringify({
        moduleCount: moduleGraph.size,
        totalCycleCount: cycles.length,          // 全量路径变体数（枚举口径）
        cycleCount: reportCycles.length,         // 代表环数（治理口径）
        knownCount: known.length,
        newCount: added.length,
        fixedCount: fixedKeys.length,
        cycles: reportCycles.map(c => ({
            path: c,
            length: c.length - 1,
            known: allowlist.has(normalizeCycleKey(c)),
        })),
        fixed: fixedKeys,
    }, null, 2));
} else {
    console.log(`扫描到 ${moduleGraph.size} 个模块`);

    if (reportCycles.length === 0) {
        console.log('✅ 未检测到跨模块循环依赖');
    } else {
        // --edges 模式：环路径下追加文件级 import 边，便于定位具体引入点
        const formatCycle = (cycle) => {
            const header = `  ${cycle.join(' → ')}`;
            if (!args.edges) return header;
            const lines = [header];
            for (let i = 0; i < cycle.length - 1; i++) {
                const key = `${cycle[i]}|${cycle[i + 1]}`;
                const edges = moduleEdges.get(key) || [];
                for (const { from, to } of edges.slice(0, 5)) {
                    lines.push(`      ${from} → ${to}`);
                }
                if (edges.length > 5) {
                    lines.push(`      … 共 ${edges.length} 条边`);
                }
            }
            return lines.join('\n');
        };
        if (known.length > 0) {
            console.log(`🟡 ${known.length} 个已知架构环（白名单内，不阻断）：\n`);
            for (const cycle of known) {
                console.log(formatCycle(cycle));
            }
        }
        if (added.length > 0) {
            console.log(`\n🔴 ${added.length} 个新增循环依赖（白名单外${args.strict ? '，CI 阻断' : ''}）：\n`);
            for (const cycle of added) {
                console.log(formatCycle(cycle));
            }
        }
    }

    if (fixedKeys.length > 0) {
        console.log(`\n🟢 ${fixedKeys.length} 个白名单环已被修复，可运行 --update-allowlist 收紧清单：`);
        for (const k of fixedKeys) {
            console.log(`  ${k}`);
        }
    }
}

// 退出码：--strict 只对新增环阻断
if (added.length > 0 && args.strict) {
    process.exit(1);
}
}

// 仅直接运行时执行主流程；被测试 import 时只导出检测函数（detectCycles 已 export 供直测）
const invokedDirectly = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) main();
