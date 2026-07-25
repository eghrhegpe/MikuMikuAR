#!/usr/bin/env node
/**
 * @file AST 感知的代码批量重构工具（基于 ts-morph）
 *
 * 用法:
 *   node scripts/codemod.mjs <命令> [参数...]
 *
 * 命令:
 *   rename-function <旧名> <新名>
 *      重命名导出的函数/类/常量，自动更新所有引用
 *
 *   move-function <函数名> <目标文件>
 *      将导出的函数定义移动到另一个文件，自动清理原 export 并追加
 *      注意：不会自动合并 import，改完需手动检查
 *
 *   add-param <函数名> <参数签名> [默认值]
 *      为函数定义添加参数，并为所有无默认值的调用方补 undefined
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
 */

import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const FRONTEND = path.join(ROOT, 'frontend');
const require_ = createRequire(path.join(FRONTEND, 'package.json'));
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
    // 变量声明
    for (const vd of sf.getVariableDeclarations()) {
      if (vd.getName() === name) {
        const parent = vd.getParent();
        if (parent && parent.getKind() === SyntaxKind.VariableDeclarationList) {
          const vStmt = parent.getParent();
          if (vStmt && vStmt.getKind() === SyntaxKind.VariableStatement) {
            if (vStmt.isExported()) {
              return { sourceFile: sf, node: vd, kind: 'variable' };
            }
          }
        }
      }
    }
  }
  return null;
}

// ── rename-function ────────────────────────────────────────────────────

function cmdRenameFunction(oldName, newName) {
  const target = findExportDecl(oldName);
  if (!target) {
    console.error(`❌ 未找到导出符号 "${oldName}"`);
    process.exit(1);
  }

  console.log(`📍 定义位置: ${target.sourceFile.getFilePath()} （${target.kind}）`);
  target.node.rename(newName);
  target.sourceFile.saveSync();

  console.log(`✅ 重命名完成: "${oldName}" → "${newName}"`);
  console.log('   ts-morph 已自动更新所有引用');
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

  const srcPath = target.sourceFile.getFilePath();
  const stmt = target.node;
  const text = stmt.getFullText();

  // 从源文件移除
  const parentToRemove = target.kind === 'variable'
    ? stmt.getParent().getParent()
    : stmt;
  parentToRemove.remove();

  // 追加到目标文件末尾
  destSf.addStatements(text.trim());
  if (!text.endsWith('\n')) destSf.addStatements('\n');

  target.sourceFile.saveSync();
  destSf.saveSync();

  console.log(`✅ "${funcName}" 已移至 ${absDest}`);
  console.log(`   源文件 ${srcPath}`);
  console.log('⚠️  请手动检查：');
  console.log('   - 目标文件头部是否有重复 import（需手动合并）');
  console.log('   - 源文件是否产生孤立 import（需手动清理）');
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
  const [paramName, ...typeParts] = paramSignature.split(':').map(s => s.trim());
  const paramType = typeParts.join(':').trim() || undefined;

  // 给定义加参数
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

  sf.saveSync();
  console.log(`✅ 参数已添加: "${funcName}" 现在接受 "${paramSignature}"`);
  if (defaultValue) {
    console.log(`   有默认值 ${defaultValue}，调用方未修改`);
  } else {
    console.log(`   无默认值，所有调用方已补 undefined`);
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
    if (!oldName || !newName) {
      console.error('用法: node scripts/codemod.mjs rename-function <旧名> <新名>');
      process.exit(1);
    }
    cmdRenameFunction(oldName, newName);
    break;
  }
  case 'move-function': {
    const [, funcName, destPath] = args;
    if (!funcName || !destPath) {
      console.error('用法: node scripts/codemod.mjs move-function <函数名> <目标文件>');
      process.exit(1);
    }
    cmdMoveFunction(funcName, destPath);
    break;
  }
  case 'add-param': {
    const [, funcName, paramSignature, defaultValue] = args;
    if (!funcName || !paramSignature) {
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
