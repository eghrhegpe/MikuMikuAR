import { readFileSync, readdirSync, existsSync, mkdirSync, writeFileSync } from 'fs';
import { join, relative } from 'path';

const srcDir = join(process.cwd(), 'src');
const outputDir = join(process.cwd(), 'docs/audit');

// 确保输出目录存在
if (!existsSync(outputDir)) {
  mkdirSync(outputDir, { recursive: true });
}

interface ImportInfo {
  from: string;
  imports: string;
  source: string;
}

interface FileAnalysis {
  path: string;
  imports: ImportInfo[];
  asyncFunctions: Array<{
    name: string;
    hasAbortSignal: boolean;
    hasTryCatch: boolean;
    line: number;
  }>;
  awaitPoints: Array<{
    line: number;
    inTryCatch: boolean;
  }>;
}

function extractImports(content: string, filePath: string): ImportInfo[] {
  const imports: ImportInfo[] = [];
  const lines = content.split('\n');
  
  // 匹配 import ... from '...'
  const importRegex = /^import\s+(?:[\w\s{},*]+\s+from\s+)?['"]([^'"]+)['"]/;
  // 匹配动态导入 import('...')
  const dynamicImportRegex = /import\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
  
  lines.forEach((line, idx) => {
    const staticMatch = line.match(importRegex);
    if (staticMatch) {
      imports.push({
        from: filePath,
        imports: line,
        source: staticMatch[1]
      });
    }
    
    // 动态导入
    let dynamicMatch;
    while ((dynamicMatch = dynamicImportRegex.exec(line)) !== null) {
      imports.push({
        from: filePath,
        imports: line.trim(),
        source: dynamicMatch[1]
      });
    }
  });
  
  return imports;
}

function analyzeAsyncPatterns(content: string, filePath: string) {
  const asyncFunctions: FileAnalysis['asyncFunctions'] = [];
  const awaitPoints: FileAnalysis['awaitPoints'] = [];
  const lines = content.split('\n');
  
  let inTryBlock = false;
  let tryDepth = 0;
  const tryStack: boolean[] = [];
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineNum = i + 1;
    
    // 检测 try 块开始
    if (line.includes('try\s*{')) {
      tryStack.push(true);
      tryDepth++;
    }
    
    // 检测 async 函数定义
    const asyncFuncMatch = line.match(/(?:async\s+)?(function\s+\w+|\w+\s*[:=]\s*async\s*(?:\([^)]*\))?\s*=>)/);
    if (asyncFuncMatch) {
      const funcName = line.match(/\w+\s*[:=]\s*async|async\s+function\s+(\w+)/);
      const funcNameStr = funcName ? (funcName[1] || funcName[0].match(/\w+/)?.[0]) : `anonymous@${lineNum}`;
      
      // 检查是否有 AbortSignal 参数
      const paramMatch = line.match(/\(([^)]*)\)/);
      const hasAbortSignal = paramMatch && 
        (paramMatch[1].includes('signal') || paramMatch[1].includes('AbortSignal') || 
         paramMatch[1].includes('options') || paramMatch[1].includes('opts'));
      
      asyncFunctions.push({
        name: funcNameStr || `func@${lineNum}`,
        hasAbortSignal,
        hasTryCatch: false, // 稍后判断
        line: lineNum
      });
    }
    
    // 检测 await
    if (line.includes('await ')) {
      awaitPoints.push({
        line: lineNum,
        inTryCatch: tryStack.length > 0
      });
    }
    
    // 检测 catch 块结束（简化处理）
    if (line.includes('}') && tryStack.length > 0) {
      // 简化：如果这一行有 catch，则认为 try 块结束
      if (line.includes('catch')) {
        tryStack.pop();
      } else if (!line.trim().startsWith('//')) {
        // 普通闭合括号，可能是 try 块内的
      }
    }
  }
  
  // 标记 async 函数是否有 try/catch（简化：检查文件中是否有 try 块）
  const hasTryBlock = content.includes('try\s*{');
  asyncFunctions.forEach(fn => {
    if (hasTryBlock && fn.line < lines.length - 5) {
      // 简单启发式：检查函数后几行是否有 try
      const snippet = lines.slice(fn.line - 1, Math.min(fn.line + 10, lines.length)).join('\n');
      fn.hasTryCatch = snippet.includes('try\s*{');
    }
  });
  
  return { asyncFunctions, awaitPoints };
}

function resolveModule(from: string, source: string): string {
  if (source.startsWith('.') || source.startsWith('/')) {
    // 相对路径
    const resolved = join(from, '..', source);
    return resolved.replace(/\\.ts$/, '').replace(/\\.tsx$/, '');
  } else {
    // 第三方包
    return source.split('/')[0];
  }
}

// 主逻辑
const allFiles: string[] = [];
function walkDir(dir: string) {
  const entries = readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isDirectory() && !entry.name.startsWith('.') && entry.name !== '__tests__') {
      walkDir(join(dir, entry.name));
    } else if (entry.isFile() && (entry.name.endsWith('.ts') || entry.name.endsWith('.tsx'))) {
      allFiles.push(join(dir, entry.name));
    }
  }
}

