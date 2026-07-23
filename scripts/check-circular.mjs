#!/usr/bin/env node
/**
 * check-circular.mjs
 * 检测 frontend/src 模块间的跨模块循环依赖。
 *
 * 用法：
 *   node scripts/check-circular.mjs              # 检测并输出报告
 *   node scripts/check-circular.mjs --strict     # 发现循环依赖时 exit 1（CI 阻塞）
 *   node scripts/check-circular.mjs --json       # JSON 输出
 *   node scripts/check-circular.mjs --scope core # 只检测指定模块及其依赖
 *   node scripts/check-circular.mjs --update-allowlist # 将当前所有环写入白名单
 *
 * 白名单：scripts/circular-allowlist.json 记录「已知架构环」。
 * --strict 模式只对白名单之外的“新增环”exit 1，历史环仅告警。
 *
 * 退出码：无新增循环依赖 → 0；有新增循环依赖 → 1（--strict 模式）
 */
import fs from 'node:fs';

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { scanSourceGraph } from './_lib/source-graph.mjs';
import { parseArgs } from './_lib/parse-args.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const SRC_DIR = path.join(ROOT, 'frontend', 'src');
const ALLOWLIST_PATH = path.join(__dirname, 'circular-allowlist.json');

const args = parseArgs(process.argv.slice(2), {
    bools: ['strict', 'json', 'update-allowlist'],
    strings: ['scope'],
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
            }
        }
    }

    return moduleGraph;
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

// ── 主流程 ──

const { graph: fileGraph } = scanSourceGraph(SRC_DIR, { scope: args.scope });

const moduleGraph = buildModuleGraph(fileGraph);
const rawCycles = detectCycles(moduleGraph);
const cycles = dedupeCycles(rawCycles);

if (args['update-allowlist']) {
    saveAllowlist(cycles);
    console.log(`✅ 白名单已更新：${cycles.length} 个已知环 → ${path.relative(ROOT, ALLOWLIST_PATH)}`);
    process.exit(0);
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
        if (known.length > 0) {
            console.log(`🟡 ${known.length} 个已知架构环（白名单内，不阻断）：\n`);
            for (const cycle of known) {
                console.log(`  ${cycle.join(' → ')}`);
            }
        }
        if (added.length > 0) {
            console.log(`\n🔴 ${added.length} 个新增循环依赖（白名单外${args.strict ? '，CI 阻断' : ''}）：\n`);
            for (const cycle of added) {
                console.log(`  ${cycle.join(' → ')}`);
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
