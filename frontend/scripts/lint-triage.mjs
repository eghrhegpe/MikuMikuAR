import { ESLint } from 'eslint';

const eslint = new ESLint({ cwd: process.cwd() });
const results = await eslint.lintFiles(['src']);

const byRule = {};
const rows = [];
let total = 0;
for (const r of results) {
    for (const m of r.messages) {
        if (!m.ruleId) continue;
        total++;
        byRule[m.ruleId] = (byRule[m.ruleId] || 0) + 1;
        rows.push({
            rule: m.ruleId,
            sev: m.severity,
            file: r.filePath.replace(/\\/g, '/').replace(/.*\/frontend\/src\//, 'src/'),
            line: m.line,
            msg: m.message,
        });
    }
}

console.log('=== TOTAL:', total, '===');
console.log('=== BY RULE ===');
for (const [rule, c] of Object.entries(byRule).sort((a, b) => b[1] - a[1])) {
    console.log(String(c).padStart(4), rule);
}

// dump full rows to a clean json for later slicing
import { writeFileSync } from 'fs';
writeFileSync('lint-rows.json', JSON.stringify(rows, null, 0));
console.log('=== wrote lint-rows.json:', rows.length, 'rows ===');