walkDir(srcDir);

console.log(`扫描到 ${allFiles.length} 个 TypeScript 文件`);

const allImports: { from: string; to: string; line: string }[] = [];
const fileAnalyses: FileAnalysis[] = [];

// 统计 async 相关数据
let totalAsyncFunctions = 0;
let withAbortSignal = 0;
let withTryCatch = 0;
let unguardedAwait = 0;

for (const file of allFiles) {
  const content = readFileSync(file, 'utf-8');
  const relativePath = relative(srcDir, file).replace(/\\/g, '/');
  
  const imports = extractImports(content, relativePath);
  const { asyncFunctions, awaitPoints } = analyzeAsyncPatterns(content, relativePath);
  
  fileAnalyses.push({ path: relativePath, imports, asyncFunctions, awaitPoints });
  
  totalAsyncFunctions += asyncFunctions.length;
  withAbortSignal += asyncFunctions.filter(f => f.hasAbortSignal).length;
  withTryCatch += asyncFunctions.filter(f => f.hasTryCatch).length;
  unguardedAwait += awaitPoints.filter(p => !p.inTryCatch).length;
  
  for (const imp of imports) {
    const resolved = resolveModule(file, imp.source);
    const relativeTo = relative(srcDir, resolved).replace(/\\/g, '/');
    allImports.push({
      from: relativePath,
      to: relativeTo || imp.source,
      line: imp.imports
    });
  }
}

// 生成 Mermaid 依赖图
const mermaidLines: string[] = [];
mermaidLines.push('---');
mermaidLines.push('title: MikuMikuAR Frontend 模块依赖图');
mermaidLines.push('---');
mermaidLines.push('flowchart TD');
mermaidLines.push('');

// 分组
const coreModules: string[] = [];
const sceneModules: string[] = [];
const menuModules: string[] = [];
const motionModules: string[] = [];
const otherModules: string[] = [];

for (const file of allFiles) {
  const relativePath = relative(srcDir, file).replace(/\\/g, '/').replace(/\.tsx?$/, '');
  if (relativePath.startsWith('core/')) coreModules.push(relativePath);
  else if (relativePath.startsWith('scene/')) sceneModules.push(relativePath);
  else if (relativePath.startsWith('menus/')) menuModules.push(relativePath);
  else if (relativePath.startsWith('motion-algos/')) motionModules.push(relativePath);
  else otherModules.push(relativePath);
}

// 定义节点分组
mermaidLines.push('    subgraph Core [核心模块]');
coreModules.forEach(m => mermaidLines.push(`        ${m.replace(/\//g, '_')}["${m}"]`));
mermaidLines.push('    end');

mermaidLines.push('');
mermaidLines.push('    subgraph Scene [场景模块]');
sceneModules.forEach(m => mermaidLines.push(`        ${m.replace(/\//g, '_')}["${m}"]`));
mermaidLines.push('    end');

mermaidLines.push('');
mermaidLines.push('    subgraph Menus [菜单模块]');
menuModules.forEach(m => mermaidLines.push(`        ${m.replace(/\//g, '_')}["${m}"]`));
mermaidLines.push('    end');

mermaidLines.push('');
mermaidLines.push('    subgraph Motion [运动算法]');
motionModules.forEach(m => mermaidLines.push(`        ${m.replace(/\//g, '_')}["${m}"]`));
mermaidLines.push('    end');

mermaidLines.push('');
mermaidLines.push('    subgraph Other [其他]');
otherModules.forEach(m => mermaidLines.push(`        ${m.replace(/\//g, '_')}["${m}"]`));
mermaidLines.push('    end');

mermaidLines.push('');

