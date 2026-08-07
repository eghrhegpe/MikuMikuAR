#!/usr/bin/env node

/**
 * check-adr-health.mjs — ADR 健康检查脚本
 * 综合检查ADR的状态、技术债务、格式规范等
 * 
 * 使用方法：
 *   node scripts/check-adr-health.mjs              # 默认输出
 *   node scripts/check-adr-health.mjs --json        # JSON格式输出
 *   node scripts/check-adr-health.mjs --verbose     # 详细输出
 * 设计意图：ADR 健康综合检查（状态/债务/格式/关联/连续性）
 * 依赖：fs / path / url / 本地模块
 * 用法：
 *   node scripts/check-adr-health.mjs                 # 默认行为
 *   node scripts/check-adr-health.mjs --json    # JSON 输出（CI/子代理消费）
 *   node scripts/check-adr-health.mjs --verbose # 启用 verbose
 * 退出码：1（失败）
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { parseArgs } from './_lib/parse-args.mjs';
import { STATUS_CATEGORIES, TECHNICAL_DEBT_KEYWORDS } from './_lib/adr-status-categories.mjs';
import { parseAdrHeader } from './_lib/frontmatter.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const ADR_DIR = path.join(__dirname, '..', 'docs', 'adr');

// 已知空洞:编号已删除或并入其他 ADR,不应报为缺失(编号连续性 + 关联检查共用)
//   ADR-007 已删除(场景菜单设计参考,见 ADR-027 关联)
//   ADR-008 并入 ADR-003(来源行)
//   ADR-010 无记录
//   ADR-023 并入 ADR-017(Phase A/B 修复; 正文「原 ADR-023 已并入」属历史注记)
//   ADR-040 无记录
//   ADR-068 并入 ADR-017(追加修复)
const KNOWN_MISSING_IDS = new Set([7, 8, 10, 23, 40, 68]);

const _args = parseArgs(process.argv.slice(2), {
  bools: ['verbose', 'json', 'strict'],
});
if (_args.help) {
  const _src = fs.readFileSync(process.argv[1], 'utf-8');
  const _s = _src.indexOf('/**');
  const _e = _src.indexOf('*/', _s);
  console.log(_src.slice(_s, _e + 2).replace(/^ \* ?/gm, '').trim());
  process.exit(0);
}
if (_args.unknown && _args.unknown.length) {
  console.error(`❌ 未知参数: ${_args.unknown.join(', ')}（--help 查看用法）`);
  process.exit(1);
}
const VERBOSE = _args.verbose;
const JSON_OUTPUT = _args.json;
const STRICT = _args.strict; // --strict：任意结构问题（>0）即失败；缺省阈值 10（宽松 oracle）

// 检查文件是否存在
function fileExists(filePath) {
  return fs.existsSync(filePath);
}

// 读取 ADR 文件并提取所有信息
// 首部解析统一走 _lib/frontmatter.mjs 的 parseAdrHeader（首 20 行 + `---` 早停）：
// 修复「正文状态行 last-match-wins 覆盖首部」问题（ADR-232 §2.2 要求与 check-adr-status 口径一致）。
function readAdrFile(filePath) {
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    const hdr = parseAdrHeader(filePath);
    // parseAdrHeader 返回 { num, title, status, date, statusLine } 或 { error }；
    // 有 error（如缺状态/标题）时保持 null，由 checkFormat 报对应 issue，不在此吞掉
    const ok = !hdr.error;
    return {
      id: ok ? (hdr.num ?? null) : null,
      status: ok ? (hdr.status || null) : null,
      title: ok ? (hdr.title || null) : null,
      date: ok ? (hdr.date || null) : null,
      content,
      lines: content.split('\n'),
    };
  } catch (error) {
    console.error(`Error reading file ${filePath}:`, error.message);
    return null;
  }
}

// 分类状态
function categorizeStatus(status) {
  if (!status) return 'unknown';
  
  for (const [category, keywords] of Object.entries(STATUS_CATEGORIES)) {
    for (const keyword of keywords) {
      if (status.includes(keyword)) {
        return category;
      }
    }
  }
  
  return 'unknown';
}

