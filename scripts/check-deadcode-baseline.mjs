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
 * 设计意图：死代码基线检查（与 baseline 文件比对）
 * 依赖：node:child_process / node:fs / node:path / node:url / 本地模块
 */

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { toPosix } from "./_lib/to-posix.mjs";

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

/** 统计 knip 各类别 issue 数量（覆盖 knip.config.ts 已 open 的全部 10 类） */
function countKnip(knipJson) {
    if (!knipJson || !knipJson.issues) return {};
    const counts = {
        unusedExports: 0,
        unusedTypes: 0,
        duplicateExports: 0,
        unusedDevDeps: 0,
        unlistedDeps: 0,
        // [P2 2026-08-08] 扩充：旧实现只跟踪 5 类，files（死文件）/dependencies（未用依赖）/
        // nsExports/nsTypes/enumMembers 虽在 knip.config.ts open 却从不入基线 → 新增死文件
        // 或未用依赖不设防。现补齐 knip 全部 10 类。
        deadFiles: 0,
        unusedDeps: 0,
        nsExports: 0,
        nsTypes: 0,
        enumMembers: 0,
    };
    for (const file of knipJson.issues) {
        counts.unusedExports += (file.exports || []).length;
        counts.unusedTypes += (file.types || []).length;
        counts.duplicateExports += (file.duplicates || []).length;
        counts.unusedDevDeps += (file.devDependencies || []).length;
        counts.unlistedDeps += (file.unlisted || []).length;
        counts.deadFiles += (file.files || []).length;
        counts.unusedDeps += (file.dependencies || []).length;
        counts.nsExports += (file.nsExports || []).length;
        counts.nsTypes += (file.nsTypes || []).length;
        counts.enumMembers += (file.enumMembers || []).length;
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
    ["deadFiles", "死文件"],
    ["unusedDeps", "未使用依赖"],
    ["nsExports", "命名空间导出"],
    ["nsTypes", "命名空间类型"],
    ["enumMembers", "未用枚举成员"],
    ["clones", "重复代码块"],
    ["duplicatedLines", "重复代码行"],
];

function readBaseline() {
    // [P1 2026-08-08] 区分「文件不存在」（首跑建基线）与「解析失败/损坏」（exit 2 报错）：
    // 旧实现两者都返回 null → main 静默重建基线，损坏基线被无痕覆盖掩盖真实回归。
    if (!existsSync(BASELINE_FILE)) return { missing: true };
    let parsed;
    try {
        parsed = JSON.parse(readFileSync(BASELINE_FILE, "utf8"));
    } catch (e) {
        return { corrupt: true, error: e.message };
    }
    // 基线 schema 校验：核心指标字段必须存在（空对象/截断 JSON 视为损坏而非合法基线）
    const requiredKeys = BASELINE_TRACKED.map(([k]) => k);
    const missingKeys = requiredKeys.filter((k) => !(k in parsed));
    if (missingKeys.length > 0) {
        return { corrupt: true, error: `缺少核心字段（${missingKeys.join(", ")}）` };
    }
    return { baseline: parsed };
}

function writeBaseline(counts) {
    const data = { ...counts, updatedAt: new Date().toISOString().slice(0, 10) };
    writeFileSync(BASELINE_FILE, JSON.stringify(data, null, 2) + "\n");
}

/** 显示 knip 详细报告（文件 + 符号 + 行号），让 AI/人知道具体在报什么 */
function showKnipDetails(knipJson) {
    if (!knipJson || !knipJson.issues) return;
    let any = false;
    for (const file of knipJson.issues) {
        const rows = [];
        if (file.exports?.length) {
            for (const e of file.exports) rows.push(`  export  ${(e.name || "").padEnd(32)} ${e.line ? `:${e.line}` : ""}`);
        }
        if (file.types?.length) {
            for (const t of file.types) rows.push(`  type    ${(t.name || "").padEnd(32)} ${t.line ? `:${t.line}` : ""}`);
        }
        if (file.duplicates?.length) {
            // [P2 2026-08-08] knip JSON 的 duplicates 是数组套数组（symbols.map(convert)），
            // 元素为 [name, line] 二元组——旧 d.name 恒 undefined → 打印 `dup undefined`。
            // 展示取数组首元素作为符号名。
            for (const d of file.duplicates) {
                const dupName = Array.isArray(d) ? d[0] : d.name;
                const dupLine = Array.isArray(d) ? d[1] : d.line;
                rows.push(`  dup     ${String(dupName || "").padEnd(32)} ${dupLine ? `:${dupLine}` : ""}`);
            }
        }
        if (file.devDependencies?.length) {
            for (const d of file.devDependencies) rows.push(`  devDep  ${(d.name || "").padEnd(32)} ${d.line ? `:${d.line}` : ""}`);
        }
        if (file.unlisted?.length) {
            for (const u of file.unlisted) rows.push(`  unlist  ${(u.name || "").padEnd(32)} ${u.line ? `:${u.line}` : ""}`);
        }
        if (rows.length) {
            any = true;
            console.log(`  ${toPosix(file.file)}:`);
            for (const r of rows) console.log(r);
        }
    }
    if (!any) console.log("  （无）");
}

/** 显示 jscpd 重复代码详情 */
function showJscpdDetails(jscpdJson) {
    if (!jscpdJson?.statistics?.clones?.length) {
        console.log("  （无）");
        return;
    }
    const short = (f) => toPosix(f).replace(/^.*?src[\\/]?/, "src/");
    for (const clone of jscpdJson.statistics.clones.slice(0, 10)) {
        // [P2 2026-08-08] jscpd 5.x 字段为 firstFile/secondFile（旧 duplicationA/B 是 4.x，
        // 对 5.x 报告恒 undefined → 回归详情永远空白误导排查）。含 startLoc.line 定位。
        const a = clone.firstFile;
        const b = clone.secondFile;
        if (a && b) {
            console.log(`  clone  ${short(a.name)}:${a.startLoc?.line || ""}`);
            console.log(`         └ ${short(b.name)}:${b.startLoc?.line || ""}`);
        }
    }
}

function main() {
    const args = process.argv.slice(2);
    const doUpdate = args.includes("--update");

    console.log("[deadcode] 运行 knip...");
    const knipJson = runKnip();
    // [P1 2026-08-08] knip 失败（null）不再 fail-open：countKnip(null) 全 0 → 0 ≤ 基线 →
    // exit 0 假绿，且 pre-push 输出被 >/dev/null 吞掉用户无感知。工具未产出报告即中止。
    if (knipJson === null) {
        console.error("[deadcode] ❌ knip 执行失败（未产出报告），中止而非假绿通过");
        console.error("  请检查 knip 是否可运行：cd frontend && npx knip --reporter json");
        process.exit(USAGE_ERROR);
    }
    const knipCounts = countKnip(knipJson);

    console.log("[deadcode] 运行 jscpd...");
    const jscpdJson = runJscpd();
    // [P1 2026-08-08] jscpd 失败（null：spawn 失败/报告缺失/JSON 损坏）同样不假绿。
    if (jscpdJson === null) {
        console.error("[deadcode] ❌ jscpd 执行失败（未产出报告），中止而非假绿通过");
        console.error("  请检查 jscpd 是否可运行：cd frontend && npx jscpd --config jscpd.config.json --reporters json src");
        process.exit(USAGE_ERROR);
    }
    const jscpdCounts = countJscpd(jscpdJson);

    const counts = { ...knipCounts, ...jscpdCounts };

    if (doUpdate) {
        writeBaseline(counts);
        console.log(`[deadcode] 基线已更新: ${BASELINE_FILE}`);
        console.log("  " + BASELINE_TRACKED.map(([k, label]) => `${label}: ${counts[k]}`).join("，"));
        process.exit(0);
    }

    const baselineRes = readBaseline();
    // [P1 2026-08-08] 损坏基线不静默重建：明确报错 exit 2，暴露真实回归而非掩盖
    if (baselineRes.corrupt) {
        console.error(`[deadcode] ❌ 基线文件损坏（${BASELINE_FILE}）: ${baselineRes.error}`);
        console.error("  请检查/修复基线文件后再运行；勿让损坏基线被静默覆盖。");
        process.exit(USAGE_ERROR);
    }
    if (baselineRes.missing || !baselineRes.baseline) {
        console.log("[deadcode] 无基线文件，首次运行写入基线。");
        writeBaseline(counts);
        console.log("  " + BASELINE_TRACKED.map(([k, label]) => `${label}: ${counts[k]}`).join("，"));
        process.exit(0);
    }
    const baseline = baselineRes.baseline;

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
        console.error("\n[deadcode] ❌ 回退：以下项超过基线——");
        for (const [key, label] of BASELINE_TRACKED) {
            const base = baseline[key] ?? 0;
            const curr = counts[key] ?? 0;
            if (curr > base) {
                console.error(`   ${label}: ${base} → ${curr}（+${curr - base}）`);
            }
        }
        console.log("\n  ── knip 当前报告（将被纳入基线）:");
        showKnipDetails(knipJson);
        if (jscpdCounts.clones) {
            console.log("\n  ── jscpd 重复代码（将被纳入基线）:");
            showJscpdDetails(jscpdJson);
        }
        console.error("\n  清理新增死代码后重试，或确认无碍后更新基线：");
        console.error("  cd frontend && node ../scripts/check-deadcode-baseline.mjs --update");
        process.exit(REGRESSION);
    }

    console.log("\n[deadcode] ✅ 未回退（各项 <= 基线）。");
    process.exit(0);
}

main();
