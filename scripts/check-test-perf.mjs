// check-test-perf.mjs — 防倒退治理：检测「轻用例 × 重依赖图」的新增/变更测试文件
//
// 背景（ADR-256）：vitest isolate=true 下每文件独立加载完整依赖图。实测同类文件
// self（文件自身执行）仅 ~100ms 却付 ~5s total（含依赖图）——这类文件该合并到
// 同系列（mock 列表重叠 ≥80%）或切 node 环境（ADR-255）或 mock 掉重依赖。
// 本脚本对变更集内的测试文件做运行时检测，防止新文件悄悄把全量 import 基线
// （当前 ~148s）涨回去。
//
// 用法：
//   git diff --name-only origin/main HEAD -- "*.test.ts" | node scripts/check-test-perf.mjs
//   或 node scripts/check-test-perf.mjs <file1> <file2>...（相对仓库根或 frontend）
// 退出码：0 = 通过或 warn（不阻断，防倒退提示性质）
//
// 实现：spawn vitest CLI（临时 config 开 importDurations print），解析 stdout 的
// import 耗时列表（vitest 4.1.9 的 JSON reporter/编程 API 均不导出 importDurations，
// 文本是唯一可靠来源）。判定：totalTime > 3s 且 selfTime < 300ms → 轻用例×重依赖。

import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';

const FRONTEND_DIR = fileURLToPath(new URL('../frontend/', import.meta.url));
const VITEST_CLI = join(FRONTEND_DIR, 'node_modules/vitest/vitest.mjs');

const TOTAL_WARN_MS = 3000; // totalTime > 3s 视为重依赖图
const SELF_OK_MS = 300; // selfTime < 300ms 视为文件自身薄（轻用例特征）

// ── 收集变更测试文件（argv 或 stdin 管道） ──
const argvFiles = process.argv.slice(2).filter((a) => a.endsWith('.test.ts'));
const stdinFiles = [];
if (argvFiles.length === 0 && !process.stdin.isTTY) {
    try {
        const buf = readFileSync(0, 'utf8');
        stdinFiles.push(...buf.split('\n').map((s) => s.trim()).filter((s) => s.endsWith('.test.ts')));
    } catch {
        // 无 stdin
    }
}
const changedFiles = [...new Set([...argvFiles, ...stdinFiles])].map((f) =>
    f.replace(/\\/g, '/')
);
if (changedFiles.length === 0) {
    process.stderr.write('[check-test-perf] 变更集无测试文件，通过\n');
    process.exit(0);
}

// ── 临时 config：继承 vitest.config.ts + 开 importDurations 文本输出 ──
const tmpDir = mkdtempSync(join(tmpdir(), 'check-test-perf-'));
const tmpConfig = join(FRONTEND_DIR, '.check-test-perf.config.mjs');
writeFileSync(
    tmpConfig,
    `import { defineConfig, mergeConfig } from 'vitest/config';\n` +
        `import base from './vitest.config';\n` +
        `export default mergeConfig(base, defineConfig({\n` +
        `    test: {\n` +
        `        experimental: {\n` +
        `            importDurations: {\n` +
        `                print: true,\n` +
        `                limit: 10000,\n` +
        `                failOnDanger: false,\n` +
        `                thresholds: { warn: 0, danger: 999999 },\n` +
        `            },\n` +
        `        },\n` +
        `        reporters: ['dot'],\n` +
        `    },\n` +
        `}));\n`
);

process.stderr.write(`[check-test-perf] 变更测试文件 ${changedFiles.length} 个，运行时检测…\n`);
const relArgs = changedFiles.map((f) => f.replace(/^frontend\//, ''));
const result = spawnSync(
    process.execPath,
    [
        VITEST_CLI,
        'run',
        ...relArgs,
        '--config',
        tmpConfig,
        '--no-color',
    ],
    { cwd: FRONTEND_DIR, encoding: 'utf8', timeout: 300000 }
);
rmSync(tmpDir, { recursive: true, force: true });
try {
    rmSync(tmpConfig, { force: true });
} catch {
    // Windows 下文件占用可能删除失败，遗留无害
}

if (result.status !== 0) {
    process.stderr.write(
        `[check-test-perf] ⚠️ vitest 运行失败（exit ${result.status}），无法检测，跳过\n`
    );
    process.exit(0);
}

// ── 解析 stdout 的 import 耗时列表 ──
// 行格式（--no-color）：<path> <self ms> <total ms|s> ██...  例如 "model-preset.test.ts  17ms  3.93s  ███"
const lineRe = /(\S+\.test\.ts)\s+([\d.]+)ms\s+([\d.]+)(ms|s)\b/;
const importStats = new Map(); // fileName -> { selfMs, totalMs }
for (const line of result.stdout.split('\n')) {
    const m = lineRe.exec(line);
    if (!m) continue;
    const file = m[1].split(/[\\/]/).pop();
    const totalMs = parseFloat(m[3]) * (m[4] === 's' ? 1000 : 1);
    importStats.set(file, { selfMs: parseFloat(m[2]), totalMs });
}

const reports = [];
for (const f of changedFiles) {
    const file = f.split(/[\\/]/).pop();
    const stat = importStats.get(file);
    if (!stat) {
        process.stderr.write(`  ? ${file}  （未出现在 import 列表，跳过）\n`);
        continue;
    }
    if (stat.totalMs > TOTAL_WARN_MS && stat.selfMs < SELF_OK_MS) {
        reports.push({ file, ...stat });
    } else {
        process.stderr.write(
            `  ✓ ${file}  self ${stat.selfMs.toFixed(0)}ms / total ${(stat.totalMs / 1000).toFixed(1)}s\n`
        );
    }
}

if (reports.length) {
    process.stderr.write('\n[check-test-perf] ⚠️ 轻用例 × 重依赖图（warn 不阻断）：\n');
    for (const r of reports) {
        process.stderr.write(
            `  - ${r.file}  self ${r.selfMs.toFixed(0)}ms / total ${(r.totalMs / 1000).toFixed(1)}s\n` +
                `    → 建议（ADR-256）：同系列 mock 列表重叠 ≥80% 则合并；纯逻辑则切 node 环境` +
                `（ADR-255）；或 mock 掉重依赖（babylon 纹理/加载器）。\n`
        );
    }
    process.stderr.write('\n');
} else {
    process.stderr.write('[check-test-perf] 变更测试文件 import 成本均正常，通过\n');
}

process.exit(0);
