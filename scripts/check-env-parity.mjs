#!/usr/bin/env node
// scripts/check-env-parity.mjs — env-state-schema ↔ Go EnvState 字段级 parity 检查
//
// 背景（buglog 2026-08-02-mirror-geometry-persist-gap）：TS envState 新增字段后，
// Go 端 EnvState 结构体若未同步，SetEnvState 的 JSON round-trip 会静默丢弃该字段，
// config.json 持久化断链，重启回默认值。mirror 几何 4 字段、groundEmissive* 4 字段
// 均为此类漂移。ADR-137 §3.4 承诺的字段 parity 契约测试未真正落地，本脚本补上。
//
// 数据源：
//   - frontend/src/core/env-state-schema.ts  —— TS 权威源（127+ 字段，含 group）
//   - frontend/bindings/.../models.ts        —— Go EnvState 结构体的 Wails 生成镜像
//
// 用法：
//   node scripts/check-env-parity.mjs           # 双向 diff，默认 warning 模式
//   node scripts/check-env-parity.mjs --strict  # 任何未豁免漂移即 exit 1（CI 阻塞）

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

const { strict, json } = parseArgs(process.argv.slice(2), {
    bools: ['strict', 'json'],
});

// ======== 豁免表：已确认的合理差异（双向） ========
// schema-only（TS 有、Go 无）：仅当"明确不随 config 持久化"才豁免；
//   默认这些字段应补进 Go（否则重启丢参数），见 buglog 2026-08-02-mirror-geometry-persist-gap。
// bind-only（Go 有、TS 无）：多为 Go 结构体残留的死字段（schema 已删/从未有）。
const EXEMPT_SCHEMA_ONLY = new Map();
const EXEMPT_BIND_ONLY = new Map([
    ['underwaterFogDensity', 'ADR-216 死字段：schema 已删（FOGMODE_EXP2→colorCurves 替换后无消费），Go 结构体残留未清理'],
    ['underwaterFogMultiplier', 'ADR-216 死字段：schema 已删（无消费），Go 结构体残留未清理'],
    ['waterFogDensity', '死字段：schema 从未有此字段，Go 结构体残留，frontend 零消费'],
]);

// ======== 解析 env-state-schema.ts 顶层字段 ========
function parseSchemaKeys(text) {
    const start = text.indexOf('export const ENV_STATE_SCHEMA = {');
    if (start === -1) {
        console.error('❌ 未找到 ENV_STATE_SCHEMA 定义');
        process.exit(1);
    }
    const keys = new Set();
    for (const line of text.slice(start).split('\n')) {
        // 顶层字段：恰好 4 空格缩进 + `name: {`
        const m = line.match(/^ {4}(\w+)\s*:\s*\{/);
        if (m) {
            keys.add(m[1]);
        }
    }
    return keys;
}

// ======== 解析 bindings models.ts 的 EnvState 接口字段 ========
function parseBindingsEnvStateKeys(text) {
    const m = text.match(/export interface EnvState \{([\s\S]*?)\n\}/);
    if (!m) {
        console.error('❌ 未找到 bindings 中 EnvState 接口定义');
        process.exit(1);
    }
    const keys = new Set();
    for (const line of m[1].split('\n')) {
        // bindings 中可空字段形如 `"mirrorPosition"?: number[] | null;`（带 ?），
        // 正则须兼容 `"name":` 与 `"name"?:` 两种形式，否则可空字段被误报为漂移。
        const f = line.match(/^\s*"([A-Za-z0-9]+)"\??\s*:/);
        if (f) {
            keys.add(f[1]);
        }
    }
    return keys;
}

// ======== 主流程 ========
if (!existsSync(SCHEMA_FILE) || !existsSync(BINDINGS_FILE)) {
    console.error('❌ 数据源文件缺失（schema / bindings models.ts）');
    process.exit(1);
}

const schemaKeys = parseSchemaKeys(readFileSync(SCHEMA_FILE, 'utf8'));
const bindKeys = parseBindingsEnvStateKeys(readFileSync(BINDINGS_FILE, 'utf8'));

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
