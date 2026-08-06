#!/usr/bin/env node
/**
 * codemod.mjs — @file AST 感知的代码批量重构工具（基于 ts-morph）
 *
 * 用法:
 *   node scripts/codemod.mjs <命令> [参数...]
 *
 * 命令:
 *   rename-function <旧名> <新名>
 *      重命名导出的函数/类/常量，自动更新所有引用
 *      完成后自动 grep 旧名，标记可能遗漏的字符串引用
 *
 *   move-function <函数名> <目标文件>
 *      将导出的函数定义移动到另一个文件，自动清理原 export 并追加。
 *      自动迁移函数体内引用的 import 到目标文件；自动清理源文件孤立 import。
 *
 *   add-param <函数名> <参数签名> [默认值]
 *      为函数定义添加参数，并为所有无默认值的调用方补 undefined。
 *      完成后显示受影响的调用方数量。
 *
 *   help
 *      显示此帮助
 *
 * 示例:
 *   node scripts/codemod.mjs rename-function oldFoo newFoo
 *   node scripts/codemod.mjs move-function parseName src/core/utils.ts
 *   node scripts/codemod.mjs add-param buildTree 'opts: Options' '{}'
 *
 * 安全须知:
 *   - 所有改动都是 in-place 的，运行前确保工作区已 `git commit`
 *   - 改完后必须跑 `npm run check && npm run test` 验证
 *   - 对结果有疑虑时，用 `git diff` 逐块审查
 * 设计意图：代码重构工具（批量修改源码）
 * 依赖：node:module / node:url / node:fs / node:path / 本地模块
 * 退出码：1 / 0（含失败码）
 * codemod.mjs — 代码重构工具（批量修改源码）
 */

import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import path from 'node:path';
import { toPosix } from './_lib/to-posix.mjs';
import { ROOT } from './_lib/scan-files.mjs';

// 测试钩子：CODEMOD_FRONTEND 指向 fixture 目录（真实运行不设该变量，不受影响）
const FRONTEND = process.env.CODEMOD_FRONTEND
  ? path.resolve(process.env.CODEMOD_FRONTEND)
  : path.join(ROOT, 'frontend');
// ts-morph 依赖始终从真实前端解析（fixture 无 node_modules）
const DEP_BASE = path.join(ROOT, 'frontend');
const require_ = createRequire(path.join(DEP_BASE, 'package.json'));
const { Project, SyntaxKind } = require_('ts-morph');
const TS_CONFIG = path.join(FRONTEND, 'tsconfig.json');
const FILESELF = fileURLToPath(import.meta.url);

if (!fs.existsSync(TS_CONFIG)) {
  console.error(`❌ 未找到 tsconfig: ${TS_CONFIG}`);
  console.error('请在项目根目录运行此脚本');
  process.exit(1);
}

const project = new Project({
  tsConfigFilePath: TS_CONFIG,
  skipAddingFilesFromTsConfig: false,
});

// ── helpers ────────────────────────────────────────────────────────────

/** 查找导出的函数/类/变量声明 */
function findExportDecl(name) {
  for (const sf of project.getSourceFiles()) {
    // 函数声明
    for (const fn of sf.getFunctions()) {
      if (fn.isExported() && fn.getName() === name) {
        return { sourceFile: sf, node: fn, kind: 'function' };
      }
    }
    // 类
    const cls = sf.getClass(name);
    if (cls && cls.isExported()) {
      return { sourceFile: sf, node: cls, kind: 'class' };
    }
    // 变量声明（const/let）
    for (const vd of sf.getVariableDeclarations()) {
      if (vd.getName() === name) {
        const parent = vd.getParent();
        if (parent && parent.getKind() === SyntaxKind.VariableDeclarationList) {
          const vStmt = parent.getParent();
          if (vStmt && vStmt.getKind() === SyntaxKind.VariableStatement) {
            if (vStmt.isExported()) {
              return {
                sourceFile: sf,
                node: vd,
                kind: 'variable',
                // 整条 VariableStatement（含 const/export 关键字）随迁移带走
                variableStatement: vStmt,
                // 同语句声明符个数：>1 时移动会丢失兄弟声明符，须拒绝
                declarationCount: vStmt.getDeclarations().length,
              };
            }
          }
        }
      }
    }
  }
  return null;
}