// 检查技术债务（仅状态行关键词；正文历史叙述——「已移除/临时/弃用」等——为正常记载，
// 若计入会因历史事实描写触发大量误报，ADR-232 词表已共享，债务报告另有 check-adr-technical-debt 承接）
function checkTechnicalDebt(status, content) {
  const issues = [];
  
  // 检查状态关键词
  for (const keyword of TECHNICAL_DEBT_KEYWORDS) {
    if (status && status.includes(keyword)) {
      issues.push(`状态包含技术过时关键词: "${keyword}"`);
    }
  }
  
  return issues;
}

// 检查格式规范
function checkFormat(adrData) {
  const issues = [];
  const { id, status, title, date, content, lines } = adrData;
  
  // 检查编号
  if (!id) {
    issues.push('缺少ADR编号');
  }
  
  // 检查标题格式
  if (!title) {
    issues.push('缺少标题');
  } else if (title.length < 5) {
    issues.push('标题过短');
  } else if (title.length > 100) {
    issues.push('标题过长');
  }
  
  // 检查日期格式
  if (!date) {
    issues.push('缺少日期');
  } else if (!/^\d{4}-\d{2}-\d{2}/.test(date)) {
    issues.push('日期格式不符合 YYYY-MM-DD');
  }
  
  // 检查状态
  if (!status) {
    issues.push('缺少状态字段');
  }
  
  // 检查内容长度
  if (content.length < 100) {
    issues.push('内容过短');
  }
  
  // 检查是否有决策部分
  if (!content.includes('##') && !content.includes('###')) {
    issues.push('缺少章节标题');
  }
  
  return issues;
}

// 检查关联ADR
function checkRelatedAdrs(content) {
  const issues = [];
  
  // 提取关联ADR编号
  const relatedMatches = content.match(/ADR-(\d+)/g) || [];
  const relatedIds = [...new Set(relatedMatches.map(m => parseInt(m.replace('ADR-', ''))))];
  
  // 检查关联ADR是否存在
  for (const relatedId of relatedIds) {
    const relatedFile = `adr-${relatedId.toString().padStart(3, '0')}-*.md`;
    const found = fs.readdirSync(ADR_DIR).some(file => 
      file.startsWith(`adr-${relatedId.toString().padStart(3, '0')}-`)
    );
    
    if (!found && !KNOWN_MISSING_IDS.has(relatedId)) {
      issues.push(`关联 ADR-${relatedId} 不存在`);
    }
  }
  
  return issues;
}

