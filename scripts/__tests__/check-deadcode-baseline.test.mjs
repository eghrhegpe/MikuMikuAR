/**
 * check-deadcode-baseline.test.mjs — knip duplicates 三形兼容夹具（round76c #2）
 *
 * 背景：knip JSON 的 issues[].duplicates 元素形态随版本漂移过两轮：
 *   ① 最旧形：{name, line} 对象
 *   ② 08-08 P2 修复目标形：[name, line] 二元组
 *   ③ 2026-10-25 实证新形：符号对象数组 [{name,line,col,pos}, {...}]（符号对）
 * check-deadcode-baseline.mjs:185-205（showKnipDetails）对三形做了两级回退兼容；
 * 若某形解析回退失效，报告行打印 `dup [object Object] :[object Object]`，人读信息全丢。
 *
 * 测试方式（照仓库 __tests__ 子进程夹具模式）：check-deadcode-baseline.mjs 整体是
 * CLI main（L328 直接调 main()，无导出），解析函数无法独立 import → 把真实脚本 +
 * 其唯一本地依赖 to-posix.mjs 拷入 mkdtemp 沙箱（REPO_ROOT 按脚本自身位置解析），
 * 配「假 knip 入口（打印注入的三形 JSON）+ 假 jscpd 入口（写空报告）+ 全零基线」，
 * 跑子进程走 REGRESSION 路径（duplicateExports=1 > 基线 0），断言 showKnipDetails
 * 输出的 dup 行 = 正确 符号名:行号，且无 [object Object]。
 * 三形假 knip JSON 各自写成临时文件，经 env FAKE_KNIP_JSON 注入（每形一份）。
 *
 * 同时锁门禁计数口径：每形 1 个 duplicates 外层元素 → 重复导出 +1（L81 按外层计）。
 *
 * 运行：node --test scripts/__tests__/check-deadcode-baseline.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const ROOT = path.resolve(new URL("../..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
const SRC_SCRIPT = path.join(ROOT, "scripts", "check-deadcode-baseline.mjs");
const SRC_TOPOSIX = path.join(ROOT, "scripts", "_lib", "to-posix.mjs");

/** 造沙箱：真实脚本副本 + 假 knip/jscpd 工具链 + 全零基线；写三形 JSON 到 tmp，返回其路径。 */
function buildSandbox(tmp, knipJson) {
  // 脚本 REPO_ROOT = resolve(脚本所在目录, "..") → 沙箱内布局必须是 scripts/…
  const scriptsDir = path.join(tmp, "scripts");
  fs.mkdirSync(path.join(scriptsDir, "_lib"), { recursive: true });
  fs.copyFileSync(SRC_SCRIPT, path.join(scriptsDir, "check-deadcode-baseline.mjs"));
  fs.copyFileSync(SRC_TOPOSIX, path.join(scriptsDir, "_lib", "to-posix.mjs"));

  // 全零基线（12 项 schema 全键）→ 假 knip 的 1 个 duplicate 必判 REGRESSION →
  // showKnipDetails 的 dup 行才会被打印（回归路径 L313-314 才调 showKnipDetails）
  fs.mkdirSync(path.join(tmp, "docs"), { recursive: true });
  fs.writeFileSync(
    path.join(tmp, "docs", ".deadcode-baseline.json"),
    JSON.stringify({
      unusedExports: 0, unusedTypes: 0, duplicateExports: 0, unusedDevDeps: 0,
      unlistedDeps: 0, deadFiles: 0, unusedDeps: 0, nsExports: 0,
      nsTypes: 0, enumMembers: 0, clones: 0, duplicatedLines: 0,
      updatedAt: "2026-01-01",
    })
  );

  // 三形假 knip JSON → 临时文件（经 env 注入假 knip 入口）
  const knipJsonPath = path.join(tmp, "fake-knip.json");
  fs.writeFileSync(knipJsonPath, JSON.stringify(knipJson), "utf8");

  const knipBin = path.join(tmp, "frontend", "node_modules", "knip", "bin");
  fs.mkdirSync(knipBin, { recursive: true });
  fs.writeFileSync(
    path.join(knipBin, "knip.js"),
    [
      '"use strict";',
      "const fs = require('node:fs');",
      "process.stdout.write(fs.readFileSync(process.env.FAKE_KNIP_JSON, 'utf8'));",
      "",
    ].join("\n")
  );

  // 假 jscpd：写空报告（clones=0 → 不干扰 knip 侧断言）
  const jscpdBin = path.join(tmp, "frontend", "node_modules", "jscpd");
  fs.mkdirSync(jscpdBin, { recursive: true });
  fs.writeFileSync(
    path.join(jscpdBin, "run-jscpd.js"),
    [
      '"use strict";',
      "const fs = require('node:fs');",
      "const path = require('node:path');",
      "const dir = path.resolve(process.cwd(), 'report');",
      "fs.mkdirSync(dir, { recursive: true });",
      "fs.writeFileSync(path.join(dir, 'jscpd-report.json'), JSON.stringify(",
      "  { statistics: { total: { clones: 0, duplicatedLines: 0 }, clones: [] } }",
      "));",
      "",
    ].join("\n")
  );
  return knipJsonPath;
}

