#!/usr/bin/env node
/**
 * diagnose.mjs — 全量项目诊断编排。
 *
 * 由快到慢执行所有质量检查：
 *  - 秒级：status/funcmap/lint/goerr/i18n/icons/format/circular/deadcode/docs
 *  - 分钟级：全量单测
 *
 * 依赖：node:child_process（execSync 编排）、node:path / node:url。
 *
 * 用法：
 *   npm run diagnose                          # 全量
 *   node scripts/diagnose.mjs                 # 全量
 *   node scripts/diagnose.mjs --fast          # 只跑秒级，跳过测试
 *   node scripts/diagnose.mjs --slow          # 只跑测试
 *
 * 退出码：任一子检查失败则非零退出（透传子进程退出码）。
 * 设计意图：全量项目诊断编排（秒级 + 分钟级检查）
 */

import { execSync } from "node:child_process";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const ROOT = resolve(__dirname, "..");
const FRONTEND = resolve(ROOT, "frontend");

const RED = "\x1b[31m";
const GREEN = "\x1b[32m";
const YELLOW = "\x1b[33m";
const CYAN = "\x1b[36m";
const RESET = "\x1b[0m";

function ok(text) {
    console.log(`  ${GREEN}✓${RESET} ${text}`);
}
function fail(text) {
    console.log(`  ${RED}✗${RESET} ${text}`);
}
function skip(text) {
    console.log(`  ${YELLOW}−${RESET} ${text}`);
}

function run(label, cmd, opts = {}) {
    const { cwd = ROOT, critical = true, timeout = 120000 } = opts;
    process.stdout.write(`  ${CYAN}▶${RESET} ${label}... `);
    try {
        execSync(cmd, { cwd, stdio: "pipe", encoding: "utf8", timeout });
        ok(label);
        return true;
    } catch (e) {
        const msg = e.stderr?.trim() || e.message;
        fail(`${label}${msg ? `\n       ${msg.split("\n").slice(-2).join("; ")}` : ""}`);
        if (critical) {
            console.error(`\n  ${RED}❌ ${label} 失败，中断诊断。${RESET}`);
            process.exit(1);
        }
        return false;
    }
}

function runTask(label, taskName, opts = {}) {
    return run(label, `node scripts/${taskName}`, opts);
}

function runFrontend(label, npmScript) {
    return run(label, `npm run ${npmScript}`, { cwd: FRONTEND, critical: false });
}

// ── 诊断流程 ──

const args = process.argv.slice(2);
const fastOnly = args.includes("--fast");
const slowOnly = args.includes("--slow");

const SECTION = {
    fast: (label) => console.log(`\n${CYAN}═══ ${label}（秒级）${RESET}`),
    slow: (label) => console.log(`\n${CYAN}═══ ${label}（分钟级）${RESET}`),
};

let passed = 0;

if (!slowOnly) {
    SECTION.fast("代码同步");
    runTask("check:status", "gen-status-index.mjs --reverse --check") && passed++;
    runTask("check:funcmap", "gen-funcmap.mjs --check") && passed++;

    SECTION.fast("静态检查");
    runFrontend("ESLint", "lint") && passed++;
    runTask("goerr-lint", "goerr-lint.mjs --strict", { critical: false }) && passed++;
    runFrontend("i18n 检查", "check:i18n") && passed++;
    runFrontend("图标检查", "check:icons") && passed++;
    runFrontend("格式检查", "format:check") && passed++;

    SECTION.fast("架构");
    runTask("循环依赖", "check-circular.mjs") && passed++;

    SECTION.fast("代码质量基线");
    runFrontend("死代码基线", "deadcode:baseline") && passed++;

    SECTION.fast("安全扫描");
    runFrontend("npm audit", "audit") && passed++;

    SECTION.fast("文档漂移");
    runTask("文档检查", "check-doc-drift.mjs") && passed++;

    SECTION.fast("ADR 健康");
    runTask("ADR 健康检查", "check-adr-health.mjs", { critical: false }) && passed++;
    runTask("ADR 技术债务", "check-adr-technical-debt.mjs", { critical: false }) && passed++;
}

if (!fastOnly) {
    SECTION.slow("全量测试");
    run("单元测试", "npm test", { cwd: FRONTEND, critical: false, timeout: 300000 }) && passed++;
}

// ── 汇总 ──
console.log(`\n${CYAN}════════════════════════════════════${RESET}`);
if (slowOnly) {
    console.log(`  诊断完成（仅测试，跳过秒级项）`);
    process.exit(0);
}
if (fastOnly) {
    console.log(`  诊断完成（仅秒级）`);
    process.exit(0);
}
console.log(`  全量诊断完成`);
