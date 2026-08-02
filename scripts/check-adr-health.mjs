#!/usr/bin/env node

/**
 * ADR 健康检查脚本
 * 综合检查ADR的状态、技术债务、格式规范等
 * 
 * 使用方法：
 *   node scripts/check-adr-health.mjs              # 默认输出
 *   node scripts/check-adr-health.mjs --json        # JSON格式输出
 *   node scripts/check-adr-health.mjs --verbose     # 详细输出
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { parseArgs } from './_lib/parse-args.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const ADR_DIR = path.join(__dirname, '..', 'docs', 'adr');

const _args = parseArgs(process.argv.slice(2), {
  bools: ['verbose', 'json'],
});
const VERBOSE = _args.verbose;
const JSON_OUTPUT = _args.json;

// 状态分类
const STATUS_CATEGORIES = {
  completed: ['已完成', '已实施', '已落地', '已批准', '已采纳', '已实现', '已交付', '通过', '✅', 'accepted', '调研落档', '已修复', '完成', '实施完成'],
  // 「部分实现/部分落地」属推进中而非已废弃（与 gen-docs-index.mjs 的 ADR_BUCKETS 口径一致）
  inProgress: ['实施中', '规划中', '草案', '提议', 'Proposed', '部分落地', '部分实现'],
  deprecated: ['已废弃', '已放弃', '已搁置', '搁置', '废弃'],
  unknown: []
};

// 技术过时关键词
const TECHNICAL_DEBT_KEYWORDS = [
  '已废弃', '已放弃', '已搁置', '搁置', '废弃',
  '待立项', '草案', '提案', 'Proposed',
  '规划中', '部分实现', '待推进',
  '已过时', '已淘汰', '已替换', '已取代'
];

// 检查文件是否存在
function fileExists(filePath) {
  return fs.existsSync(filePath);
}

// 读取 ADR 文件并提取所有信息
function readAdrFile(filePath) {
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    const lines = content.split('\n');
    
    let status = null;
    let title = null;
    let date = null;
    let id = null;
    
    for (const line of lines) {
      // 提取状态（支持三种格式）
      const statusMatch1 = line.match(/^>\s*\*\*状态\*\*:\s*(.+)/);
      const statusMatch2 = line.match(/^-\s*\*\*状态\*\*[：:]\s*(.+)/);
      const statusMatch3 = line.match(/^\|\s*\*\*状态\*\*\s*\|\s*(.+?)\s*\|/);
      
      if (statusMatch1) status = statusMatch1[1].trim();
      else if (statusMatch2) status = statusMatch2[1].trim();
      else if (statusMatch3) status = statusMatch3[1].trim();
      
      // 提取标题
      const titleMatch = line.match(/^#\s+ADR-(\d+):\s*(.+)/);
      if (titleMatch) {
        id = parseInt(titleMatch[1]);
        title = titleMatch[2].trim();
      }
      
      // 提取日期
      const dateMatch1 = line.match(/^>\s*\*\*日期\*\*:\s*(.+)/);
      const dateMatch2 = line.match(/^-\s*\*\*日期\*\*[：:]\s*(.+)/);
      const dateMatch3 = line.match(/^\|\s*\*\*日期\*\*\s*\|\s*(.+?)\s*\|/);
      
      if (dateMatch1) date = dateMatch1[1].trim();
      else if (dateMatch2) date = dateMatch2[1].trim();
      else if (dateMatch3) date = dateMatch3[1].trim();
    }
    
    return { id, status, title, date, content, lines };
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

// 检查技术债务
function checkTechnicalDebt(status, content) {
  const issues = [];
  
  // 检查状态关键词
  for (const keyword of TECHNICAL_DEBT_KEYWORDS) {
    if (status && status.includes(keyword)) {
      issues.push(`状态包含技术过时关键词: "${keyword}"`);
    }
  }
  
  // 检查内容中的过时引用
  const contentLower = content.toLowerCase();
  const outdatedPatterns = [
    { pattern: /deprecated|弃用|过时/, message: '内容包含弃用/过时引用' },
    { pattern: /todo|fixme|hack/, message: '内容包含待办/修复标记' },
    { pattern: /临时|temporary|workaround/, message: '内容包含临时解决方案' },
    { pattern: /已移除|removed|deleted/, message: '内容包含已移除功能引用' }
  ];
  
  for (const { pattern, message } of outdatedPatterns) {
    if (pattern.test(contentLower)) {
      issues.push(message);
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
    
    if (!found) {
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
  
  for (const file of files) {
    const filePath = path.join(ADR_DIR, file);
    const adrData = readAdrFile(filePath);
    
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
  const formatWeight = 2;      // 格式问题权重较低
  const debtWeight = 3;        // 技术债务权重中等
  const relatedWeight = 5;     // 关联问题权重较高
  
  const weightedIssues = (formatIssueCount * formatWeight) + 
                        (debtIssueCount * debtWeight) + 
                        (relatedIssueCount * relatedWeight);
  
  // 基于加权问题数计算健康分数
  results.healthScore = Math.max(0, Math.round(100 - (weightedIssues * 0.5)));
  
  const totalIssues = formatIssueCount + debtIssueCount + relatedIssueCount;

  // 检查编号连续性
  const sortedIds = [...new Set(adrIds)].sort((a, b) => a - b);
  const missingIds = [];
  
  for (let i = 0; i < sortedIds.length - 1; i++) {
    const current = sortedIds[i];
    const next = sortedIds[i + 1];
    
    if (next - current > 1) {
      for (let j = current + 1; j < next; j++) {
        missingIds.push(j);
      }
    }
  }
  
  if (missingIds.length > 0) {
    results.issues.format.push({
      file: '(全局)',
      issues: [`缺少ADR编号: ${missingIds.join(', ')}`]
    });
  }
  
  // 输出结果
  if (JSON_OUTPUT) {
    console.log(JSON.stringify(results, null, 2));
    return;
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
  
  // 返回退出码
  if (totalIssues > 10) {
    process.exit(1); // 问题过多
  }
}

// 运行主函数
main();
