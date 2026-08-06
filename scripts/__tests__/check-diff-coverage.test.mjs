import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
    addLinesFromDiff,
    parseRenameStatus,
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
