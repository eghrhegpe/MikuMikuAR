#!/usr/bin/env node
/**
 * check-coupling.mjs — 结构耦合门禁（ADR-270）
 *
 * 为什么需要它：`check:circular`（ADR-268）防的是「代表环集合变化」，而代表环在
 * 本仓已实测 551 个里 0 个有文件级支撑（ADR-269 折叠盲区）。模块图是 DAG 之后，
 * 该门禁只能拦住「反向新增依赖」，**正向新增跨模块依赖会静默通过**——这正是
 * 耦合真正恶化的形态。
 *
 * 本门禁盯两个只许收紧的结构指标：
 *   1. 有向模块对集合  首次出现的 A→B 才算回归（同一对内部增边不阻断）
 *   2. 文件级 SCC      fileSccFiles（纠缠面）/ fileSccMax（最大纠缠块）
 *
 * 为什么用「集合」而不是「计数」：menus→core 已经有 477 条边，再加一条并不
 * 恶化架构；而 scene/ar→menus 这种从未存在过的通道才是新耦合。计数分不清
 * 这两者，集合可以。新增模块对须人工编辑基线并写明理由，使 diff 可见。
 *
 * 设计意图：环门禁（ADR-268）在模块图成 DAG 后对「正向新增跨模块依赖」失明，
 *           本门禁以「有向模块对集合 + 文件级 SCC 覆盖面/最大块」补这个盲区，只许收紧。
 *
 * 用法：
 *   node scripts/check-coupling.mjs              # 比对基线，超限 exit 1
 *   node scripts/check-coupling.mjs --update     # 收紧基线（只删对/只降数）
 *   node scripts/check-coupling.mjs --json       # 机器可读
 *
 * 退出码：0=通过（耦合未恶化）/ 1=耦合回归、基线缺失，或 --update 试图放宽基线。
 *
 * 基线：docs/.coupling-baseline.json
 * 零依赖（node:fs / node:path / node:url）。
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, relative } from 'node:path';
import { pathToFileURL } from 'node:url';

import { scanSourceGraph } from './_lib/source-graph.mjs';
import { parseArgs } from './_lib/parse-args.mjs';
import { tarjanScc, nontrivialSccs, sccSummary } from './_lib/scc.mjs';
import { ROOT } from './_lib/scan-files.mjs';

const REPO_ROOT = ROOT;
const SRC_DIR = process.env.COUPLING_SRC ? resolve(process.env.COUPLING_SRC) : resolve(REPO_ROOT, 'frontend', 'src');
const BASELINE_FILE = process.env.COUPLING_BASELINE
    ? resolve(process.env.COUPLING_BASELINE)
    : resolve(REPO_ROOT, 'docs', '.coupling-baseline.json');

/**
 * 从源码图算出结构耦合指标。导出供测试直接调用。
 * @param {string} srcDir 绝对路径
 * @returns {{files: number, edges: number, modulePairs: string[], fileSccCount: number, fileSccFiles: number, fileSccMax: number}}
 */
export function computeCoupling(srcDir) {
    const { graph } = scanSourceGraph(srcDir, { includeDynamic: false });
    const nodes = [...graph.keys()];
    const succ = (n) => [...(graph.get(n) || [])];

    // 模块归属：与 check-circular / dep-metrics 同一实现（单段路径归 core，scene 二级目录成 scene/x）
    const moduleOf = (rel) => {
        const parts = rel.split('/');
        if (parts.length === 1) return 'core';
        if (parts[0] === 'scene' && parts.length > 2) return `scene/${parts[1]}`;
        return parts[0];
    };

    const pairSet = new Set();
    let edges = 0;
    for (const from of nodes) {
        const fm = moduleOf(from);
        for (const to of succ(from)) {
            edges++;
            const tm = moduleOf(to);
            if (fm !== tm) pairSet.add(`${fm}|${tm}`);
        }
    }

    const sccs = nontrivialSccs(tarjanScc(nodes, succ));
    const summary = sccSummary(sccs);

    return {
        files: nodes.length,
        edges,
        modulePairs: [...pairSet].sort(),
        fileSccCount: summary.count,
        fileSccFiles: summary.files,
        fileSccMax: summary.max,
    };
}

function loadBaseline() {
    if (!existsSync(BASELINE_FILE)) return null;
    return JSON.parse(readFileSync(BASELINE_FILE, 'utf8'));
}

