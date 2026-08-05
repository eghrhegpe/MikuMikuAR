#!/usr/bin/env node
/**
 * check-layering.mjs — 前端分层依赖方向守护（ADR-242）
 *
 * 设计意图：
 *   ADR-242 证伪了「顶层目录 = 纯算法层」的假说，改以「依赖方向」为唯一分层公理。
 *   本脚本把该公理固化为 CI 可执行的规则，防止分层进一步腐化。
 *
 * 层级（自上而下）：
 *   menus/  →  scene/  →  顶层算法目录  →  core/
 *   允许上层 import 下层；反向 import 即违规。
 *
 * 规则：
 *   R1（零容忍）  顶层算法目录 不得运行时 import  @/menus/**
 *   R2（防回退）  core/**      不得运行时 import  @/menus/** 或 @/scene/**
 *   R3（防回退）  顶层算法目录 不得运行时 import  @/scene/**
 *
 *   `import type` 不构成运行时耦合，一律豁免。
 *
 * 依赖：node:fs / node:path / node:url / 本地模块
 *
 * 用法：
 *   node scripts/check-layering.mjs            # 检查（R1 违规或 R2/R3 超基线则退 1）
 *   node scripts/check-layering.mjs --json     # 机器可读输出
 *   node scripts/check-layering.mjs --update   # 更新 R2/R3 基线
 *
 * 退出码：0 通过 / 1 违规
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from './_lib/parse-args.mjs';
import { walk } from './_lib/scan-files.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..');
const SRC_ROOT = resolve(REPO_ROOT, 'frontend', 'src');
const BASELINE_FILE = resolve(REPO_ROOT, 'docs', '.layering-baseline.json');

/** 顶层算法目录（ADR-242 认定的中间层） */
const TOPLEVEL_ALGO = ['motion-algos', 'physics', 'library', 'materials', 'outfit'];

const { json, update } = parseArgs(process.argv.slice(2), { bools: ['json', 'update'] });

/* ---------- 收集源文件（复用 _lib/scan-files 共享遍历层） ---------- */
const SCAN_OPTS = {
    exts: ['.ts', '.tsx'],
    skipDir: (n) => n.startsWith('.') || n === 'node_modules' || n === '__tests__',
    skipFile: /\.(d|test|spec)\.tsx?$/,
};

/** 文件所属层：'menus' | 'scene' | 'algo' | 'core' | null */
function layerOf(srcRelPath) {
    const top = srcRelPath.split('/')[0];
    if (top === 'menus') return 'menus';
    if (top === 'scene') return 'scene';
    if (top === 'core') return 'core';
    if (TOPLEVEL_ALGO.includes(top)) return 'algo';
    return null;
}

/** 解析 import 目标，归一化为相对 src 的路径前缀（如 'menus/foo'） */
function resolveTarget(spec, fromSrcRel) {
    if (spec.startsWith('@/')) return spec.slice(2);
    if (spec.startsWith('.')) {
        const abs = resolve(dirname(resolve(SRC_ROOT, fromSrcRel)), spec);
        const rel = relative(SRC_ROOT, abs).replace(/\\/g, '/');
        return rel.startsWith('..') ? null : rel;
    }
    return null; // 裸包名（@babylonjs 等）不参与分层判定
}

