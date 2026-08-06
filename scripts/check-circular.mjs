#!/usr/bin/env node
/**
 * check-circular.mjs — 检测 frontend/src 模块间的跨模块循环依赖。
 * 检测 frontend/src 模块间的跨模块循环依赖。
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
import { fileURLToPath } from 'node:url';
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

// ── 模块映射 ──

/**
 * 将文件路径映射到模块名
 */
function getModule(relativePath) {
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
function buildModuleGraph(fileGraph) {
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
 * 使用 DFS 检测循环依赖
 */
function detectCycles(graph) {
    const cycles = [];
    const visited = new Set();
    const inStack = new Set();
    const path = [];

    function dfs(node) {
        if (inStack.has(node)) {
            const cycleStart = path.indexOf(node);
            if (cycleStart !== -1) {
                cycles.push([...path.slice(cycleStart), node]);
            }
            return;
        }

        if (visited.has(node)) return;

        visited.add(node);
        inStack.add(node);
        path.push(node);

        const deps = graph.get(node) || new Set();
        for (const dep of deps) {
            dfs(dep);
        }

        path.pop();
        inStack.delete(node);
    }

    for (const node of graph.keys()) {
        dfs(node);
    }

    return cycles;
}

/**
 * 规范化循环路径为稳定 key（从字典序最小节点起始，旋转不变）
 */
function normalizeCycleKey(cycle) {
    const minIdx = cycle.slice(0, -1).reduce((min, val, idx, arr) =>
        val < arr[min] ? idx : min, 0);
    const body = cycle.slice(0, -1);
    const rotated = [...body.slice(minIdx), ...body.slice(0, minIdx), body[minIdx]];
    return rotated.join('→');
}

/**
 * 去重循环路径
 */
function dedupeCycles(cycles) {
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

const { graph: fileGraph } = scanSourceGraph(SRC_DIR, { scope: args.scope });

const { moduleGraph, moduleEdges } = buildModuleGraph(fileGraph);
const rawCycles = detectCycles(moduleGraph);
const cycles = dedupeCycles(rawCycles);

if (args['update-allowlist']) {
    saveAllowlist(cycles);
    console.log(`✅ 白名单已更新：${cycles.length} 个已知环 → ${path.relative(ROOT, ALLOWLIST_PATH)}`);
    process.exit(0);
}

// --snapshot：保存基线快照后退出（供 --diff 对比）
if (args.snapshot) {
    saveSnapshot(args.snapshot, cycles, moduleEdges);
    process.exit(0);
}

// --diff：与基线快照对比，标出新增环及引入环的新增边
if (args.diff) {
    const hasNew = diffAgainstSnapshot(args.diff, cycles, moduleEdges);
    process.exit(args.strict && hasNew ? 1 : 0);
}

const allowlist = loadAllowlist();
const known = [];
const added = [];
for (const cycle of cycles) {
    (allowlist.has(normalizeCycleKey(cycle)) ? known : added).push(cycle);
}
const currentKeys = new Set(cycles.map(normalizeCycleKey));
const fixedKeys = [...allowlist].filter(k => !currentKeys.has(k));

if (args.json) {
    console.log(JSON.stringify({
        moduleCount: moduleGraph.size,
        cycleCount: cycles.length,
        knownCount: known.length,
        newCount: added.length,
        fixedCount: fixedKeys.length,
        cycles: cycles.map(c => ({
            path: c,
            length: c.length - 1,
            known: allowlist.has(normalizeCycleKey(c)),
        })),
        fixed: fixedKeys,
    }, null, 2));
} else {
    console.log(`扫描到 ${moduleGraph.size} 个模块`);

    if (cycles.length === 0) {
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
