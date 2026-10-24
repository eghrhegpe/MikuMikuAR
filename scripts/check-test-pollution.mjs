/**
 * check-test-pollution.mjs — 静态护栏：检测 vi.mock 污染隐患
 *
 * 背景（ADR-262）：isolate:false + per-file vi.mock + 模块级可变状态三条件合取时
 * 触发"先到先得绑定锁定"污染。setup-wails.ts 已为 idb 等模块提供全局 mock，
 * 测试文件内的重复 vi.mock 是冗余代码——一旦工厂形状飘移即静默污染。
 *
 * 设计意图：把 ADR-262 的「三条件合取才污染」判据静态化——在 review 之前就用脚本
 * 拦下与 setup 全局 mock 重复或工厂漂移的 vi.mock，让串味在提交期暴露而非随机复现。
 *
 * 检测内容：
 *   1. 文件级 vi.mock 与 setup 全局 mock 指向同一模块（冗余，warn）
 *   2. 文件级 vi.mock 与 setup 全局 mock 指向同一模块但工厂不同（形状漂移，warn）
 *
 * 零依赖（node:fs / node:path / node:url / node:child_process）
 *
 * 用法：
 *   git diff --name-only origin/main HEAD -- "*.test.ts" | node scripts/check-test-pollution.mjs
 *   node scripts/check-test-pollution.mjs <file1> <file2>...
 *   node scripts/check-test-pollution.mjs --json [files...]
 *
 * 退出码：0（warn 不阻断，防倒退提示性质）
 */

import { readFileSync } from 'node:fs';
import { dirname, join, normalize, relative } from 'node:path';
import { ROOT } from './_lib/scan-files.mjs';

const JSON_OUT = process.argv.includes('--json');
const _FILES = process.argv.slice(2).filter((a) => !a.startsWith('--'));

// ── 路径常量 ──
const ROOT_DIR = ROOT;
const FRONTEND_DIR = join(ROOT_DIR, 'frontend');
const SRC_DIR = join(FRONTEND_DIR, 'src');
// [fix P2 round79] 加 env 钩子便于契约测试注入 fixture setup（生产默认不变）
const SETUP_FILE = process.env.TEST_POLLUTION_SETUP || join(SRC_DIR, '__tests__', 'setup-wails.ts');

// ── 收集待检文件（argv 或 stdin 管道） ──
const argvFiles = _FILES.filter((a) => a.endsWith('.test.ts'));
const stdinFiles = [];
if (argvFiles.length === 0 && !process.stdin.isTTY) {
    try {
        const buf = readFileSync(0, 'utf8');
        stdinFiles.push(...buf.split('\n').map((s) => s.trim()).filter((s) => s.endsWith('.test.ts')));
    } catch {
        // 无 stdin
    }
}
const targetFiles = [...new Set([...argvFiles, ...stdinFiles])].map((f) =>
    f.replace(/\\/g, '/')
);

if (targetFiles.length === 0) {
    if (!JSON_OUT) process.stderr.write('[check-test-pollution] 无测试文件输入，通过\n');
    process.exit(0);
}