/** 跑沙箱内脚本（无参 = 检查模式），返回 { code, stdout, stderr }。 */
function runBaseline(sandbox, knipJsonPath) {
  const script = path.join(sandbox, "scripts", "check-deadcode-baseline.mjs");
  try {
    const stdout = execFileSync(process.execPath, [script], {
      cwd: sandbox,
      encoding: "utf8",
      timeout: 30000,
      env: { ...process.env, FAKE_KNIP_JSON: knipJsonPath },
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

const FORMS = [
  {
    name: "新形：符号对象数组 [[{name,line,col,pos}, …]]（knip 2026-10-25 实证形态）",
    duplicates: [[
      { name: "alpha", line: 42, col: 0, pos: 0 },
      { name: "beta", line: 55, col: 0, pos: 0 },
    ]],
    // 新形展示取符号对首元素（L188-193 设计）：alpha:42
    expect: { name: "alpha", line: 42 },
  },
  {
    name: "旧形：[name, line] 二元组（08-08 P2 修复目标形态）",
    duplicates: [["gamma", 7]],
    expect: { name: "gamma", line: 7 },
  },
  {
    name: "最旧形：{name, line} 对象",
    duplicates: [{ name: "delta", line: 99 }],
    expect: { name: "delta", line: 99 },
  },
];

for (const form of FORMS) {
  test(`knip duplicates ${form.name} → dup 行打印 符号名:行号，无 [object Object]`, () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "deadcode-baseline-"));
    try {
      const knipJsonPath = buildSandbox(tmp, {
        issues: [{ file: "src/scene/fake-dup.ts", duplicates: form.duplicates }],
      });
      const r = runBaseline(tmp, knipJsonPath);
      // 1 个 duplicates 外层元素 > 基线 0 → REGRESSION（exit 1），回归路径才打印 dup 详情
      assert.equal(r.code, 1, `exit=${r.code} stderr=${r.stderr} stdout=${r.stdout}`);
      // 文件归属行在位（toPosix 输出）
      assert.match(r.stdout, /src\/scene\/fake-dup\.ts:/);
      // 核心断言：dup 行 = 正确 符号名:行号（三形同一口径）
      assert.match(r.stdout, new RegExp(`dup\\s+${form.expect.name}\\s+:${form.expect.line}`));
      // 回归：任何形解析失效都会打 [object Object]（2026-10-25 格式漂移实证）
      assert.doesNotMatch(r.stdout, /\[object Object\]/, "dup 行出现 [object Object]——解析回退失效");
      // 门禁计数口径：duplicates 按外层元素计（L81），1 元素 → 重复导出 0 → 1
      assert.match(r.stderr, /重复导出: 0 → 1/);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
}
