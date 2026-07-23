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
 *
 * 退出码：无循环依赖 → 0；有循环依赖 → 1（--strict 模式）
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { scanSourceGraph } from './_lib/source-graph.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const SRC_DIR = path.join(ROOT, 'frontend', 'src');

const args = process.argv.slice(2);
const strict = args.includes('--strict');
const jsonOutput = args.includes('--json');
let scope = null;

for (let i = 0; i < args.length; i++) {
    if (args[i] === '--scope' && args[i + 1]) {
        scope = args[++i];
    }
}

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
 * 去重循环路径
 */
function dedupeCycles(cycles) {
    const seen = new Set();
    const unique = [];

    for (const cycle of cycles) {
        const minIdx = cycle.slice(0, -1).reduce((min, val, idx, arr) =>
            val < arr[min] ? idx : min, 0);
        const normalized = [...cycle.slice(minIdx), ...cycle.slice(0, minIdx + 1)];
        const key = normalized.join('→');

        if (!seen.has(key)) {
            seen.add(key);
            unique.push(cycle);
        }
    }

    return unique;
}

// ── 主流程 ──

const { graph: fileGraph } = scanSourceGraph(SRC_DIR, {
    scope,
    includeTypeOnly: false,
});

const moduleGraph = buildModuleGraph(fileGraph);
const rawCycles = detectCycles(moduleGraph);
const cycles = dedupeCycles(rawCycles);

if (jsonOutput) {
    console.log(JSON.stringify({
        moduleCount: moduleGraph.size,
        cycleCount: cycles.length,
        cycles: cycles.map(c => ({
            path: c,
            length: c.length - 1,
        })),
    }, null, 2));
} else {
    console.log(`扫描到 ${moduleGraph.size} 个模块`);

    if (cycles.length === 0) {
        console.log('✅ 未检测到跨模块循环依赖');
    } else {
        console.log(`⚠️  检测到 ${cycles.length} 个跨模块循环依赖：\n`);
        for (const cycle of cycles) {
            console.log(`  ${cycle.join(' → ')}`);
        }
    }
}

// 退出码
if (cycles.length > 0 && strict) {
    process.exit(1);
}
