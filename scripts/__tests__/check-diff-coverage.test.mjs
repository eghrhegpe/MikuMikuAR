import { test } from "node:test";
import assert from "node:assert/strict";
import {
    addLinesFromDiff,
    parseRenameStatus,
    statementPctForChangedLines,
} from "../check-diff-coverage.mjs";

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