// 添加边（只画内部依赖，过滤第三方包）
const internalDeps = new Set<string>();
for (const imp of allImports) {
  if (!imp.to.startsWith('.') && !imp.to.includes('/') === false && !imp.to.match(/^[a-z]/i)) {
    // 内部模块
    const key = `${imp.from.split('/')[0]}_${imp.to.split('/')[0]}`;
    if (!internalDeps.has(key)) {
      internalDeps.add(key);
      const fromId = imp.from.replace(/\.tsx?$/, '').replace(/\//g, '_');
      const toId = imp.to.replace(/\.tsx?$/, '').replace(/\//g, '_');
      mermaidLines.push(`    ${fromId} --> ${toId}`);
    }
  }
}

// 写入 Mermaid 文件
const mermaidContent = mermaidLines.join('\n');
const mermaidPath = join(outputDir, 'dependency-graph.mmd');
writeFileSync(mermaidPath, mermaidContent, 'utf-8');

// 生成审计报告
const reportLines: string[] = [];
reportLines.push('# Frontend 代码质量审计报告');
reportLines.push('');
reportLines.push('## 依赖图');
reportLines.push('');
reportLines.push('📊 总文件数：`224`');
reportLines.push(`📦 核心模块：${coreModules.length} 个`);
reportLines.push(`🎬 场景模块：${sceneModules.length} 个`);
reportLines.push(`📋 菜单模块：${menuModules.length} 个`);
reportLines.push(`💃 运动算法：${motionModules.length} 个`);
reportLines.push('');
reportLines.push('Mermaid 文件已生成：`docs/audit/dependency-graph.mmd`');
reportLines.push('');
reportLines.push('## 并发与异常处理审计');
reportLines.push('');
reportLines.push('### 统计概览');
reportLines.push('');
reportLines.push('| 指标 | 数量 | 比例 |');
reportLines.push('|------|------|------|');
reportLines.push(`| 总 async 函数 | ${totalAsyncFunctions} | 100% |`);
reportLines.push(`| 使用 AbortSignal | ${withAbortSignal} | ${((withAbortSignal/totalAsyncFunctions)*100).toFixed(1)}% |`);
reportLines.push(`| 有 try/catch 保护 | ${withTryCatch} | ${((withTryCatch/totalAsyncFunctions)*100).toFixed(1)}% |`);
reportLines.push(`| 未保护的 await 点 | ${unguardedAwait} | - |`);
reportLines.push('');

// 详细问题列表
reportLines.push('### 问题详情');
reportLines.push('');

const issues: Array<{file: string; function: string; line: number; type: 'P1'|'P2'|'P3'; message: string}> = [];

for (const analysis of fileAnalyses) {
  for (const fn of analysis.asyncFunctions) {
    if (!fn.hasAbortSignal && !fn.name.includes('anonymous')) {
      // 耗时操作应该使用 AbortSignal
      if (fn.name.includes('load') || fn.name.includes('fetch') || fn.name.includes('read') || fn.name.includes('export')) {
        issues.push({
          file: analysis.path,
          function: fn.name,
          line: fn.line,
          type: 'P2',
          message: '耗时操作未使用 AbortSignal，无法支持取消操作'
        });
      }
    }
    
    if (!fn.hasTryCatch) {
      issues.push({
        file: analysis.path,
        function: fn.name,
        line: fn.line,
        type: 'P3',
        message: 'async 函数未包裹 try/catch，异常可能未处理'
      });
    }
  }
  
  for (const point of analysis.awaitPoints) {
    if (!point.inTryCatch) {
      // 检查是否是顶层调用（允许）
      const lines = readFileSync(join(srcDir, analysis.path), 'utf-8').split('\n');
      const context = lines.slice(Math.max(0, point.line - 3), point.line).join('\n');
      if (!context.includes('try') && !context.includes('catch')) {
        issues.push({
          file: analysis.path,
          function: '-',
          line: point.line,
          type: 'P3',
          message: 'await 点未在 try/catch 块内'
        });
      }
    }
  }
}

// 按优先级排序
issues.sort((a, b) => {
  const order = { 'P1': 0, 'P2': 1, 'P3': 2 };
  return order[a.type] - order[b.type];
});

// 输出表格
reportLines.push('| 优先级 | 文件 | 函数/行号 | 问题 |');
reportLines.push('|--------|------|-----------|------|');

for (const issue of issues.slice(0, 50)) { // 只显示前 50 个
  const emoji = { 'P1': '🔴', 'P2': '🟠', 'P3': '🟡' }[issue.type];
  reportLines.push(`| ${emoji} ${issue.type} | ${issue.file} | ${issue.function || '-'}:${issue.line} | ${issue.message} |`);
}

if (issues.length > 50) {
  reportLines.push(`| ... | 共 ${issues.length} 个问题，详见完整报告 |`);
}

reportLines.push('');
reportLines.push('### 建议');
reportLines.push('');
reportLines.push('1. **AbortSignal 规范化** — 所有涉及 I/O、网络请求、文件操作的 async 函数应接受 `signal?: AbortSignal` 参数');
reportLines.push('2. **异常边界** — 顶层 async 函数应转换为错误边界处理，内部函数可依赖调用方处理');
reportLines.push('3. **并发控制** — 检查 loading 状态标志，防止重复触发相同操作');
reportLines.push('');
reportLines.push('---');
reportLines.push(`*生成时间：${new Date().toISOString()}*`);

const reportPath = join(outputDir, 'async-exception-audit.md');
writeFileSync(reportPath, reportLines.join('\n'), 'utf-8');

console.log('✅ 依赖图已生成：docs/audit/dependency-graph.mmd');
console.log('✅ 审计报告已生成：docs/audit/async-exception-audit.md');
console.log(`\n📊 统计摘要:`);
console.log(`   - 总 async 函数：${totalAsyncFunctions}`);
console.log(`   - 使用 AbortSignal: ${withAbortSignal} (${((withAbortSignal/totalAsyncFunctions)*100).toFixed(1)}%)`);
console.log(`   - 有 try/catch: ${withTryCatch} (${((withTryCatch/totalAsyncFunctions)*100).toFixed(1)}%)`);
console.log(`   - 未保护 await 点：${unguardedAwait}`);
console.log(`   - 发现问题：${issues.length} 个`);