/** 在 frontend/src 下 grep 字符串匹配（纯 Node.js，跨平台） */
function grepString(pattern) {
  const srcDir = path.join(FRONTEND, 'src');
  const results = [];
  const re = new RegExp(pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g');
  walkAndGrep(srcDir, results, re);
  return results;
}

function walkAndGrep(dir, results, regex) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name !== 'node_modules' && e.name !== 'wailsjs' && !e.name.startsWith('__')) {
        walkAndGrep(full, results, regex);
      }
    } else if (e.isFile() && /\.(ts|tsx)$/.test(e.name)) {
      try {
        const content = fs.readFileSync(full, 'utf8');
        if (regex.test(content)) {
          const lines = content.split('\n');
          for (let i = 0; i < lines.length; i++) {
            if (regex.test(lines[i])) {
              const rel = toPosix(path.relative(FRONTEND, full));
              results.push(`${rel}:${i + 1}: ${lines[i].trim().slice(0, 120)}`);
            }
          }
        }
      } catch { /* skip */ }
    }
  }
}

/** 收集 AST 节点下所有 Identifier 名称 */
function collectIdentifiers(node, out) {
  if (!node) return;
  if (node.getKind && node.getKind() === SyntaxKind.Identifier) {
    out.add(node.getText());
  }
  if (node.forEachChild) {
    node.forEachChild((c) => collectIdentifiers(c, out));
  }
}

/** 从源文件 import 声明中筛选出函数体内用到的那些 */
function resolveFunctionImports(funcNode, srcSf) {
  const used = new Set();
  collectIdentifiers(funcNode, used);

  const result = []; // { declaration, default, named[], namespace }
  for (const imp of srcSf.getImportDeclarations()) {
    const mod = imp.getModuleSpecifierValue();
    const defaultName = imp.getDefaultImport()?.getText();
    const namedBindings = imp.getNamedImports();
    const namespaceName = imp.getNamespaceImport()?.getText();

    const matchedNamed = namedBindings.filter((ni) => used.has(ni.getName()));
    const matchedDefault = defaultName && used.has(defaultName);
    const matchedNamespace = namespaceName && used.has(namespaceName);

    if (!matchedDefault && matchedNamed.length === 0 && !matchedNamespace) continue;

    result.push({
      declaration: imp,
      moduleSpecifier: mod,
      default: matchedDefault ? defaultName : null,
      named: matchedNamed.map((ni) => ({ node: ni, name: ni.getName() })),
      namespace: matchedNamespace ? namespaceName : null,
    });
  }
  return result;
}

/** 判断声明/引用节点是否属于 import 绑定（会随 import 迁移，不算本地符号） */
function isImportBoundDecl(d) {
  if (!d) return false;
  const k = d.getKind();
  if (
    k === SyntaxKind.ImportClause ||
    k === SyntaxKind.ImportSpecifier ||
    k === SyntaxKind.NamespaceImport
  ) {
    return true;
  }
  return !!d.getFirstAncestorByKind(SyntaxKind.ImportDeclaration);
}

/** 收集函数体内对「源文件本地符号」（非 import、非函数内局部声明）的引用 */
function findLocalSymbolRefs(funcNode, srcSf) {
  const problems = [];
  const start = funcNode.getStart();
  const end = funcNode.getEnd();
  funcNode.forEachDescendant((node) => {
    if (node.getKind() !== SyntaxKind.Identifier) return;
    const symbol = node.getSymbol && node.getSymbol();
    if (!symbol) return;
    for (const d of symbol.getDeclarations()) {
      if (!d || !d.getSourceFile || d.getSourceFile() !== srcSf) continue;
      // 函数体内声明的局部变量/参数：无碍
      if (d.getStart() >= start && d.getEnd() <= end) continue;
      // import 绑定名：会随 import 一起迁移
      if (isImportBoundDecl(d)) continue;
      problems.push(
        `${d.getSourceFile().getFilePath()}:${d.getStartLineNumber()}:` +
          `${symbol.getName()} (${SyntaxKind[d.getKind()]})`
      );
    }
  });
  return [...new Set(problems)];
}

