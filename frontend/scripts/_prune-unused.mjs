// 一次性脚本：按 ESLint no-unused-vars 报告删除“单行单说明符”的未使用 import 行。
// 仅处理形如 `Name,` / `Name as Alias,` 独占一行的干净说明符；其余留待人工。
import fs from 'fs';

const r = JSON.parse(fs.readFileSync('./eslint-stats.json', 'utf8'));
const specRe = /^[A-Za-z0-9_]+( as [A-Za-z0-9_]+)?,?$/;
let removed = 0;
const touched = [];

for (const f of r) {
    const uv = f.messages.filter(
        (m) =>
            m.ruleId === '@typescript-eslint/no-unused-vars' &&
            !m.message.includes('assigned a value')
    );
    if (!uv.length) continue;
    const raw = fs.readFileSync(f.filePath, 'utf8');
    const eol = raw.includes('\r\n') ? '\r\n' : '\n';
    const lines = raw.split(/\r?\n/);
    const targets = [...new Set(uv.map((m) => m.line))].filter((ln) =>
        specRe.test((lines[ln - 1] || '').trim())
    );
    if (!targets.length) continue;
    targets.sort((a, b) => b - a);
    for (const ln of targets) {
        lines.splice(ln - 1, 1);
        removed++;
    }
    fs.writeFileSync(f.filePath, lines.join(eol));
    touched.push(f.filePath.replace(/.*frontend./, '') + ' (-' + targets.length + ')');
}

console.log('removed lines=' + removed + '  files touched=' + touched.length);
for (const t of touched) console.log('  ' + t);
