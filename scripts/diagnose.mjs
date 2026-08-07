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
 *   node scripts/diagnose.mjs -does           # 只审 docs/知识库/ADR（轻量，秒级）
 *
 * 退出码：任一子检查失败则非零退出（透传子进程退出码）。
 * 设计意图：全量项目诊断编排（秒级 + 分钟级检查）+ 按模块轻量子集
 */

import { execSync } from "node:child_process";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";

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

// ── 继承 check:docs 门禁链（单一真相源，2026-08-06 方案 A）──
// docs 段不再手维护「要跑哪些检查」清单：运行时解析 package.json 的 check:docs，
// 展开全部 `node scripts/*.mjs [--flag]` 子命令（含 `npm run check:*` 嵌套，展开一层）。
// 门禁链新增/删除项自动同步，杜绝「diagnose 落后 check:docs」漂移（曾落后 4 项）。
function expandDocsGate() {
    const pkg = JSON.parse(readFileSync(resolve(ROOT, "package.json"), "utf-8"));
    const chain = pkg.scripts["check:docs"] || "";
    const cmds = [];
    const pushScript = (token) => {
        const m = token.match(/node scripts\/(\S+\.mjs)(.*)$/);
        if (m) {
            cmds.push({ script: m[1], flags: m[2].trim() });
        }
    };
    for (const token of chain.split("&&")) {
        const t = token.trim();
        const nest = t.match(/^npm run (\S+)$/);
        if (nest) {
            pushScript((pkg.scripts[nest[1]] || "").trim());
        } else {
            pushScript(t);
        }
    }
    return cmds;
}

// 门禁链中的 critical 项（原 diagnose docs 段仅这两项 critical，保持语义）
function isGateCritical(script) {
    return script === "gen-status-index.mjs" || script === "check-doc-drift.mjs";
}

// ── 诊断流程 ──

const args = process.argv.slice(2);
const fastOnly = args.includes("--fast");
const slowOnly = args.includes("--slow");
const docsOnly = args.includes("-does") || args.includes("--docs");

const SECTION = {
    fast: (label) => console.log(`\n${CYAN}═══ ${label}（秒级）${RESET}`),
    slow: (label) => console.log(`\n${CYAN}═══ ${label}（分钟级）${RESET}`),
    docs: (label) => console.log(`\n${CYAN}═══ ${label}（docs/知识库，轻量）${RESET}`),
};

let passed = 0;
// 全量模式（非 -does）退出码聚合：与 -does 分支 gateOk 对称——
// critical 项失败经 run() 立即 process.exit(1)；non-critical 项失败在此聚合，
// 末尾统一裁决，杜绝「假绿」（non-critical 失败仍 exit 0）。
let fullOk = true;
function track(result) {
    if (result) passed++;
    else fullOk = false;
    return result;
}

if (docsOnly) {
    SECTION.docs("docs 门禁链（继承 check:docs，真相源=package.json）");
    const gate = expandDocsGate();
    // [code_review P3] 门禁链失败须反映到退出码：-does 声称「继承 check:docs（单一真相源）」，
    // 而 check:docs 是 && 串联、任意项失败即非零退出。旧实现仅 2 项 critical 失败才 exit 1，
    // 其余 18/20 项失败仍 process.exit(0) → 假绿，与真实 check:docs 红绿判定漂移。
    let gateOk = true;
    for (const { script, flags } of gate) {
        const label = script.replace(/\.mjs$/, "") + (flags ? ` ${flags}` : "");
        const ok = runTask(label, `${script} ${flags}`.trim(), { critical: isGateCritical(script) });
        if (ok) passed++;
        else gateOk = false;
    }

    SECTION.docs("diagnose 额外项");
    runTask("ADR 健康检查", "check-adr-health.mjs", { critical: false }) && passed++;
    runTask("ADR 技术债务", "check-adr-technical-debt.mjs", { critical: false }) && passed++;

    console.log(`\n${CYAN}════════════════════════════════════${RESET}`);
    console.log(`  诊断完成（docs/知识库，门禁链 ${gate.length} 项 + 额外 ${2} 项，${passed} 项通过）`);
    process.exit(gateOk ? 0 : 1);
}

if (!slowOnly) {
    SECTION.fast("代码同步");
    track(runTask("check:status", "gen-status-index.mjs --reverse --check"));
    track(runTask("check:funcmap", "gen-funcmap.mjs --check"));

    SECTION.fast("静态检查");
    track(runFrontend("ESLint", "lint"));
    track(runTask("goerr-lint", "goerr-lint.mjs --strict", { critical: false }));
    track(runFrontend("i18n 检查", "check:i18n"));
    track(runFrontend("图标检查", "check:icons"));
    track(runFrontend("格式检查", "format:check"));

    SECTION.fast("架构");
    track(runTask("循环依赖", "check-circular.mjs"));

    SECTION.fast("代码质量基线");
    track(runFrontend("死代码基线", "deadcode:baseline"));

    SECTION.fast("安全扫描");
    track(runFrontend("npm audit", "audit"));

    SECTION.fast("文档漂移");
    track(runTask("文档检查", "check-doc-drift.mjs"));

    SECTION.fast("ADR 健康");
    track(runTask("ADR 健康检查", "check-adr-health.mjs", { critical: false }));
    track(runTask("ADR 技术债务", "check-adr-technical-debt.mjs", { critical: false }));
}

if (!fastOnly) {
    SECTION.slow("全量测试");
    track(run("单元测试", "npm test", { cwd: FRONTEND, critical: false, timeout: 300000 }));
}

// ── 汇总 ──
console.log(`\n${CYAN}════════════════════════════════════${RESET}`);
if (slowOnly) {
    console.log(`  诊断完成（仅测试，跳过秒级项）`);
} else if (fastOnly) {
    console.log(`  诊断完成（仅秒级）`);
} else {
    console.log(`  全量诊断完成`);
}
// 退出码聚合：任一检查（含 non-critical）失败 → exit 1；全通过 → exit 0。
// 与 -does 分支 gateOk 语义对称，消除「假绿」。
process.exit(fullOk ? 0 : 1);
