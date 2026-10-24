import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
    addLinesFromDiff,
    parseRenameStatus,
    detectRenames,
    getChangedLines,
    statementPctForChangedLines,
    buildSuggestBlock,
} from "../check-diff-coverage.mjs";

/** spawn 真实 CLI（P2-1 git 失败路径需真实 git 交互，无法纯函数注入）。 */
const ROOT = path.resolve(new URL("../..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
const CLI = path.join(ROOT, "scripts", "check-diff-coverage.mjs");
function runCli(args) {
    try {
        const stdout = execFileSync(process.execPath, [CLI, ...args], {
            cwd: ROOT,
            encoding: "utf8",
            timeout: 30000,
        });
        return { code: 0, stdout, stderr: "" };
    } catch (e) {
        return {
            code: e.status ?? 1,
            stdout: e.stdout?.toString() ?? "",
            stderr: e.stderr?.toString() ?? "",
        };
    }
}

test("addLinesFromDiff 仅取 + 行号，上下文行递增，- 行不递增", () => {
    const diff = [
        "diff --git a/old b/new",
        "--- a/old",
        "+++ b/new",
        "@@ -10,3 +10,3 @@",
        " context",
        "-removed",
        "+added",
        " context2",
    ].join("\n");
    const out = new Set();
    addLinesFromDiff(out, diff);
    // 行号推演：@@ +10 → 10；" context"( )→11；"-removed" 不递增(11)；
    // "+added"(+)→add(11)→12；" context2"( )→13
    assert.deepEqual([...out], [11]);
});

test("addLinesFromDiff 多 hunk 各自独立起始", () => {
    const diff = [
        "@@ -1,1 +1,1 @@",
        "+only",
        "@@ -50,1 +50,1 @@",
        "+fifty",
    ].join("\n");
    const out = new Set();
    addLinesFromDiff(out, diff);
    assert.deepEqual(
        [...out].sort((a, b) => a - b),
        [1, 50],
    );
});

test("parseRenameStatus 解析 R 行（相似度/来源/目标），忽略 M/A/D", () => {
    const out = [
        "R098\tfrontend/src/outfit/outfit.ts\tfrontend/src/scene/manager/outfit.ts",
        "R100\ta/b.ts\ta/c.ts",
        "M\tx/y.ts",
        "A\tz/new.ts",
    ].join("\n");
    const map = parseRenameStatus(out);
    assert.equal(map.size, 2);
    assert.deepEqual(map.get("frontend/src/scene/manager/outfit.ts"), {
        from: "frontend/src/outfit/outfit.ts",
        sim: 98,
    });
    assert.deepEqual(map.get("a/c.ts"), { from: "a/b.ts", sim: 100 });
    assert.equal(map.has("x/y.ts"), false);
    assert.equal(map.has("z/new.ts"), false);
});

test("statementPctForChangedLines 变更行上无语句 → 100", () => {
    const entry = {
        s: { 0: 0 },
        statementMap: { 0: { start: { line: 5 }, end: { line: 5 } } },
    };
    // 变更行 7 上无 statement
    assert.equal(statementPctForChangedLines(entry, new Set([7])), 100);
});

test("statementPctForChangedLines 纯改名（仅 import 行无语句）→ 100", () => {
    // 模拟 outfit-overlay 纯改名：改动行 20/30/40/50 均为 import 改写，无 statement
    const entry = {
        s: { 0: 1, 1: 1 },
        statementMap: {
            0: { start: { line: 10 }, end: { line: 12 } },
            1: { start: { line: 60 }, end: { line: 65 } },
        },
    };
    assert.equal(statementPctForChangedLines(entry, new Set([20, 30, 40, 50])), 100);
});

test("statementPctForChangedLines 部分覆盖按比例", () => {
    const entry = {
        s: { 0: 1, 1: 0 },
        statementMap: {
            0: { start: { line: 5 }, end: { line: 5 } },
            1: { start: { line: 10 }, end: { line: 10 } },
        },
    };
    assert.equal(statementPctForChangedLines(entry, new Set([5, 10])), 50);
    assert.equal(statementPctForChangedLines(entry, new Set([5])), 100);
    assert.equal(statementPctForChangedLines(entry, new Set([10])), 0);
});

test("statementPctForChangedLines 空 statementMap → 100", () => {
    assert.equal(statementPctForChangedLines({ s: {}, statementMap: {} }, new Set([1])), 100);
});

test("buildSuggestBlock 输出可追加进 commit message 的 Markdown 区块", () => {
    const block = buildSuggestBlock(
        [
            { file: "frontend/src/x.ts", pct: 25.0 },
            { file: "frontend/src/y.ts", pct: 8.3 },
        ],
        60,
    );
    const lines = block.split("\n");
    // 首行即钩子 stripBlock 的 BLOCK_START 标记，保证幂等剥离可对位
    assert.equal(lines[0], "## 覆盖率建议（非阻断）");
    assert.match(block, /低于 60%/);
    assert.match(block, /`frontend\/src\/x.ts` — 25\.0%/);
    assert.match(block, /`frontend\/src\/y.ts` — 8\.3%/);
    assert.match(block, /不阻塞提交\/合并/);
    // 不含阈值以外的多余信息，保持 message 整洁
    assert.doesNotMatch(block, /\[X\]/);
});

test("buildSuggestBlock 单文件亦生成合法区块", () => {
    const block = buildSuggestBlock([{ file: "frontend/src/z.ts", pct: 0 }], 60);
    assert.match(block, /`frontend\/src\/z.ts` — 0\.0%/);
});

// ── P2-1: git 失败 fail-closed（阻断 exit 2 / suggest exit 0）───────────

/** 造一个空 coverage 文件（绕过缺 coverage 的 exit 2 前置），返回路径。 */
function makeEmptyCoverage() {
    const p = path.join(os.tmpdir(), `cov-empty-${process.pid}-${Date.now()}.json`);
    fs.writeFileSync(p, "{}", "utf8");
    return p;
}

test("git 失败（base ref 不存在）→ 阻断模式 exit 2，不假绿通过", () => {
    const cov = makeEmptyCoverage();
    try {
        // 用一个不存在的 base ref 让 git diff 失败 → gitHardFail → exit 2
        const r = runCli(["--base", "__NO_SUCH_REF_9x__", "--coverage", cov]);
        assert.equal(r.code, 2, `exit=${r.code} stderr=${r.stderr} stdout=${r.stdout}`);
        assert.match(r.stderr + r.stdout, /git 命令执行失败/);
        // 不再出现假绿的「通过」结论
        assert.doesNotMatch(r.stdout, /全部达标|无改动源码需要检查.*通过/);
    } finally {
        fs.rmSync(cov, { force: true });
    }
});

test("git 失败（base ref 不存在）→ suggest 模式 exit 0 跳过", () => {
    const cov = makeEmptyCoverage();
    try {
        const r = runCli(["--suggest", "--base", "__NO_SUCH_REF_9x__", "--coverage", cov]);
        assert.equal(r.code, 0, `exit=${r.code} stderr=${r.stderr} stdout=${r.stdout}`);
        assert.match(r.stderr + r.stdout, /git 命令执行失败/);
    } finally {
        fs.rmSync(cov, { force: true });
    }
});

// ── [round-76c #8] git 夹具强化：detectRenames / getChangedLines blob-diff / --files / 未知 flag ──
// 说明：生产 git() 固定于 REPO_ROOT（check-diff-coverage.mjs:38-39 / 69-75），tmpdir 里 git init 的
// 一次性仓库无法被生产函数触达；故用「提交对象（只读 git 命令）+ tmp coverage 文件 + --files 显式清单」
// 覆盖同口径行为，全程不向主仓 git 写任何东西。

function makeCoverageFile(key, entry) {
    const p = path.join(os.tmpdir(), `cov-files-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}.json`);
    fs.writeFileSync(p, JSON.stringify({ total: { s: {} }, [key]: entry }, null, 2), "utf8");
    return p;
}

function tmpCov(name) {
    const p = path.join(os.tmpdir(), `cov-empty-${process.pid}-${Date.now()}-${name}.json`);
    fs.writeFileSync(p, "{}", "utf8");
    return p;
}

// matchCoverageKey 的绝对路径 key（前缀可伪造，endsWith("/"+rel) 命中即可）
const TEST_SRC_REL = "frontend/src/zzz/test-src.ts";
const TEST_SRC_KEY = "C:/fake/repo/" + TEST_SRC_REL;
const COV_PARTIAL = {
    statementMap: {
        0: { start: { line: 1 }, end: { line: 1 } },
        1: { start: { line: 2 }, end: { line: 2 } },
        2: { start: { line: 3 }, end: { line: 3 } },
    },
    s: { 0: 1, 1: 0, 2: 0 },
};
const COV_FULL = { ...COV_PARTIAL, s: { 0: 1, 1: 1, 2: 1 } };

test("--files 显式清单：全文件检查语义（语句全覆盖 → 100%，exit 0）", () => {
    const cov = makeCoverageFile(TEST_SRC_KEY, COV_FULL);
    try {
        const r = runCli(["--files", TEST_SRC_REL, "--base", "HEAD", "--head", "HEAD", "--coverage", cov, "--threshold", "60"]);
        assert.equal(r.code, 0, `exit=${r.code} stdout=${r.stdout} stderr=${r.stderr}`);
        assert.match(r.stdout, /全部达标/);
        assert.match(r.stdout, /100\.0/);
        assert.doesNotMatch(r.stdout, /\[X\]/);
    } finally {
        fs.rmSync(cov, { force: true });
    }
});

test("--files 显式清单：部分覆盖 1/3 → 33.3% 阻断 exit 1", () => {
    const cov = makeCoverageFile(TEST_SRC_KEY, COV_PARTIAL);
    try {
        const r = runCli(["--files", TEST_SRC_REL, "--base", "HEAD", "--head", "HEAD", "--coverage", cov, "--threshold", "60"]);
        assert.equal(r.code, 1, `exit=${r.code} stdout=${r.stdout} stderr=${r.stderr}`);
        assert.match(r.stdout, /33\.3/);
        assert.match(r.stdout, /\[X\]/);
        assert.match(r.stdout + r.stderr, /低于 60%/);
    } finally {
        fs.rmSync(cov, { force: true });
    }
});

test("--files + --suggest：有缺口仍 exit 0 并输出建议区块", () => {
    const cov = makeCoverageFile(TEST_SRC_KEY, COV_PARTIAL);
    try {
        const r = runCli(["--suggest", "--files", TEST_SRC_REL, "--base", "HEAD", "--head", "HEAD", "--coverage", cov, "--threshold", "60"]);
        assert.equal(r.code, 0, `exit=${r.code} stdout=${r.stdout} stderr=${r.stderr}`);
        assert.match(r.stdout, /## 覆盖率建议（非阻断）/);
        assert.match(r.stdout, /33\.3%/);
    } finally {
        fs.rmSync(cov, { force: true });
    }
});

test("--files 无覆盖率条目 → 计 0% 缺口（阻断 exit 1）", () => {
    const cov = tmpCov("no-cov");
    try {
        const r = runCli(["--files", "frontend/src/zzz/no-cov.ts", "--base", "HEAD", "--head", "HEAD", "--coverage", cov]);
        assert.equal(r.code, 1, `exit=${r.code} stdout=${r.stdout} stderr=${r.stderr}`);
        assert.match(r.stdout, /no-cov\.ts/);
        assert.match(r.stdout, /0\.0/);
        assert.match(r.stdout, /\[X\]/);
    } finally {
        fs.rmSync(cov, { force: true });
    }
});

test("--files isSourceFile 过滤：.test.ts / __tests__ / index.ts / wailsjs / menus / 非src 全排除 → exit 0", () => {
    const cov = tmpCov("is-src");
    const filtered = [
        "frontend/src/zzz/a.test.ts", // .test.ts
        "frontend/src/__tests__/b.ts", // __tests__/
        "frontend/src/zzz/index.ts", // /index.ts
        "frontend/src/wailsjs/generated/c.ts", // wailsjs/
        "frontend/src/menus/d.ts", // /menus/
        "backend/e.ts", // 无 src/
    ].join(",");
    try {
        const r = runCli(["--files", filtered, "--base", "HEAD", "--head", "HEAD", "--coverage", cov]);
        assert.equal(r.code, 0, `exit=${r.code} stdout=${r.stdout} stderr=${r.stderr}`);
        assert.match(r.stdout, /无改动源码需要检查/);
    } finally {
        fs.rmSync(cov, { force: true });
    }
});

test("--uncommitted 参数：CLI 接受（阻断 exit ∈ {0,1}，suggest 恒 0；只冒烟契约不断言仓库实际改动）", () => {
    const cov = tmpCov("uncommitted");
    try {
        const r = runCli(["--uncommitted", "--base", "HEAD", "--head", "HEAD", "--coverage", cov]);
        assert.ok(r.code === 0 || r.code === 1, `exit=${r.code} stdout=${r.stdout} stderr=${r.stderr}`);
        const s = runCli(["--suggest", "--uncommitted", "--base", "HEAD", "--head", "HEAD", "--coverage", cov]);
        assert.equal(s.code, 0, `suggest exit=${s.code} stdout=${s.stdout} stderr=${s.stderr}`);
    } finally {
        fs.rmSync(cov, { force: true });
    }
});

test("未知 flag → exit 1（末尾未知参数不被静默吞掉）", () => {
    const r = runCli(["--definitely-bogus"]);
    assert.equal(r.code, 1, `exit=${r.code} stdout=${r.stdout} stderr=${r.stderr}`);
    assert.match(r.stderr + r.stdout, /未知参数/);
});

test("--help → exit 0 并打印用法", () => {
    const r = runCli(["--help"]);
    assert.equal(r.code, 0, `exit=${r.code} stdout=${r.stdout} stderr=${r.stderr}`);
    assert.match(r.stdout, /用法/);
});

// ── detectRenames / getChangedLines：生产函数直测（git 命令只读，不写主仓任何状态）──

test("detectRenames: HEAD...HEAD → 空 Map（无 rename，两兜底路径均成功）", () => {
    const m = detectRenames("HEAD", "HEAD", false);
    assert.equal(m.size, 0);
});

test("detectRenames: base ref 不存在 → fail-closed 返回空 Map 且不抛错", () => {
    const m = detectRenames("__NO_SUCH_REF_9x__", "HEAD", false);
    assert.equal(m.size, 0);
});

test("getChangedLines 非暂存 rename blob-diff 成功路径：两提交对象两点 diff 出真实新文件行号", () => {
    // HEAD:README.md ↔ HEAD:check-diff-coverage.mjs 两个提交 blob 几乎无公共行，
    // + 行集合应覆盖新文件（.mjs）的绝大多数行号（只读 git show/diff）
    const qRel = "scripts/check-diff-coverage.mjs";
    const qText = execFileSync("git", ["show", `HEAD:${qRel}`], { encoding: "utf8" });
    const qLines = qText.endsWith("\n") ? qText.split("\n").length - 1 : qText.split("\n").length;
    const out = getChangedLines(qRel, "HEAD", "HEAD", false, "README.md", false);
    assert.ok(out.size >= Math.floor(qLines * 0.2), `blob-diff 应取到新文件大部分行，实际 out.size=${out.size}（新文件 ${qLines} 行）`);
    for (const l of out) {
        assert.ok(l >= 1 && l <= qLines, `行号应落在新文件行范围内: ${l}`);
    }
});

test("getChangedLines 暂存 rename blob-diff fail-closed（:190-199）：旧 blob 不可解析 → 空集且不抛错", () => {
    // HEAD:zzz/old.ts 不存在 → git() 返回 null → gitHardFail=true 早退空集；
    // CLI 阻断模式靠 gitHardFail 退 2 兜底（既有 P2-1 用例已锁该 exit 2 链路）
    const out = getChangedLines("zzz/new.ts", "HEAD", "HEAD", false, "zzz/old.ts", true);
    assert.equal(out.size, 0);
});

test("--threshold 非法值 → exit 1（round79 P1：原实现 NaN 恒 false 全通过）", () => {
    for (const bad of ["abc", "0", "150", "-5"]) {
        const r = runCli(["--threshold", bad]);
        assert.equal(r.code, 1, `--threshold ${bad} 应 exit 1，实际 ${r.code}: ${r.stdout} ${r.stderr}`);
        assert.match(r.stdout + r.stderr, /--threshold/);
    }
});

test("--threshold 合法边界 100 → 不因校验早退", () => {
    // 阈值校验通过后继续走正常流程（此处 coverage 缺失/其他原因退非 0 也属正常），
    // 关键断言：stderr/stdout 不再报「--threshold 必须是」，即校验未误伤合法输入。
    const r = runCli(["--threshold", "100", "--files", "scripts/nonexistent-xyz.test.ts"]);
    assert.doesNotMatch(r.stdout + r.stderr, /--threshold 必须是/);
});
