#!/usr/bin/env node
// scripts/check-boolean-naming.mjs — ADR-212 §6.1 / ADR-214 §二: boolean 字段 *Enabled 后缀纪律
//
// 校验 env-state-schema.ts 中所有 type: 'boolean' 的字段名以 Enabled 或 Active 结尾。
// 裸名词作 boolean（如 particleSplash、debugClouds）已由 ADR-212 治理，
// 此脚本防止新字段再次违反同一纪律。
//
// 用法：
//   node scripts/check-boolean-naming.mjs           # 默认 warning 模式
//   node scripts/check-boolean-naming.mjs --strict  # 任何违规即 exit 1（CI 阻塞）

import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from './_lib/parse-args.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCHEMA_FILE = resolve(__dirname, '..', 'frontend', 'src', 'core', 'env-state-schema.ts');

const { strict, json } = parseArgs(process.argv.slice(2), { bools: ['strict', 'json'] });

const text = readFileSync(SCHEMA_FILE, 'utf8');

// 找到 ENV_STATE_SCHEMA 对象范围
const schemaStart = text.indexOf('export const ENV_STATE_SCHEMA = {');
if (schemaStart === -1) {
    console.error('❌ 未找到 ENV_STATE_SCHEMA 定义');
    process.exit(1);
}
const schemaBody = text.slice(schemaStart);
const asConstIdx = schemaBody.indexOf('} as const;');
if (asConstIdx === -1) {
    console.error('❌ 未找到 ENV_STATE_SCHEMA 结束标记');
    process.exit(1);
}
const schemaText = schemaBody.slice(0, asConstIdx + 1);

// 确定基准缩进
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

// 扫描字段：找到 type: 'boolean' 的字段，检查命名是否以 Enabled/Active 结尾
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
    // 收集块
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
