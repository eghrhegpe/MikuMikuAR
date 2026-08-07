#!/usr/bin/env node
/**
 * check-env-parity.mjs — EnvState 字段 parity 检查（TS schema ↔ Go bindings）
 *
 * 设计意图：EnvState 字段 parity 检查（TS schema ↔ Go bindings）
 *
 * 依赖：node:fs / node:path / node:url / 本地模块
 *
 * 用法：
 *   node scripts/check-env-parity.mjs                 # 默认行为
 *   node scripts/check-env-parity.mjs --strict # 启用 strict
 *
 * 退出码：1 / failedParity && strict ? 1 : 0 / failed && strict ? 1 : 0（含失败码）
 */
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from './_lib/parse-args.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCHEMA_FILE = resolve(__dirname, '..', 'frontend', 'src', 'core', 'env-state-schema.ts');
const BINDINGS_FILE = resolve(
    __dirname,
    '..',
    'frontend',
    'bindings',
    'mikumikuar',
    'internal',
    'app',
    'models.ts'
);

const { strict, json, help, unknown } = parseArgs(process.argv.slice(2), {
    bools: ['strict', 'json'],
});
// [P1 2026-08-08] --help 用 fs.readFileSync 但 fs 未绑定（仅具名导入 readFileSync）→ 必崩；
// check-schema-groups 同类已修（:27），此处遗漏
if (help) {
    const _src = readFileSync(process.argv[1], 'utf-8');
    const _s = _src.indexOf('/**');
    const _e = _src.indexOf('*/', _s);
    console.log(_src.slice(_s, _e + 2).replace(/^ \* ?/gm, '').trim());
    process.exit(0);
}
if (unknown && unknown.length) {
    console.error(`❌ 未知参数: ${unknown.join(', ')}（--help 查看用法）`);
    process.exit(1);
}

const EXEMPT_SCHEMA_ONLY = new Map();
const EXEMPT_BIND_ONLY = new Map([
    ['underwaterFogDensity', 'ADR-216 死字段：schema 已删（FOGMODE_EXP2→colorCurves 替换后无消费），Go 结构体残留未清理'],
    ['underwaterFogMultiplier', 'ADR-216 死字段：schema 已删（无消费），Go 结构体残留未清理'],
    ['waterFogDensity', '死字段：schema 从未有此字段，Go 结构体残留，frontend 零消费'],
]);