/** 源文件内除函数自身外对 funcName 的残留引用（re-export 不绑定本地名） */
function findResidualRefs(funcNode, srcSf) {
  const residual = [];
  const start = funcNode.getStart();
  const end = funcNode.getEnd();
  const refs = funcNode.findReferences();
  for (const ref of refs) {
    for (const occ of ref.getReferences()) {
      const node = occ.getNode();
      if (!node.getSourceFile || node.getSourceFile() !== srcSf) continue;
      // 声明自身 / 函数体内递归：跳过
      if (node.getStart() >= start && node.getEnd() <= end) continue;
      if (isImportBoundDecl(node)) continue;
      residual.push(
        `${node.getSourceFile().getFilePath()}:${node.getStartLineNumber()}`
      );
    }
  }
  return [...new Set(residual)];
}

/** 字符串化诊断消息（兼容 DiagnosticMessageChain） */
function diagText(d) {
  const t = d.getMessageText();
  return typeof t === 'string' ? t : t.getMessageText();
}

/** 收集全项目错误级诊断（category=1 Error），返回 Map<key, "文件: 消息"> */
function collectErrorDiags() {
  const errs = new Map();
  for (const sf of project.getSourceFiles()) {
    let diags;
    try {
      diags = sf.getPreEmitDiagnostics();
    } catch {
      continue; // 个别文件解析失败不阻断收集
    }
    for (const d of diags) {
      if (d.getCategory() !== 1) continue; // 1 = ts.DiagnosticCategory.Error
      const key = `${sf.getFilePath()}:${d.getStart()}:${diagText(d)}`;
      errs.set(key, `${sf.getFilePath()}: ${diagText(d)}`);
    }
  }
  return errs;
}

/** 操作前记录基线；有存量错误时提示（不阻断） */
function snapshotDiagBaseline(cmdName) {
  const baseline = collectErrorDiags();
  if (baseline.size > 0) {
    console.log(`⚠️  操作前项目已有 ${baseline.size} 组诊断错误（本次对比以此为基线，不阻断）`);
  }
  return baseline;
}

/** 改动后对比：新增错误（不在基线上的）则打印并 exit 1 */
function assertNoNewDiags(cmdName, baseline) {
  const after = collectErrorDiags();
  const added = [...after.keys()].filter((k) => !baseline.has(k));
  if (added.length > 0) {
    console.error(`❌ [${cmdName}] 改动后新增 ${added.length} 组诊断错误（类型未通过校验）：`);
    for (const k of added.slice(0, 20)) {
      console.error(`   ${after.get(k)}`);
    }
    if (added.length > 20) console.error(`   ...（共 ${added.length} 组）`);
    process.exit(1);
  }
  console.log(`✅ [${cmdName}] 改后诊断校验通过（未新增错误）`);
}

/** 向目标文件添加 import（自动去重） */
function ensureImport(destSf, moduleSpecifier, defaultName, namedNames) {
  const existing = destSf.getImportDeclarations().filter(
    (imp) => imp.getModuleSpecifierValue() === moduleSpecifier
  );

  if (existing.length === 0) {
    // 全新添加
    destSf.addImportDeclaration({
      moduleSpecifier,
      ...(defaultName ? { defaultImport: defaultName } : {}),
      ...(namedNames.length > 0 ? { namedImports: namedNames } : {}),
    });
    return;
  }

  // 合并到已有 import
  for (const ex of existing) {
    if (defaultName && !ex.getDefaultImport()) {
      ex.setDefaultImport(defaultName);
    }
    const existingNamed = new Set(ex.getNamedImports().map((n) => n.getName()));
    for (const n of namedNames) {
      if (!existingNamed.has(n)) {
        ex.addNamedImport(n);
      }
    }
  }
}