// 主函数
function main() {
  const results = {
    timestamp: new Date().toISOString(),
    adrDir: ADR_DIR,
    totalFiles: 0,
    stats: {
      completed: 0,
      inProgress: 0,
      deprecated: 0,
      unknown: 0
    },
    healthScore: 100,
    issues: {
      format: [],
      technicalDebt: [],
      relatedAdrs: []
    },
    details: []
  };
  
  if (!fileExists(ADR_DIR)) {
    console.error(`ADR 目录不存在: ${ADR_DIR}`);
    process.exit(1);
  }
  
  const files = fs.readdirSync(ADR_DIR)
    .filter(file => file.startsWith('adr-') && file.endsWith('.md'))
    .sort();
  
  results.totalFiles = files.length;
  
  // 收集所有ADR编号，用于检查连续性
  const adrIds = [];
  // ADR-232 §2.4：编号重复检测用「文件名原始编号字符串」分组——
  // parseFloat 会把 061.1 / 061.10 折叠成同一数字，Set 去重后查不出这类撞号
  const numFilesMap = new Map(); // 编号字符串 → 文件名[]

  for (const file of files) {
    const filePath = path.join(ADR_DIR, file);
    const adrData = readAdrFile(filePath);

    // 文件名编号（adr-061.1-plan.md → "061.1"），供重复检测分组
    const fileNum = file.match(/^adr-(\d+(?:\.\d+)?)-/);
    if (fileNum) {
      const key = fileNum[1];
      if (!numFilesMap.has(key)) numFilesMap.set(key, []);
      numFilesMap.get(key).push(file);
    }

    if (!adrData) continue;
    
    const { id, status, title, date, content, lines } = adrData;
    const category = categorizeStatus(status);
    
    results.stats[category]++;
    
    if (id) adrIds.push(id);
    
    // 检查技术债务
    const debtIssues = checkTechnicalDebt(status || '', content);
    
    // 检查格式规范
    const formatIssues = checkFormat(adrData);
    
    // 检查关联ADR
    const relatedIssues = checkRelatedAdrs(content);
    
    // 收集问题
    if (formatIssues.length > 0) {
      results.issues.format.push({
        file,
        issues: formatIssues
      });
    }
    
    if (debtIssues.length > 0) {
      results.issues.technicalDebt.push({
        file,
        status,
        issues: debtIssues
      });
    }
    
    if (relatedIssues.length > 0) {
      results.issues.relatedAdrs.push({
        file,
        issues: relatedIssues
      });
    }
    
    // 保存详细信息
    results.details.push({
      file,
      id,
      title,
      status,
      date,
      category,
      healthIssues: [...formatIssues, ...debtIssues, ...relatedIssues]
    });
  }
  
  // 计算健康分数
  const formatIssueCount = results.issues.format.reduce((sum, item) => sum + item.issues.length, 0);
  const debtIssueCount = results.issues.technicalDebt.reduce((sum, item) => sum + item.issues.length, 0);
  const relatedIssueCount = results.issues.relatedAdrs.reduce((sum, item) => sum + item.issues.length, 0);
  
  // 不同类型问题的权重不同
  // 注：技术债务（状态行含过时语义）仅作 INFO 展示，不参与健康分与退出判定——
  // ADR 记录推进中/已废弃本就是正常历史状态，计入会把健康分长期压至 0（见 check-adr-technical-debt 信息性定位）。
  const formatWeight = 2;      // 格式问题权重较低
  const relatedWeight = 5;     // 关联问题权重较高
  
  const weightedIssues = (formatIssueCount * formatWeight) + 
                        (relatedIssueCount * relatedWeight);
  
  // 基于加权问题数计算健康分数
  results.healthScore = Math.max(0, Math.round(100 - (weightedIssues * 0.5)));
  
  // 真实结构问题（格式 + 关联 + 编号连续性）用于退出判定；债务不计入
  let structuralIssueCount = formatIssueCount + relatedIssueCount;

  // 检查编号连续性
  const sortedIds = [...new Set(adrIds)].sort((a, b) => a - b);
  const missingIds = [];
  
  for (let i = 0; i < sortedIds.length - 1; i++) {
    const current = sortedIds[i];
    const next = sortedIds[i + 1];
    
    if (next - current > 1) {
      for (let j = current + 1; j < next; j++) {
        if (!KNOWN_MISSING_IDS.has(j)) missingIds.push(j);
      }
    }
  }
  
  if (missingIds.length > 0) {
    results.issues.format.push({
      file: '(全局)',
      issues: [`缺少ADR编号: ${missingIds.join(', ')}`]
    });
  }

  // ADR-232 §2.4：编号重复检测（同 num 多文件）。
  // 整数编号重复 = 真错误（同号异名撞号），计入 format 驱动退出；
  // 子编号成对（adr-061.1-plan + adr-061.1-ragdoll-fidelity）是 §2.3 合法形态，仅 INFO 提示不阻断。
  const intDupGroups = [...numFilesMap.entries()]
    .filter(([num, flist]) => !num.includes('.') && flist.length > 1);
  if (intDupGroups.length > 0) {
    results.issues.format.push({
      file: '(全局)',
      issues: intDupGroups.map(
        ([num, flist]) => `编号 ADR-${num} 重复（${flist.length} 个文件）: ${flist.join(', ')}`
      ),
    });
  }
  const subDupGroups = [...numFilesMap.entries()]
    .filter(([num, flist]) => num.includes('.') && flist.length > 1);
  if (subDupGroups.length > 0) {
    results.subNumberPairs = subDupGroups.map(
      ([num, flist]) => `子编号 ADR-${num} 成对（§2.3 允许）: ${flist.join(', ')}`
    );
  }

  // 输出结果
  // 退出口径：仅真实结构问题（格式 + 关联 + 编号连续性 + 编号重复）驱动；技术债务为 INFO 展示，不阻断。
  // JSON 与文本模式共用同一口径，避免 --json 消费方按 $? 判定时拿到假绿（exit 0）。
  // [P2 2026-08-08] 重复编号（intDupGroups）此前只进报告不出退出码——同号异名撞号时
  // --strict 假绿，直接违背 L331 注释「计入 format 驱动退出」。现并入 finalStructuralIssues。
  const finalStructuralIssues = structuralIssueCount + missingIds.length + intDupGroups.length;
  // 阈值：--strict 下任意结构问题（>0）即失败；缺省 10 为宽松 oracle（供人工诊断）。
  // 该常量同时被 JSON / 文本两个输出分支共用，保证消费方按 $? 判定口径一致。
  const STRUCTURAL_THRESHOLD = STRICT ? 0 : 10;
  if (JSON_OUTPUT) {
    console.log(JSON.stringify(results, null, 2));
    process.exit(finalStructuralIssues > STRUCTURAL_THRESHOLD ? 1 : 0);
  }
  
  // 人类可读输出
  console.log('══════════════════════════════════════════════');
  console.log(' ADR 健康检查报告');
  console.log('══════════════════════════════════════════════');
  console.log(`扫描时间: ${results.timestamp}`);
  console.log(`ADR 目录: ${results.adrDir}`);
  console.log(`ADR 总数: ${results.totalFiles}`);
  console.log(`健康分数: ${results.healthScore}/100`);
  
  console.log('\n══════════════════════════════════════════════');
  console.log(' 状态统计');
  console.log('══════════════════════════════════════════════');
  console.log(`✅ 已完成: ${results.stats.completed}`);
  console.log(`🔄 进行中: ${results.stats.inProgress}`);
  console.log(`⚠️  已废弃: ${results.stats.deprecated}`);
  console.log(`❓ 未知状态: ${results.stats.unknown}`);
  
  // 输出格式问题
  if (results.issues.format.length > 0) {
    console.log('\n══════════════════════════════════════════════');
    console.log(' 格式问题');
    console.log('══════════════════════════════════════════════');
    
    results.issues.format.forEach(item => {
      console.log(`\n📄 ${item.file}`);
      item.issues.forEach(issue => {
        console.log(`   - ${issue}`);
      });
    });
  }
  
  // 输出技术债务
  if (results.issues.technicalDebt.length > 0) {
    console.log('\n══════════════════════════════════════════════');
    console.log(' 技术债务');
    console.log('══════════════════════════════════════════════');
    
    results.issues.technicalDebt.forEach(item => {
      console.log(`\n📄 ${item.file}`);
      console.log(`   状态: ${item.status}`);
      item.issues.forEach(issue => {
        console.log(`   - ${issue}`);
      });
    });
  }
  
  // 输出关联问题
  if (results.issues.relatedAdrs.length > 0) {
    console.log('\n══════════════════════════════════════════════');
    console.log(' 关联问题');
    console.log('══════════════════════════════════════════════');
    
    results.issues.relatedAdrs.forEach(item => {
      console.log(`\n📄 ${item.file}`);
      item.issues.forEach(issue => {
        console.log(`   - ${issue}`);
      });
    });
  }
  
  // 详细模式输出所有ADR
  if (VERBOSE) {
    console.log('\n══════════════════════════════════════════════');
    console.log(' 所有 ADR 状态');
    console.log('══════════════════════════════════════════════');
    
    results.details.forEach(item => {
      const icon = {
        completed: '✅',
        inProgress: '🔄',
        deprecated: '⚠️',
        unknown: '❓'
      }[item.category];
      
      console.log(`${icon} ${item.file}`);
      if (item.healthIssues.length > 0) {
        item.healthIssues.forEach(issue => {
          console.log(`   - ${issue}`);
        });
      }
    });
  }
  
  console.log('\n══════════════════════════════════════════════');
  console.log(' 检查完成');
  console.log('══════════════════════════════════════════════');
  
  // 返回退出码（与 JSON 分支共用上方 finalStructuralIssues / STRUCTURAL_THRESHOLD 口径）
  if (finalStructuralIssues > STRUCTURAL_THRESHOLD) {
    process.exit(1); // 结构问题过多
  }
}

// 运行主函数
main();