// ── 解析 setup-wails.ts 的全局 vi.mock 注册 ──
// 格式：vi.mock('@/core/backend/idb', async () => { ... });
// 只取顶层 vi.mock（setup 文件中不嵌套 describe）
const GLOBAL_MOCK_RE = /vi\.mock\s*\(\s*['"]([^'"]+)['"]/g;
const setupMocks = new Map(); // resolvedPath → { path: 原始路径, line: 行号, factory: 工厂片段 }

if (!readFileSync(SETUP_FILE, 'utf8').includes('vi.mock')) {
    if (!JSON_OUT) process.stderr.write('[check-test-pollution] setup-wails.ts 无全局 mock 注册，跳过\n');
    process.exit(0);
}

const setupContent = readFileSync(SETUP_FILE, 'utf8');
const setupLines = setupContent.split('\n');
let m;
const globalRegex = new RegExp(GLOBAL_MOCK_RE);
/** [fix P2 round79] idx 是否落在 // 行注释内（L122 的 `vi.mock('.../idb') 覆盖——` 是说明文字，非真注册） */
function isCommentLine(text, idx) {
    const ls = text.lastIndexOf('\n', idx - 1) + 1;
    return text.slice(ls, idx).trim().startsWith('//');
}
while ((m = globalRegex.exec(setupContent)) !== null) {
    if (isCommentLine(setupContent, m.index)) continue; // 注释里的 vi.mock 说明文字不登记
    const rawPath = m[1];
    const lineNum = setupContent.substring(0, m.index).split('\n').length;
    // 提取工厂片段（mock 调用到下一个 vi.mock 或文件末尾）
    // [fix P2 round79] 原用 globalRegex.exec() 找下界会推进同一全局正则的 lastIndex，
    // 每轮外层迭代被吞掉一个 match（setup 里偶数位 vi.mock 整条漏登记，工厂边界错位）。
    // 实测 setup-wails.ts 4 个 vi.mock 只登记 2 个。改：每次迭代用独立正则实例只做一次边界查找，
    // 且跳过注释行。
    const boundaryRe = new RegExp(GLOBAL_MOCK_RE);
    let nextMatch = null;
    while ((nextMatch = boundaryRe.exec(setupContent.slice(m.index + 1))) !== null) {
        if (!isCommentLine(setupContent, m.index + 1 + nextMatch.index)) break;
    }
    const nextMockIdx = nextMatch ? m.index + 1 + nextMatch.index : setupContent.length;
    const factorySnippet = setupContent.substring(m.index, Math.min(nextMockIdx, m.index + 300));
    const resolvedPath = resolveModulePath(rawPath, SRC_DIR);
    setupMocks.set(resolvedPath, {
        rawPath,
        line: lineNum,
        factory: factorySnippet.substring(0, 120).replace(/\s+/g, ' ').trim(),
    });
}

// ── 解析器：将模块路径解析为文件路径 ──
// 处理：绝对别名 @/xxx → src/xxx、相对路径 ./xxx → 相对于 test 文件目录
function resolveModulePath(rawPath, testFileDir) {
    if (rawPath.startsWith('@/')) {
        return join(SRC_DIR, rawPath.slice(2));
    }
    if (rawPath.startsWith('@babylonjs/') || rawPath.startsWith('@wailsio/')) {
        return rawPath; // 外部包，不解析
    }
    if (rawPath.startsWith('./') || rawPath.startsWith('../')) {
        return join(testFileDir, rawPath);
    }
    return rawPath;
}

// ── 逐文件扫描 ──
const reports = [];
for (const f of targetFiles) {
    let absPath;
    if (f.startsWith('/')) {
        absPath = f;
    } else if (f.startsWith('frontend/')) {
        absPath = join(ROOT_DIR, f);
    } else if (f.startsWith('src/')) {
        absPath = join(FRONTEND_DIR, f);
    } else {
        absPath = join(FRONTEND_DIR, 'src', f);
    }
    // 归一化反斜杠
    absPath = normalize(absPath);

    let content;
    try {
        content = readFileSync(absPath, 'utf8');
    } catch {
        if (!JSON_OUT) process.stderr.write(`  ? ${relative(ROOT_DIR, absPath)}  （文件不存在，跳过）\n`);
        continue;
    }

    const testDir = dirname(absPath);
    const fileMocks = [];
    const fileMockRe = /vi\.mock\s*\(\s*['"]([^'"]+)['"]\s*,\s*([^)]+)\)/g;
    let fm;
    while ((fm = fileMockRe.exec(content)) !== null) {
        const rawPath = fm[1];
        const factoryExpr = fm[2].trim().substring(0, 80);
        const resolvedPath = resolveModulePath(rawPath, testDir);
        fileMocks.push({ rawPath, resolvedPath, factory: factoryExpr });
    }

    for (const fileMock of fileMocks) {
        const globalMock = setupMocks.get(fileMock.resolvedPath);
        if (!globalMock) continue;

        // 同一模块被全局 mock + 文件级 mock 双重注册
        const isRedundant = factoriesMatch(fileMock.factory, globalMock.factory);
        reports.push({
            file: relative(ROOT_DIR, absPath),
            module: fileMock.rawPath,
            resolvedPath: fileMock.resolvedPath,
            globalLine: globalMock.line,
            type: isRedundant ? 'redundant' : 'shape-drift',
            fileFactory: fileMock.factory,
            globalFactory: globalMock.factory,
        });
    }
}

// ── 工厂比对（简化：比较首行 token 是否一致） ──
function factoriesMatch(fileF, globalF) {
    const nf = normalizeFactory(fileF);
    const ng = normalizeFactory(globalF);
    return nf === ng;
}
function normalizeFactory(s) {
    // 提取关键标识符：makeIdbMock / sceneMockSuperset / stateMockSuperset 等
    const m = s.match(/(\w+Mock\w*|\w+Superset\w*)/);
    return m ? m[1] : s.replace(/\s+/g, '');
}

// ── 输出 ──
if (JSON_OUT) {
    const ok = reports.length === 0;
    console.log(JSON.stringify({
        _summary: { files: targetFiles.length, warns: reports.length, pass: ok },
        setupMocks: Object.fromEntries(setupMocks.entries()),
        reports: reports.map((r) => ({
            file: r.file,
            module: r.module,
            type: r.type,
            globalLine: r.globalLine,
        })),
    }, null, 2));
} else if (reports.length) {
    process.stderr.write('\n[check-test-pollution] ⚠️ 发现 vi.mock 污染隐患（warn 不阻断）：\n');
    for (const r of reports) {
        const severity = r.type === 'shape-drift' ? '🟠 形状漂移' : '🟡 冗余';
        process.stderr.write(
            `  ${severity} ${r.file} vi.mock('${r.module}')\n` +
            `    → setup-wails.ts:${r.globalLine} 已全局 mock 同一模块\n` +
            `    → 文件级工厂：${r.fileFactory}\n` +
            `    → 全局工厂：  ${r.globalFactory}\n` +
            (r.type === 'shape-drift'
                ? `    → 风险：工厂形状不一致，per-file mock 覆盖全局 mock 后断言可能通过但行为偏差\n`
                : `    → 建议：删除文件级 vi.mock，依赖全局 setup mock（ADR-262）\n`)
        );
    }
    process.stderr.write('\n');
} else {
    process.stderr.write('[check-test-pollution] 无 vi.mock 污染隐患，通过\n');
}

process.exit(0);