// ── rename-function ────────────────────────────────────────────────────

function cmdRenameFunction(oldName, newName) {
  const target = findExportDecl(oldName);
  if (!target) {
    console.error(`❌ 未找到导出符号 "${oldName}"`);
    process.exit(1);
  }

  console.log(`📍 定义位置: ${target.sourceFile.getFilePath()} （${target.kind}）`);
  const baseline = snapshotDiagBaseline('rename-function');
  target.node.rename(newName);
  project.saveSync();
  assertNoNewDiags('rename-function', baseline);

  console.log(`✅ 重命名完成: "${oldName}" → "${newName}"`);
  console.log('   ts-morph 已自动更新所有引用');

  // 搜索可能遗漏的字符串引用
  const hits = grepString(oldName);
  if (hits.length > 0) {
    // 过滤掉已经是新名的匹配
    const realHits = hits.filter(
      (h) => h.includes(oldName) && !h.includes(newName)
    );
    if (realHits.length > 0) {
      console.log(`⚠️  以下 ${realHits.length} 处可能包含未更新的字符串引用：`);
      for (const h of realHits.slice(0, 20)) {
        console.log(`   ${h}`);
      }
      if (realHits.length > 20) {
        console.log(`   ...（还有 ${realHits.length - 20} 处，完整搜索: grep -rn "${oldName}" frontend/src/）`);
      }
    } else {
      console.log('   grep 未检出旧名残留');
    }
  } else {
    console.log('   grep 未检出旧名残留');
  }
}

// ── move-function ──────────────────────────────────────────────────────