/* ---------- 扫描 ---------- */
// 匹配 import / export-from 语句，捕获是否 type-only 与来源字符串
const IMPORT_RE = /^\s*(?:import|export)\s+(type\s+)?([^'"]*?)from\s*['"]([^'"]+)['"]/;
const BARE_IMPORT_RE = /^\s*import\s*['"]([^'"]+)['"]/;

const violations = [];

for (const abs of walk(SRC_ROOT, SCAN_OPTS)) {
    const srcRel = relative(SRC_ROOT, abs).replace(/\\/g, '/');
    const fromLayer = layerOf(srcRel);
    if (!fromLayer || fromLayer === 'menus') continue; // menus 是顶层，向下依赖合法

    const lines = readFileSync(abs, 'utf8').split('\n');
    lines.forEach((line, i) => {
        let spec = null;
        let typeOnly = false;

        const m = IMPORT_RE.exec(line);
        if (m) {
            spec = m[3];
            // `import type … from`（整句 type-only），或具名项全部带 `type` 前缀
            typeOnly = Boolean(m[1]) || /^\s*\{\s*(?:type\s+\w+(?:\s+as\s+\w+)?\s*,?\s*)+\}\s*$/.test(m[2]);
        } else {
            const b = BARE_IMPORT_RE.exec(line);
            if (b) spec = b[1]; // 副作用导入，必为运行时
        }
        if (!spec) return;

        const target = resolveTarget(spec, srcRel);
        if (!target) return;
        const toLayer = layerOf(target);
        if (!toLayer) return;
        if (typeOnly) return; // type-only 豁免

        let rule = null;
        if (fromLayer === 'algo' && toLayer === 'menus') rule = 'R1';
        else if (fromLayer === 'core' && (toLayer === 'menus' || toLayer === 'scene')) rule = 'R2';
        else if (fromLayer === 'algo' && toLayer === 'scene') rule = 'R3';
        if (!rule) return;

        violations.push({ rule, from: srcRel, line: i + 1, to: target, fromLayer, toLayer });
    });
}

/* ---------- 基线比对 ---------- */
const key = (v) => `${v.from}:${v.to}`;
const r1 = violations.filter((v) => v.rule === 'R1');
const tracked = violations.filter((v) => v.rule !== 'R1');

const baseline = existsSync(BASELINE_FILE) ? JSON.parse(readFileSync(BASELINE_FILE, 'utf8')) : null;

if (update) {
    const data = {
        _comment: 'ADR-242 分层反向边基线。仅允许减少，不允许增加。更新: node scripts/check-layering.mjs --update',
        generatedAt: new Date().toISOString().slice(0, 10),
        entries: [...new Set(tracked.map(key))].sort(),
    };
    writeFileSync(BASELINE_FILE, JSON.stringify(data, null, 2) + '\n');
    console.log(`[layering] 基线已更新: ${relative(REPO_ROOT, BASELINE_FILE)}（${data.entries.length} 条反向边）`);
    process.exit(0);
}

const known = new Set(baseline?.entries ?? []);
const regressions = tracked.filter((v) => !known.has(key(v)));
const fixed = [...known].filter((k) => !tracked.some((v) => key(v) === k));

if (json) {
    console.log(JSON.stringify({ r1, regressions, fixed, total: tracked.length, baseline: known.size }, null, 2));
    process.exit(r1.length || regressions.length ? 1 : 0);
}

/* ---------- 报告 ---------- */
console.log('=== 分层依赖方向检查（ADR-242）===');
console.log(`扫描层级: menus → scene → [${TOPLEVEL_ALGO.join(', ')}] → core\n`);

if (r1.length) {
    console.error(`❌ R1 违规（零容忍：算法层 import menus）${r1.length} 条：`);
    for (const v of r1) console.error(`   ${v.from}:${v.line} → ${v.to}`);
} else {
    console.log('✅ R1 算法层 → menus：0 条');
}

const trackedEdges = new Set(tracked.map(key));
console.log(`\nR2/R3 反向边: ${trackedEdges.size} 条唯一边 / ${tracked.length} 处 import（基线 ${known.size} 条）`);
if (regressions.length) {
    console.error(`❌ 新增 ${regressions.length} 条反向边（超出基线）：`);
    for (const v of regressions) console.error(`   [${v.rule}] ${v.from}:${v.line} → ${v.to}`);
}
if (fixed.length) {
    console.log(`🎉 已消除 ${fixed.length} 条：${fixed.slice(0, 5).join(', ')}${fixed.length > 5 ? ' …' : ''}`);
    console.log('   运行 `node scripts/check-layering.mjs --update` 收紧基线');
}

const failed = r1.length > 0 || regressions.length > 0;
console.log(failed ? '\n❌ 分层检查未通过' : '\n✅ 分层检查通过');
process.exit(failed ? 1 : 0);
