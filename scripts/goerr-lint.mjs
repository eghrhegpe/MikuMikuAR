#!/usr/bin/env node
// scripts/goerr-lint.mjs — ADR-117 § Phase 3 防回归静态检查
//
// 防止 ADR-117 的 Go 端错误 i18n 迁移成果回退。两个硬规则：
//
//   1. Go 侧（internal/app/）：禁止 `fmt.Errorf("...汉字...")` 直接返回中文字符串。
//      用户可见错误须改用 mikumikuar/internal/i18nerr.New(code, msg, params)，
//      经 @@GOERR@@ 信封跨桥，由前端 translateGoError 按语言翻译。
//      注：纯英文 fmt.Errorf（如 proxy.go 的 SSRF 守卫）不在检查范围；
//           util.WrapErrorf 的中文格式串亦不在范围（保留 errors.Is 语义，属后续提案）。
//
//   2. 前端侧（frontend/src/）：禁止 `X instanceof Error ? X.message : String(X)`
//      反模式（即把错误原文不经翻译直接展示给用户）。须改用
//      core/i18n/goerr.translateGoError。
//      该三元表达式是 Phase 2 统一迁移走的展示习语，新增者即回归。
//      排除：core/i18n/goerr.ts（翻译器自身须读 .message）、*.test.ts。
//
// 用法：
//   node ../scripts/goerr-lint.mjs          # warning 模式：列违例但 exit 0
//   node ../scripts/goerr-lint.mjs --strict # 任何违例即 exit 1（CI 阻塞）
//
// 路径以仓库根目录为基准（__dirname 上溯到仓库根），与调用时 cwd 无关，
// 可在前端 job 或后端 job 中调用。

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, relative } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const strict = process.argv.includes('--strict');

// CJK 汉字（不含 kana，足以覆盖本项目 Go 端错误的中文化文本）
const HAN = /\p{Script=Han}/u;
// 前端反模式：`X instanceof Error ? X.message : String(X)`
const FRONTEND_ANTIPATTERN = /instanceof\s+Error\s*\?\s*[^;{}\n]*?\.message\s*:\s*String\(/;

const violations = [];

function walk(dir, onFile) {
    let entries;
    try {
        entries = readdirSync(dir);
    } catch {
        return;
    }
    for (const name of entries) {
        const full = resolve(dir, name);
        let st;
        try {
            st = statSync(full);
        } catch {
            continue;
        }
        if (st.isDirectory()) {
            if (name === 'node_modules' || name === 'dist' || name.startsWith('.')) continue;
            walk(full, onFile);
        } else if (st.isFile()) {
            onFile(full);
        }
    }
}

function toRel(file) {
    return relative(ROOT, file).replace(/\\/g, '/');
}

// ── 规则 1：Go 侧（internal/app/*.go） ──────────────────────────
function checkGoFile(file) {
    if (!file.endsWith('.go')) return;
    const rel = toRel(file);
    const text = readFileSync(file, 'utf8');
    text.split('\n').forEach((line, i) => {
        if (/fmt\.Errorf\(/.test(line) && HAN.test(line)) {
            violations.push({
                side: 'Go',
                file: rel,
                line: i + 1,
                text: line.trim(),
                hint: '用 i18nerr.New(code, msg, params) 替代 fmt.Errorf 中文',
            });
        }
    });
}

// ── 规则 2：前端侧（frontend/src，排除翻译器与测试） ────────────
function isFrontendSource(file) {
    if (!file.endsWith('.ts') && !file.endsWith('.tsx')) return false;
    if (file.endsWith('.test.ts') || file.endsWith('.test.tsx')) return false;
    const rel = toRel(file);
    if (!rel.startsWith('frontend/src/')) return false;
    if (rel.endsWith('core/i18n/goerr.ts')) return false; // 翻译器自身
    return true;
}

function checkFrontendFile(file) {
    const rel = toRel(file);
    const text = readFileSync(file, 'utf8');
    text.split('\n').forEach((line, i) => {
        if (FRONTEND_ANTIPATTERN.test(line)) {
            violations.push({
                side: 'FE',
                file: rel,
                line: i + 1,
                text: line.trim(),
                hint: '用 translateGoError(err) 替代 `instanceof Error ? err.message : String(err)`',
            });
        }
    });
}

// 执行扫描
walk(resolve(ROOT, 'internal', 'app'), checkGoFile);
walk(resolve(ROOT, 'frontend', 'src'), (file) => {
    if (isFrontendSource(file)) checkFrontendFile(file);
});

// ── 报告 ──────────────────────────────────────────────────────
if (violations.length === 0) {
    console.log('✅ goerr-lint: 无 ADR-117 回归（internal/app 无 CJK fmt.Errorf；frontend 无 .message 直显反模式）');
    process.exit(0);
}

console.log(`\n⚠️  goerr-lint: 发现 ${violations.length} 处 ADR-117 潜在回归\n`);
for (const v of violations) {
    console.log(`  [${v.side}] ${v.file}:${v.line}`);
    console.log(`       ${v.text}`);
    console.log(`       ↳ ${v.hint}\n`);
}
console.log('说明：用户可见错误须经 i18nerr.New + translateGoError 走多语言翻译链路。');
console.log('      Go 端保留 errors.Is 语义的 util.WrapErrorf 中文格式串不在本检查范围。');
process.exit(strict ? 1 : 0);
