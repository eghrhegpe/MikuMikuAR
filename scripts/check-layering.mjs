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
// 测试钩子：LAYERING_SRC / LAYERING_BASELINE 指向 fixture（真实运行不设，不受影响）
const SRC_ROOT = process.env.LAYERING_SRC
    ? resolve(process.env.LAYERING_SRC)
    : resolve(REPO_ROOT, 'frontend', 'src');
const BASELINE_FILE = process.env.LAYERING_BASELINE
    ? resolve(process.env.LAYERING_BASELINE)
    : resolve(REPO_ROOT, 'docs', '.layering-baseline.json');

/** 顶层算法目录（ADR-242 认定的中间层） */
const TOPLEVEL_ALGO = ['motion-algos'];

const { json, update, help, unknown } = parseArgs(process.argv.slice(2), { bools: ['json', 'update'] });
if (help) {
    const _src = readFileSync(process.argv[1], 'utf-8');
    const _s = _src.indexOf('/**');
    const _e = _src.indexOf('*/', _s);
    console.log(_src.slice(_s, _e + 2).replace(/^ \* ?/gm, '').trim());
    process.exit(0);
}
if (unknown && unknown.length) {
    console.error(`❌ 未知参数: ${unknown.join(', ')}（--help 查看用法）`);
    process.exit(1);
}

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
// 跨行 import/export-from、副作用导入、动态 import（与 _lib/source-graph.mjs
// parseSourceImports 同款模式，消除单行正则漏报「多行 import / await import()」的漂移）。
// 捕获组1 = from 前文本（用于 type-only 判定），组2 = spec。
// [P2 2026-08-08] body 限定 `[^;"'/`]*?`：旧 `[\s\S]*?` 无界 lazy 会跨语句/字符串/注释
// 吞到文件里任意后续 `from '...'`（副作用导入 `import '../app.css'`、`export const X = "..."`、
// 注释里记录的旧路径等都会伪造假导入边）。排除引号/分号/斜杠/反引号后，多行 specifier 列表
// `{\n  loadScene,\n}` 仍可匹配（不含这些字符），但无法吸收其他语句或注释内容。
const IMPORT_FROM_RE = /(?:^|\n)\s*(?:\/\/[^\n]*\n)*\s*(?:import|export)\b([^;"'/`]*?)\bfrom\s+['"]([^'"]+)['"]/gm;
const IMPORT_SIDE_RE = /(?:^|\n)\s*(?:\/\/[^\n]*\n)*\s*import\s+['"]([^'"]+)['"]/gm;
const IMPORT_DYNA_RE = /await\s+import\s*\(\s*['"]([^'"]+)['"]\s*\)/gm;

/** from 前文本是否 type-only：`import type …` 或具名项全部带 `type` 前缀（`{ type A, type B }`）。 */
function isTypeOnlyBody(body) {
    const b = body.trim();
    return /^type\b/.test(b)
        || /^\{\s*(?:type\s+\w+(?:\s+as\s+\w+)?\s*,?\s*)+\}\s*$/.test(b);
}

const violations = [];

for (const abs of walk(SRC_ROOT, SCAN_OPTS)) {
    const srcRel = relative(SRC_ROOT, abs).replace(/\\/g, '/');
    const fromLayer = layerOf(srcRel);
    if (!fromLayer || fromLayer === 'menus') continue; // menus 是顶层，向下依赖合法

    const text = readFileSync(abs, 'utf8');
    const lineOf = (idx) => text.slice(0, idx).split('\n').length;

    const visit = (spec, typeOnly, idx) => {
        if (typeOnly) return; // type-only 豁免
        const target = resolveTarget(spec, srcRel);
        if (!target) return;
        const toLayer = layerOf(target);
        if (!toLayer) return;

        let rule = null;
        if (fromLayer === 'algo' && toLayer === 'menus') rule = 'R1';
        else if (fromLayer === 'core' && (toLayer === 'menus' || toLayer === 'scene')) rule = 'R2';
        else if (fromLayer === 'algo' && toLayer === 'scene') rule = 'R3';
        if (!rule) return;

        violations.push({ rule, from: srcRel, line: lineOf(idx), to: target, fromLayer, toLayer });
    };

    for (const re of [IMPORT_FROM_RE, IMPORT_SIDE_RE, IMPORT_DYNA_RE]) {
        re.lastIndex = 0;
        let m;
        while ((m = re.exec(text)) !== null) {
            if (re === IMPORT_FROM_RE) visit(m[2], isTypeOnlyBody(m[1]), m.index);
            else visit(m[1], false, m.index);
        }
    }
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
