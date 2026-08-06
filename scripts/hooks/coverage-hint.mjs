#!/usr/bin/env node
// scripts/hooks/coverage-hint.mjs
//
// diff-coverage 门禁 · prepare-commit-msg 辅助脚本（非阻断）。
// 由 .githooks/prepare-commit-msg 薄壳调用，把"变更行覆盖率低于阈值"的文件
// 作为建议追加进 commit message body，随 commit 进入 PR，供 review 参考。
//
// 设计要点（镜像 ysm-model-manager 知识卡漂移范式）：
//   - 永远 exit 0（非阻断）；任何异常仅静默跳过，绝不阻塞提交。
//   - 绝不触发 vitest（避开 genie-safe-delete 的 clean 崩溃），只读已有 coverage-final.json。
//   - 幂等：追加前先剥离旧区块，--amend 重跑不会重复。
//   - merge / squash 提交跳过（message 固定、diff 巨大，无追加价值）。
//   - 逃生阀：MM_SKIP_COVERAGE_HINT=1 git commit
//
// 纯函数（stripBlock / buildSuggestBlock 来自 check-diff-coverage.mjs）导出供契约测试复用，
// 主流程用 import.meta 守卫。

import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { buildSuggestBlock } from "../check-diff-coverage.mjs";

export const BLOCK_START = "## 覆盖率建议（非阻断）";
export const BLOCK_END = "<!-- coverage-hint-end -->";

/** 幂等剥离旧区块（按首尾标记，字符串定位，避免正则转义坑）。
 *  同时吞掉 BLOCK 前的一个换行（分隔空行）与 BLOCK 后紧跟的换行，保持 message 整洁。 */
export function stripBlock(msg, start = BLOCK_START, end = BLOCK_END) {
    const i = msg.indexOf(start);
    if (i < 0) return msg;
    const j = msg.indexOf(end, i);
    if (j < 0) return msg;
    let pre = msg.slice(0, i);
    if (pre.endsWith("\n")) pre = pre.slice(0, -1);
    let post = msg.slice(j + end.length);
    if (post.startsWith("\n")) post = post.slice(1);
    return pre + post;
}

function getRoot() {
    try {
        return execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim();
    } catch {
        return "";
    }
}

function main() {
    const msgFile = process.argv[2];
    const source = process.argv[3] || "";

    if (!msgFile) return;
    if (process.env.MM_SKIP_COVERAGE_HINT === "1") return;
    if (source === "merge" || source === "squash") return; // 跳过固定 message 的大 diff

    const ROOT = getRoot();
    if (!ROOT) return;

    // 默认读 frontend/coverage；MM_COVERAGE_PATH 可覆盖（调试/CI 复用特定产物）。
    const coveragePath =
        process.env.MM_COVERAGE_PATH && process.env.MM_COVERAGE_PATH.trim()
            ? path.resolve(ROOT, process.env.MM_COVERAGE_PATH)
            : path.join(ROOT, "frontend", "coverage", "coverage-final.json");

    // 调 gate 脚本的 --suggest 模式：有缺口时输出 Markdown 区块到 stdout，永远 exit 0。
    // --staged 仅检查本次暂存区（= 本次 commit 的文件），避免 --base origin/main
    // 在本地领先时把历史未推送改动也纳入噪音（2026-08-06 实证：改 scripts/*.mjs 却建议补测 lighting-follow.ts）。
    // 用 process.execPath（当前 node 的 Windows 绝对路径），避免 Git Bash msys 路径
    // 在 Windows 版 node 的 execFileSync 中无法被 CreateProcess 解析的陷阱。
    let out = "";
    try {
        out = execFileSync(
            process.execPath,
            [
                path.join(ROOT, "scripts", "check-diff-coverage.mjs"),
                "--suggest",
                "--staged",
                "--coverage",
                coveragePath,
            ],
            { encoding: "utf8" },
        );
    } catch {
        return; // 非阻断：任何失败（含脚本异常）都静默跳过
    }

    out = out.trim();
    if (!out) return; // 无缺口或无覆盖率数据，不追加，保持 message 整洁
    if (!out.startsWith(BLOCK_START)) return; // 非建议区块（如"无改动源码需要检查"提示）不追加，防污染 message

    let msg;
    try {
        msg = fs.readFileSync(msgFile, "utf8");
    } catch {
        return;
    }

    const stripped = stripBlock(msg);
    const block = "\n" + out + "\n" + BLOCK_END + "\n";
    const next = stripped.trimEnd() + block;
    try {
        fs.writeFileSync(msgFile, next);
    } catch {
        /* 非阻断：写失败不影响提交 */
    }

    // A：echo 到 stderr，让 AI 在 commit 终端即时可见（git commit 输出只显示 subject，
    // 不显示 body；prepare-commit-msg 的 stderr 会随 commit 显示）。
    process.stderr.write("\n" + out + "\n");
}

// 仅当作为入口直接执行时才跑主流程（被测试 import 时不触发）
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
    main();
}