function parseSchemaKeys(text) {
    const start = text.indexOf('export const ENV_STATE_SCHEMA = {');
    if (start === -1) {
        console.error('❌ 未找到 ENV_STATE_SCHEMA 定义');
        process.exit(1);
    }
    const keys = new Set();
    const lines = text.slice(start).split('\n');
    // [P2 2026-08-08] 动态 baseIndent：旧硬编码 `^ {4}` 在 Prettier 改 2 空格/tab 时
    // 全部字段静默漏检（配合双空集守卫会 fail，但此修复让 2/4 空格都正确解析）。
    let baseIndent = null;
    for (const line of lines) {
        const m = line.match(/^(\s+)\w+\s*:\s*\{/);
        if (m) {
            baseIndent = m[1].length;
            break;
        }
    }
    if (baseIndent === null) return keys; // 无字段匹配 → 空集（由双空集守卫拦截）
    const prefix = ' '.repeat(baseIndent);
    for (const line of lines) {
        const m = line.match(/^(\s+)(\w+)\s*:\s*\{/);
        if (m && m[1].length === baseIndent) {
            keys.add(m[2]);
        }
    }
    return keys;
}

function parseBindingsEnvStateKeys(text) {
    const m = text.match(/export interface EnvState \{([\s\S]*?)\n\}/);
    if (!m) {
        console.error('❌ 未找到 bindings 中 EnvState 接口定义');
        process.exit(1);
    }
    const keys = new Set();
    for (const line of m[1].split('\n')) {
        const f = line.match(/^\s*"([A-Za-z0-9]+)"\??\s*:/);
        if (f) {
            keys.add(f[1]);
        }
    }
    return keys;
}

if (!existsSync(SCHEMA_FILE) || !existsSync(BINDINGS_FILE)) {
    console.error('❌ 数据源文件缺失（schema / bindings models.ts）');
    process.exit(1);
}

const schemaKeys = parseSchemaKeys(readFileSync(SCHEMA_FILE, 'utf8'));
const bindKeys = parseBindingsEnvStateKeys(readFileSync(BINDINGS_FILE, 'utf8'));

// [P2 2026-08-08] 双空集静默假绿守卫：schema 解析硬编码 `^ {4}` 缩进，若 Prettier 改 2 空格
// 则 schemaKeys 为空；若 bindings 侧解析同时失效 → 双空集 → failedParity=false →
// 「✅ parity 一致」假绿。解析结果为空即报格式变更，不静默放行。
if (schemaKeys.size === 0 || bindKeys.size === 0) {
    console.error(
        `❌ 字段解析结果为空（schema=${schemaKeys.size} / bindings=${bindKeys.size}），疑似格式变更，无法比较 parity`
    );
    process.exit(1);
}

const schemaOnly = [...schemaKeys].filter((k) => !bindKeys.has(k));
const bindOnly = [...bindKeys].filter((k) => !schemaKeys.has(k));

const schemaOnlyExempt = schemaOnly.filter((k) => EXEMPT_SCHEMA_ONLY.has(k));
const schemaOnlyReal = schemaOnly.filter((k) => !EXEMPT_SCHEMA_ONLY.has(k));
const bindOnlyExempt = bindOnly.filter((k) => EXEMPT_BIND_ONLY.has(k));
const bindOnlyReal = bindOnly.filter((k) => !EXEMPT_BIND_ONLY.has(k));

const failedParity = schemaOnlyReal.length > 0 || bindOnlyReal.length > 0;
if (json) {
    console.log(JSON.stringify({
        schemaOnlyReal,
        bindOnlyReal,
        schemaOnlyExempt,
        bindOnlyExempt,
        failed: failedParity,
    }, null, 2));
    process.exit(failedParity && strict ? 1 : 0);
}

console.log('EnvState 字段 parity 检查 — env-state-schema.ts ↔ Go bindings models.ts');
console.log(`  权威源 schema: ${schemaKeys.size} 字段 | Go bindings: ${bindKeys.size} 字段`);
console.log(
    `  豁免（已确认合理差异）: schema-only ${schemaOnlyExempt.length} 个 | bind-only ${bindOnlyExempt.length} 个`
);

let failed = false;

if (schemaOnlyExempt.length > 0) {
    console.log(`\n  ⚪ 豁免 schema-only（TS 有、Go 无，已确认不随 config 持久化）:`);
    for (const k of schemaOnlyExempt) {
        console.log(`     - ${k}: ${EXEMPT_SCHEMA_ONLY.get(k)}`);
    }
}
if (bindOnlyExempt.length > 0) {
    console.log(`\n  ⚪ 豁免 bind-only（Go 有、TS 无，死字段残留）:`);
    for (const k of bindOnlyExempt) {
        console.log(`     - ${k}: ${EXEMPT_BIND_ONLY.get(k)}`);
    }
}

if (schemaOnlyReal.length > 0) {
    failed = true;
    console.log(`\n❌ ${schemaOnlyReal.length} 个 schema-only 漂移（TS envState 有、Go EnvState 无）:`);
    for (const k of schemaOnlyReal) {
        console.log(`   - ${k}`);
    }
    console.log('   后果：SetEnvState JSON round-trip 静默丢弃该字段，config.json 不持久化，重启回默认值。');
    console.log('   修复：internal/app/app.go EnvState 结构体补同名字段（含 json tag）。');
}

if (bindOnlyReal.length > 0) {
    failed = true;
    console.log(`\n❌ ${bindOnlyReal.length} 个 bind-only 漂移（Go EnvState 有、TS envState 无）:`);
    for (const k of bindOnlyReal) {
        console.log(`   - ${k}`);
    }
    console.log('   后果：Go 结构体残留 schema 不存在的字段，属于死状态或 TS 漏注册。');
    console.log('   处理：确认无消费后从 Go 结构体删除，或补入 env-state-schema.ts 并登记豁免理由。');
}

if (!failed) {
    console.log('\n✅ 字段级 parity 一致（未豁免漂移为 0）。');
}
if (failed && !strict) {
    console.log('\n  (warning mode — 非阻塞。加 --strict 后 CI 阻断。)');
}
process.exit(failed && strict ? 1 : 0);
