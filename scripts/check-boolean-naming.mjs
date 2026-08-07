#!/usr/bin/env node
/**
 * check-boolean-naming.mjs — Boolean 字段命名规范检查（env-state-schema.ts）
 *
 * 设计意图：Boolean 字段命名规范检查（env-state-schema.ts）
 *
 * 依赖：node:fs / node:path / node:url / 本地模块
 *
 * 用法：
 *   node scripts/check-boolean-naming.mjs                 # 默认行为
 *   node scripts/check-boolean-naming.mjs --strict # 启用 strict
 *
 * 退出码：1 / violations.length > 0 && strict ? 1 : 0 / 0（含失败码）
 */
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from './_lib/parse-args.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCHEMA_FILE = resolve(__dirname, '..', 'frontend', 'src', 'core', 'env-state-schema.ts');

const { strict, json, help, unknown } = parseArgs(process.argv.slice(2), { bools: ['strict', 'json'] });
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

const text = readFileSync(SCHEMA_FILE, 'utf8');

const schemaStart = text.indexOf('export const ENV_STATE_SCHEMA = {');
if (schemaStart === -1) {
    console.error('❌ 未找到 ENV_STATE_SCHEMA 定义');
    process.exit(1);
}
const schemaBody = text.slice(schemaStart);
// [doc:adr-243] schema 收尾为 `} as const satisfies Record<string, _AnyFieldDef>;`，
// 兼容匹配 `} as const`（indexOf 前缀命中），截取到 `}` 为止
const asConstIdx = schemaBody.indexOf('} as const');
if (asConstIdx === -1) {
    console.error('❌ 未找到 ENV_STATE_SCHEMA 结束标记');
    process.exit(1);
}
const schemaText = schemaBody.slice(0, asConstIdx + 1);

const lines = schemaText.split('\n');
let baseIndent = 0;
for (const line of lines) {
    const m = line.match(/^(\s+)\w+\s*:\s*\{/);
    if (m) {
        baseIndent = m[1].length;
        break;
    }
}
const prefix = ' '.repeat(baseIndent);

const violations = [];
let totalBoolFields = 0;
let i = 0;
while (i < lines.length) {
    const line = lines[i];
    if (!line.startsWith(prefix) || line.startsWith(prefix + ' ') || line.startsWith(prefix + '}')) {
        i++;
        continue;
    }
    const m = line.match(/^(\s+)(\w+)\s*:\s*\{/);
    if (!m) {
        i++;
        continue;
    }
    const fieldName = m[2];
    if (fieldName === 'ENV_STATE_SCHEMA') {
        i++;
        continue;
    }
    let block = '';
    let depth = 0;
    let done = false;
    let j = i;
    for (; j < lines.length && !done; j++) {
        const l = lines[j];
        block += l + '\n';
        for (let c = 0; c < l.length; c++) {
            if (l[c] === '{') depth++;
            else if (l[c] === '}') depth--;
            if (depth === 0 && l[c] === '}') {
                const closeIndent = l.search(/\S/);
                if (closeIndent === baseIndent) {
                    done = true;
                    break;
                }
            }
        }
    }

    const isBoolean = /type\s*:\s*'boolean'/.test(block);
    if (isBoolean) {
        totalBoolFields++;
        const suffixOk = /^(Enabled|Active)\b/.test(fieldName) ||
            /(Enabled|Active)$/.test(fieldName);
        if (!suffixOk) {
            violations.push(fieldName);
        }
    }
    i = j;
}

// [P2 2026-08-08] 字段数自校验：schema 格式漂移（缩进/括号形态变化）时括号扫描器
// 静默漏检 → totalBoolFields=0 → violations=0 → 「✅ 通过」假绿。字段数为 0 即报解析异常。
// （解析器与 check-schema-groups 复制粘贴重复的根治=抽 _lib 共享，另行排期）
if (totalBoolFields === 0) {
    console.error('❌ 未解析到任何 boolean 字段，疑似 env-state-schema.ts 格式变更，无法执行命名检查');
    process.exit(1);
}

if (json) {
    console.log(JSON.stringify({ totalBoolFields, violations }, null, 2));
    process.exit(violations.length > 0 && strict ? 1 : 0);
}

console.log(`Boolean 字段命名检查 — env-state-schema.ts`);
console.log(`  boolean 字段总数: ${totalBoolFields}`);

if (violations.length > 0) {
    console.log(`\n❌ ${violations.length} 个 boolean 字段命名违规（缺 *Enabled / *Active 后缀）:`);
    for (const name of violations) {
        console.log(`  · ${name}`);
    }
    console.log('\n  修复方式：在字段名后加 Enabled/Active 后缀，');
    console.log('  并在 env-bridge.ts _migrators 中加旧键兼容。');
    console.log('  （已在 ADR-212 §6.1 中明确约定为强制纪律）');
    if (strict) {
        process.exit(1);
    }
    console.log('\n  (warning mode — 非阻塞。加 --strict 后 CI 阻断。)');
} else {
    console.log('\n✅ 所有 boolean 字段命名合规。');
}
process.exit(0);