function cmdMoveFunction(funcName, destRelPath) {
  const target = findExportDecl(funcName);
  if (!target) {
    console.error(`❌ 未找到导出符号 "${funcName}"`);
    process.exit(1);
  }

  const absDest = path.resolve(FRONTEND, destRelPath);
  const destSf = project.getSourceFile(absDest);
  if (!destSf) {
    console.error(`❌ 目标文件不存在: ${absDest}`);
    process.exit(1);
  }

  const srcSf = target.sourceFile;
  const stmt = target.node;
  const srcPath = srcSf.getFilePath();

  // 目标与源相同：删除再追加只会产生顺序漂移，且 re-export 会自引用，直接拒绝
  if (destSf === srcSf) {
    console.error(`❌ 目标文件与源文件相同（${absDest}），move 无意义`);
    process.exit(1);
  }

  // 变量形态：整条 VariableStatement 一起迁移（保留 const/export 关键字），
  // 但同语句含多个声明符（如 `const a = 1, b = 2`）时移动会丢失兄弟声明符，须拒绝
  let text;
  let parentToRemove;
  if (target.kind === 'variable') {
    if (target.declarationCount > 1) {
      console.error(
        `❌ "${funcName}" 所在语句含 ${target.declarationCount} 个声明符（const a = 1, b = 2 形式），` +
          '移动会丢失兄弟声明符，请先手动拆分'
      );
      process.exit(1);
    }
    text = target.variableStatement.getFullText();
    parentToRemove = target.variableStatement;
  } else {
    text = stmt.getFullText();
    parentToRemove = stmt;
  }

  // 1. 解析函数体用到的 import
  const usedImports = resolveFunctionImports(stmt, srcSf);
  console.log(`📦 检测到 ${usedImports.length} 组 import 被函数引用`);

  // 1.5 迁移前守卫：函数体引用源文件本地符号 / 源文件残留引用，re-export 无法兜底
  const localRefs = findLocalSymbolRefs(stmt, srcSf);
  if (localRefs.length > 0) {
    console.error(`❌ "${funcName}" 函数体引用了源文件本地符号，无法随 import 迁移：`);
    for (const r of localRefs.slice(0, 20)) {
      console.error(`   ${r}`);
    }
    if (localRefs.length > 20) console.error(`   ...（共 ${localRefs.length} 处）`);
    process.exit(1);
  }
  const residualRefs = findResidualRefs(stmt, srcSf);
  if (residualRefs.length > 0) {
    console.error(`❌ 源文件仍有对 "${funcName}" 的引用（re-export 不绑定本地名）：`);
    for (const r of residualRefs.slice(0, 20)) {
      console.error(`   ${r}`);
    }
    if (residualRefs.length > 20) console.error(`   ...（共 ${residualRefs.length} 处）`);
    process.exit(1);
  }

  // 2. 从源文件移除函数
  const baseline = snapshotDiagBaseline('move-function');
  parentToRemove.remove();

  // 3. 清理源文件的孤立 import
  //    收集源文件剩余语句中仍用的标识符
  const remainingNames = new Set();
  for (const topStmt of srcSf.getStatements()) {
    if (!topStmt.wasRemoved && !topStmt.wasRemoved()) {
      collectIdentifiers(topStmt, remainingNames);
    }
  }

  let removedCount = 0;
  for (const ui of usedImports) {
    const imp = ui.declaration;
    const defaultName = imp.getDefaultImport()?.getText();
    const namedBindings = imp.getNamedImports();

    // 检查是否有 default import 仍被使用
    const defaultStillUsed = defaultName && remainingNames.has(defaultName);
    // 检查 named imports 哪些仍被使用
    const stillUsedNamed = namedBindings.filter((ni) =>
      remainingNames.has(ni.getName())
    );

    if (namedBindings.length === 0 && !defaultStillUsed) {
      // namespace import 或裸 import：全部移除
      imp.remove();
      removedCount++;
    } else if (stillUsedNamed.length === namedBindings.length && (defaultStillUsed || !defaultName)) {
      // 仍然全部在用，不动
    } else if (stillUsedNamed.length > 0 || defaultStillUsed) {
      // 部分仍用：移除不再用的 named
      for (const ni of namedBindings) {
        if (!remainingNames.has(ni.getName())) {
          ni.remove();
        }
      }
      // 如果 default 不再用但还存在：移除 default
      if (defaultName && !defaultStillUsed) {
        imp.setDefaultImport(undefined);
      }
    } else {
      // 全都不再使用
      imp.remove();
      removedCount++;
    }
  }

  if (removedCount > 0) {
    console.log(`   🧹 自动清理 ${removedCount} 组孤立 import`);
  }

  // 4. 向目标文件添加必要 import（去重）
  let addedCount = 0;
  for (const ui of usedImports) {
    // 跳过 namespace import（在目标文件中可能上下文不同）
    if (ui.namespace) {
      console.log(`   ⚠️  命名空间 import "${ui.moduleSpecifier}" 需手动迁移`);
      continue;
    }
    ensureImport(
      destSf,
      ui.moduleSpecifier,
      ui.default,
      ui.named.map((n) => n.name)
    );
    addedCount++;
  }

  // 5. 追加函数体到目标文件末尾
  destSf.addStatements(text.trim());
  if (!text.endsWith('\n')) destSf.addStatements('\n');

  // 6. 源文件补 re-export，保持既有 `import { foo } from '<src>'` 不断裂
  let relDest = toPosix(path.relative(path.dirname(srcPath), absDest));
  if (!relDest.startsWith('.')) relDest = './' + relDest;
  srcSf.addStatements(`export { ${funcName} } from '${relDest}';`);

  project.saveSync();

  console.log(`✅ "${funcName}" 已移至 ${absDest}`);
  console.log(`   源文件 ${srcPath}（已补 re-export，既有导入方无需改动）`);
  console.log(`   自动迁移 ${addedCount} 组 import 到目标文件`);
  console.log('⚠️  建议运行 npm run check 验证类型无误');
}

// ── add-param ──────────────────────────────────────────────────────────

