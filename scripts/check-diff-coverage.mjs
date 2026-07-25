#!/usr/bin/env node
/**
 * check-diff-coverage.mjs — P8-A diff-coverage gate
 *
 * 解决「覆盖率阈值只防整体回退、不保护新代码有测试」的假安全感。
 * 仅检查「本次变更的非测试源码」的覆盖率，低于阈值即阻塞。
 *
 * 用法（默认在 frontend/ 工作目录运行）：
 *   node ../scripts/check-diff-coverage.mjs
 *     --coverage <path>   默认 ./coverage/coverage-final.json（v8 产物，绝对路径为 key）
 *     --base <ref>        默认 origin/main
 *     --head <ref>        默认 HEAD
 *     --threshold <num>   默认 60（行覆盖率下限 %）
 *     --uncommitted       额外纳入工作区 + 暂存区改动（本地预检用）
 *     --files <csv>       跳过 git，直接用给定文件列表（测试/调试用）
 *
 * 退出码：0 = 全部达标；1 = 存在未达标文件；2 = 配置/用法错误（缺覆盖率文件或 git 失败）
 */

import { execFileSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const REPO_ROOT = resolve(__dirname, "..");

const USAGE_ERROR = 2;
const COVERAGE_FAILURE = 1;

function parseArgs(argv) {
    const out = {};
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i];
        if (!a.startsWith("--")) continue;
        const eq = a.indexOf("=");
        if (eq >= 0) {
            out[a.slice(2, eq)] = a.slice(eq + 1);
        } else if (a === "--uncommitted") {
            out.uncommitted = true;
        } else if (i + 1 < argv.length) {
            out[a.slice(2)] = argv[++i];
        }
    }
    return out;
}

function git(args) {
    try {
        return execFileSync("git", args, { cwd: REPO_ROOT, encoding: "utf8" }).trim();
    } catch {
        return "";
    }
}

/** 取本次改动的非测试源码文件（repo-root 相对路径）。 */
function getChangedFiles(base, head, uncommitted) {
    const out = new Set();
    // 三圆点：PR 分支相对 main 合并基的改动
    git(["diff", "--diff-filter=ACMR", "--name-only", `${base}...${head}`])
        .split("\n")
        .forEach((l) => l && out.add(l));
    // 兜底：直推 main 时三圆点可能为空，退化为上一提交
    if (out.size === 0) {
        git(["diff", "--diff-filter=ACMR", "--name-only", `${head}~1...${head}`])
            .split("\n")
            .forEach((l) => l && out.add(l));
    }
    if (uncommitted) {
        git(["diff", "--name-only"])
            .split("\n")
            .forEach((l) => l && out.add(l));
        git(["diff", "--cached", "--name-only"])
            .split("\n")
            .forEach((l) => l && out.add(l));
    }
    return [...out];
}

/** 仅保留应纳入 diff 门禁的源码：frontend/src 下、非测试、非 index/wailsjs。 */
function isSourceFile(f) {
    return (
        f.endsWith(".ts") &&
        f.includes("src/") &&
        !f.endsWith(".test.ts") &&
        !f.includes("__tests__/") &&
        !f.endsWith("/index.ts") &&
        !f.includes("wailsjs/")
    );
}

/** 把 repo 相对路径映射到 coverage-final.json 的绝对路径 key。 */
function matchCoverageKey(rel, covKeys) {
    const norm = rel.split(sep).join("/");
    const stripped = norm.replace(/^frontend\//, "");
    for (const k of covKeys) {
        const nk = k.split(sep).join("/");
        if (nk === norm) return k;
        if (nk.endsWith("/" + norm)) return k;
        if (nk.endsWith("/" + stripped)) return k;
    }
    return null;
}

/** 语句（行）覆盖率百分比。无语句的文件视为 100%（如纯类型文件）。 */
function statementPct(entry) {
    const s = entry?.s || {};
    const ids = Object.keys(s);
    if (ids.length === 0) return 100;
    let covered = 0;
    for (const id of ids) if ((s[id] || 0) > 0) covered++;
    return (covered / ids.length) * 100;
}

function main() {
    const args = parseArgs(process.argv.slice(2));
    const coveragePath = resolve(args.coverage ?? "coverage/coverage-final.json");
    const base = args.base ?? "origin/main";
    const head = args.head ?? "HEAD";
    const threshold = Number(args.threshold ?? "60");
    const uncommitted = Boolean(args.uncommitted);

    if (!existsSync(coveragePath)) {
        console.error(`[diff-coverage] 未找到覆盖率文件：${coveragePath}`);
        console.error(`[diff-coverage] 请先运行 \`vitest run --coverage\` 生成 coverage-final.json。`);
        process.exit(USAGE_ERROR);
    }

    const cov = JSON.parse(readFileSync(coveragePath, "utf8"));
    const covKeys = Object.keys(cov).filter((k) => k !== "total");

    const changed = args.files
        ? args.files.split(",").map((s) => s.trim()).filter(Boolean)
        : getChangedFiles(base, head, uncommitted);

    const srcFiles = changed.filter(isSourceFile);

    if (srcFiles.length === 0) {
        console.log(`[diff-coverage] 本次无改动源码需要检查（阈值 ${threshold}%）。通过。`);
        process.exit(0);
    }

    const rows = [];
    const failures = [];
    for (const f of srcFiles) {
        const key = matchCoverageKey(f, covKeys);
        const pct = key ? statementPct(cov[key]) : 0;
        const missing = !key; // 无覆盖率条目 → 视为 0% 未覆盖
        rows.push({ file: f, pct, missing });
        if (pct < threshold) failures.push({ file: f, pct });
    }

    console.log(`\n[diff-coverage] 变更源码 ${srcFiles.length} 个，阈值 ${threshold}%（行覆盖率）：`);
    console.log("  " + "文件".padEnd(70) + "覆盖%");
    console.log("  " + "-".repeat(70) + "------");
    for (const r of rows) {
        const flag = r.pct < threshold ? "X" : "OK";
        console.log(`  [${flag}] ${r.file.padEnd(66)} ${r.pct.toFixed(1)}`);
    }

    if (failures.length > 0) {
        console.error(
            `\n[diff-coverage] 失败：${failures.length} 个改动文件覆盖率低于 ${threshold}%。` +
                ` 请为新增/修改逻辑补测试。`
        );
        process.exit(COVERAGE_FAILURE);
    }

    console.log(`\n[diff-coverage] 全部达标（>= ${threshold}%）。通过。`);
    process.exit(0);
}

main();