function main() {
    const args = parseArgs(process.argv.slice(2), {
        bools: ['json', 'update'],
        strings: [],
        defaults: { json: false, update: false },
    });
    if (args.help) {
        const src = readFileSync(process.argv[1], 'utf-8');
        const s = src.indexOf('/**');
        const e = src.indexOf('*/', s);
        console.log(src.slice(s, e + 2).replace(/^ \* ?/gm, '').trim());
        process.exit(0);
    }
    if (args.unknown && args.unknown.length) {
        console.error(`❌ 未知参数: ${args.unknown.join(', ')}（--help 查看用法）`);
        process.exit(1);
    }

    const current = computeCoupling(SRC_DIR);
    const baseline = loadBaseline();

    if (args.update) {
        if (!baseline) {
            writeBaseline(current);
            process.exit(0);
        }
        const basePairs = new Set(baseline.modulePairs ?? []);
        const newPairs = current.modulePairs.filter((p) => !basePairs.has(p));
        const loosened = [];
        if (newPairs.length > 0) loosened.push(`新增模块对 ${newPairs.length} 个：${newPairs.join(', ')}`);
        if (current.fileSccFiles > (baseline.fileSccFiles ?? Infinity))
            loosened.push(`fileSccFiles: ${baseline.fileSccFiles} → ${current.fileSccFiles}`);
        if (current.fileSccMax > (baseline.fileSccMax ?? Infinity))
            loosened.push(`fileSccMax: ${baseline.fileSccMax} → ${current.fileSccMax}`);

        if (loosened.length > 0) {
            console.error('❌ --update 拒绝：以下指标高于基线，耦合只能收紧不能放宽：');
            for (const l of loosened) console.error(`   ${l}`);
            console.error('   新增模块对若确属有意，请人工编辑 docs/.coupling-baseline.json');
            console.error('   并在此处写明理由，使评审能看到这次放宽。');
            process.exit(1);
        }
        writeBaseline(current);
        process.exit(0);
    }

    if (!baseline) {
        console.error(`❌ 基线缺失: ${relative(REPO_ROOT, BASELINE_FILE)}`);
        console.error('   运行 `node scripts/check-coupling.mjs --update` 建立基线');
        process.exit(1);
    }

    const basePairs = new Set(baseline.modulePairs ?? []);
    const curPairs = new Set(current.modulePairs);
    const newPairs = current.modulePairs.filter((p) => !basePairs.has(p));
    const fixedPairs = [...basePairs].filter((p) => !curPairs.has(p)).sort();

    const regressions = [];
    const fixed = [];
    if (newPairs.length > 0) regressions.push(`新增跨模块耦合通道 ${newPairs.length} 个：${newPairs.join(', ')}`);
    if (current.fileSccFiles > (baseline.fileSccFiles ?? Infinity))
        regressions.push(`fileSccFiles: 基线 ${baseline.fileSccFiles} → 当前 ${current.fileSccFiles}`);
    if (current.fileSccMax > (baseline.fileSccMax ?? Infinity))
        regressions.push(`fileSccMax: 基线 ${baseline.fileSccMax} → 当前 ${current.fileSccMax}`);

    if (fixedPairs.length > 0) fixed.push(`已消失的模块对 ${fixedPairs.length} 个：${fixedPairs.join(', ')}`);
    if (current.fileSccFiles < (baseline.fileSccFiles ?? Infinity))
        fixed.push(`fileSccFiles: ${baseline.fileSccFiles} → ${current.fileSccFiles}`);
    if (current.fileSccMax < (baseline.fileSccMax ?? Infinity))
        fixed.push(`fileSccMax: ${baseline.fileSccMax} → ${current.fileSccMax}`);

    if (args.json) {
        console.log(
            JSON.stringify(
                {
                    current: {
                        files: current.files,
                        edges: current.edges,
                        modulePairs: current.modulePairs.length,
                        fileSccCount: current.fileSccCount,
                        fileSccFiles: current.fileSccFiles,
                        fileSccMax: current.fileSccMax,
                    },
                    baseline: {
                        modulePairs: basePairs.size,
                        fileSccFiles: baseline.fileSccFiles,
                        fileSccMax: baseline.fileSccMax,
                    },
                    newPairs,
                    fixedPairs,
                    regressions,
                    fixed,
                },
                null,
                2,
            ),
        );
        process.exit(regressions.length > 0 ? 1 : 0);
    }

    console.log('=== 结构耦合检查（ADR-270）===');
    console.log(
        `当前：模块对 ${current.modulePairs.length} / SCC ${current.fileSccCount} 个覆盖 ${current.fileSccFiles} 文件 / 最大 ${current.fileSccMax}\n`,
    );

    if (regressions.length > 0) {
        console.error(`❌ 结构耦合恶化 ${regressions.length} 项：`);
        for (const r of regressions) console.error(`   ${r}`);
        console.error('   首次出现的模块对意味着一条全新的耦合通道；SCC 变大意味着子系统内部缠得更紧。');
        console.error('   修复代码消除，而非放宽基线（ADR-238「消除依赖本身」）。');
    } else {
        console.log('✅ 结构耦合未恶化');
    }

    if (fixed.length > 0) {
        console.log(`🎉 已收紧 ${fixed.length} 项：`);
        for (const f of fixed) console.log(`   ${f}`);
        console.log('   运行 `node scripts/check-coupling.mjs --update` 收紧基线');
    }

    console.log(regressions.length > 0 ? '\n❌ 结构耦合检查未通过' : '\n✅ 结构耦合检查通过');
    process.exit(regressions.length > 0 ? 1 : 0);
}

function writeBaseline(m) {
    const data = {
        _comment:
            'ADR-270 结构耦合基线。modulePairs 是「已批准存在的有向模块对」，新增须人工编辑并写明理由；fileSccFiles/fileSccMax 只许降。更新: node scripts/check-coupling.mjs --update',
        generatedAt: new Date().toISOString().slice(0, 10),
        modulePairs: m.modulePairs,
        fileSccFiles: m.fileSccFiles,
        fileSccMax: m.fileSccMax,
    };
    writeFileSync(BASELINE_FILE, JSON.stringify(data, null, 2) + '\n');
    console.log(
        `[coupling] 基线已更新: ${relative(REPO_ROOT, BASELINE_FILE)}（模块对 ${m.modulePairs.length} / SCC ${m.fileSccCount} 个覆盖 ${m.fileSccFiles} 文件 / 最大 ${m.fileSccMax}）`,
    );
}

const invokedDirectly = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) main();