function cmdAddParam(funcName, paramSignature, defaultValue) {
  const target = findExportDecl(funcName);
  if (!target) {
    console.error(`❌ 未找到导出符号 "${funcName}"`);
    process.exit(1);
  }
  if (target.kind !== 'function') {
    console.error(`❌ "${funcName}" 不是函数（是 ${target.kind}）`);
    process.exit(1);
  }

  const fn = target.node;
  const sf = target.sourceFile;

  // 解析参数名和类型
  const [paramName, ...typeParts] = paramSignature.split(':').map((s) => s.trim());
  const paramType = typeParts.join(':').trim() || undefined;

  // 统计原始调用方
  let callerCount = 0;
  const callerFiles = new Set();
  if (!defaultValue) {
    for (const ref of fn.findReferencesAsNodes()) {
      const callExpr = ref.getParent();
      if (callExpr && callExpr.getKind() === SyntaxKind.CallExpression) {
        callerCount++;
        callerFiles.add(ref.getSourceFile().getFilePath());
      }
    }
  }

  // 给定义加参数
  const baseline = snapshotDiagBaseline('add-param');
  const params = fn.getParameters();
  fn.insertParameter(params.length, {
    name: paramName,
    type: paramType,
    initializer: defaultValue,
  });

  // 给调用方加参数（仅当无默认值时）
  if (!defaultValue) {
    for (const ref of fn.findReferencesAsNodes()) {
      const callExpr = ref.getParent();
      if (callExpr && callExpr.getKind() === SyntaxKind.CallExpression) {
        callExpr.addArgument('undefined');
      }
    }
  }

  project.saveSync();
  assertNoNewDiags('add-param', baseline);

  console.log(`✅ 参数已添加: "${funcName}" 现在接受 "${paramSignature}"`);
  if (defaultValue) {
    console.log(`   有默认值 ${defaultValue}，调用方未修改`);
    console.log(`   📍 定义位置: ${sf.getFilePath()}`);
  } else {
    console.log(`   无默认值，已更新 ${callerCount} 个调用方（${callerFiles.size} 个文件）`);
    console.log(`   📍 定义位置: ${sf.getFilePath()}`);
    if (callerFiles.size > 0) {
      console.log('   涉事文件:');
      for (const f of callerFiles) {
        console.log(`     ${f.replace(FRONTEND + '/', '')}`);
      }
    }
  }
}

// ── main ───────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const cmd = args[0];

function printHelp() {
  const content = fs.readFileSync(FILESELF, 'utf-8');
  const start = content.indexOf('/**');
  const end = content.indexOf('*/');
  console.log(content.slice(start, end + 2).replace(/^ \* ?/gm, '').trim());
}

if (!cmd || cmd === 'help') {
  printHelp();
  process.exit(0);
}

switch (cmd) {
  case 'rename-function': {
    const [, oldName, newName] = args;
    // [fix] 拦截 flag 顶位：`rename-function foo --dry-run` 会把 --dry-run 当新函数名改码
    if (!oldName || !newName || oldName.startsWith('--') || newName.startsWith('--')) {
      console.error('用法: node scripts/codemod.mjs rename-function <旧名> <新名>');
      process.exit(1);
    }
    cmdRenameFunction(oldName, newName);
    break;
  }
  case 'move-function': {
    const [, funcName, destPath] = args;
    // [fix] 同上：flag 顶位拦截
    if (!funcName || !destPath || funcName.startsWith('--') || destPath.startsWith('--')) {
      console.error('用法: node scripts/codemod.mjs move-function <函数名> <目标文件>');
      process.exit(1);
    }
    cmdMoveFunction(funcName, destPath);
    break;
  }
  case 'add-param': {
    const [, funcName, paramSignature, defaultValue] = args;
    // [fix] flag 顶位拦截（defaultValue 是值参数，不拦截）
    if (!funcName || !paramSignature || funcName.startsWith('--') || paramSignature.startsWith('--')) {
      console.error('用法: node scripts/codemod.mjs add-param <函数名> <参数签名> [默认值]');
      process.exit(1);
    }
    cmdAddParam(funcName, paramSignature, defaultValue);
    break;
  }
  default:
    console.error(`未知命令: ${cmd}`);
    console.error('可用命令: rename-function, move-function, add-param, help');
    printHelp();
    process.exit(1);
}
