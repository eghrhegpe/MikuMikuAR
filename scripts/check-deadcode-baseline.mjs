#!/usr/bin/env node
/**
 * check-deadcode-baseline.mjs — knip/jscpd 死代码与重复代码基线治理
 *
 * 复用 check-doc-drift 的 baseline 模式：
 *   1. 跑 knip --reporter json 解析 issue 数量
 *   2. 跑 jscpd 解析 clone 数量
 *   3. 对比 baseline，仅防回退（数量增加则失败）
 *
 * 用法（在 frontend/ 下运行）：
 *   node ../scripts/check-deadcode-baseline.mjs              # 检查
 *   node ../scripts/check-deadcode-baseline.mjs --update     # 更新基线
 *
 * 退出码：0 = 未回退；1 = 回退（数量增加）；2 = 配置错误
 */

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const REPO_ROOT = resolve(__dirname, "..");
const FRONTEND = resolve(REPO_ROOT, "frontend");
const BASELINE_FILE = resolve(REPO_ROOT, "docs", ".deadcode-baseline.json");

const USAGE_ERROR = 2;
const REGRESSION = 1;

// ── knip ───────────────────────────────────────────────────────

/** 跑 knip 拿 JSON 输出。knip exit 0（rules=warn），靠解析 JSON 判定。 */
function runKnip() {
    // Windows 下 npx.cmd 在 execFileSync 中会 EINVAL，直接调用 node + knip 入口
    const knipEntry = resolve(FRONTEND, "node_modules", "knip", "bin", "knip.js");
    if (!existsSync(knipEntry)) {
        console.error(`[deadcode] knip 未安装: ${knipEntry}`);
        return null;
    }
    try {
        const raw = execFileSync(
            process.execPath,
            [knipEntry, "--reporter", "json"],
            { cwd: FRONTEND, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] }
        );
        return JSON.parse(raw);
    } catch (e) {
        const stdout = e.stdout ? e.stdout.toString() : "";
        if (stdout.trim().startsWith("{")) {
            try { return JSON.parse(stdout); } catch {}
        }
        console.error("[deadcode] knip 运行失败:", e.message);
        return null;
    }
}

/** 统计 knip 各类别 issue 数量 */
function countKnip(knipJson) {
    if (!knipJson || !knipJson.issues) return {};
    const counts = {
        unusedExports: 0,
        unusedTypes: 0,
        duplicateExports: 0,
        unusedDevDeps: 0,
        unlistedDeps: 0,
    };
    for (const file of knipJson.issues) {
        counts.unusedExports += (file.exports || []).length;
        counts.unusedTypes += (file.types || []).length;
        counts.duplicateExports += (file.duplicates || []).length;
        counts.unusedDevDeps += (file.devDependencies || []).length;
        counts.unlistedDeps += (file.unlisted || []).length;
    }
    return counts;
}

// ── jscpd ─────────────────────────────────────────────────────

/** 跑 jscpd 拿 JSON 输出 */
function runJscpd() {
    const jscpdEntry = resolve(FRONTEND, "node_modules", "jscpd", "run-jscpd.js");
    const reportPath = resolve(FRONTEND, "report", "jscpd-report.json");
    try {
        execFileSync(
            process.execPath,
            [jscpdEntry, "--config", "jscpd.config.json", "--reporters", "json", "src"],
            { cwd: FRONTEND, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] }
        );
    } catch {
        // jscpd 发现 clone 时 exit 1，忽略
    }
    if (!existsSync(reportPath)) return null;
    try {
        return JSON.parse(readFileSync(reportPath, "utf8"));
    } catch {
        return null;
    }
}

/** 统计 jscpd clone 数量 */
function countJscpd(jscpdJson) {
    if (!jscpdJson || !jscpdJson.statistics) return { clones: 0, duplicatedLines: 0 };
    const s = jscpdJson.statistics;
    return {
        clones: s.total.clones || 0,
        duplicatedLines: s.total.duplicatedLines || 0,
    };
}

// ── 基线治理 ──────────────────────────────────────────────────

const BASELINE_TRACKED = [
    ["unusedExports", "未使用导出"],
    ["unusedTypes", "未使用类型"],
    ["duplicateExports", "重复导出"],
    ["unusedDevDeps", "未使用 devDep"],
    ["unlistedDeps", "未声明依赖"],
    ["clones", "重复代码块"],
    ["duplicatedLines", "重复代码行"],
];

function readBaseline() {
    try {
        return JSON.parse(readFileSync(BASELINE_FILE, "utf8"));
    } catch {
        return null;
    }
}

function writeBaseline(counts) {
    const data = { ...counts, updatedAt: new Date().toISOString().slice(0, 10) };
    writeFileSync(BASELINE_FILE, JSON.stringify(data, null, 2) + "\n");
}

function main() {
    const args = process.argv.slice(2);
    const doUpdate = args.includes("--update");

    console.log("[deadcode] 运行 knip...");
    const knipJson = runKnip();
    const knipCounts = countKnip(knipJson);

    console.log("[deadcode] 运行 jscpd...");
    const jscpdJson = runJscpd();
    const jscpdCounts = countJscpd(jscpdJson);

    const counts = { ...knipCounts, ...jscpdCounts };

    if (doUpdate) {
        writeBaseline(counts);
        console.log(`[deadcode] 基线已更新: ${BASELINE_FILE}`);
        console.log("  " + BASELINE_TRACKED.map(([k, label]) => `${label}: ${counts[k]}`).join("，"));
        process.exit(0);
    }

    const baseline = readBaseline();
    if (!baseline) {
        console.log("[deadcode] 无基线文件，首次运行写入基线。");
        writeBaseline(counts);
        console.log("  " + BASELINE_TRACKED.map(([k, label]) => `${label}: ${counts[k]}`).join("，"));
        process.exit(0);
    }

    // 对比 baseline，仅防回退
    let regressed = false;
    console.log("\n[deadcode] 基线对比:");
    console.log("  " + "指标".padEnd(20) + "基线".padStart(6) + "当前".padStart(6) + "  状态");
    console.log("  " + "-".repeat(40));
    for (const [key, label] of BASELINE_TRACKED) {
        const base = baseline[key] ?? 0;
        const curr = counts[key] ?? 0;
        const ok = curr <= base;
        const flag = ok ? "OK" : "X";
        console.log(`  [${flag}] ${label.padEnd(16)} ${String(base).padStart(6)} ${String(curr).padStart(6)}`);
        if (!ok) regressed = true;
    }

    if (regressed) {
        console.error("\n[deadcode] ❌ 回退：部分指标超过基线。请清理新增死代码或更新基线（--update）。");
        process.exit(REGRESSION);
    }

    console.log("\n[deadcode] ✅ 未回退（各项 <= 基线）。");
    process.exit(0);
}

main();
