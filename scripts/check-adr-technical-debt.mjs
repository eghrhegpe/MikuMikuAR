#!/usr/bin/env node

/**
 * ADR 技术债务检查脚本
 * 检查可能需要更新或存在技术过时的 ADR
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const ADR_DIR = path.join(__dirname, '..', 'docs', 'adr');

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

// 读取 ADR 文件并提取状态和内容
function readAdrFile(filePath) {
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    const lines = content.split('\n');
    
    // 查找状态行
    let status = null;
    let title = null;
    
    for (const line of lines) {
      const statusMatch = line.match(/^>\s*\*\*状态\*\*:\s*(.+)/);
      if (statusMatch) {
        status = statusMatch[1].trim();
      }
      
      const titleMatch = line.match(/^#\s+(.+)/);
      if (titleMatch) {
        title = titleMatch[1].trim();
      }
    }
    
    return { status, title, content };
  } catch (error) {
    console.error(`Error reading file ${filePath}:`, error.message);
    return null;
  }
}

// 检查技术过时
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

// 主函数
function main() {
  console.log('══════════════════════════════════════════════');
  console.log(' ADR 技术债务检查报告');
  console.log('══════════════════════════════════════════════');
  
  if (!fileExists(ADR_DIR)) {
    console.error(`ADR 目录不存在: ${ADR_DIR}`);
    process.exit(1);
  }
  
  const files = fs.readdirSync(ADR_DIR)
    .filter(file => file.startsWith('adr-') && file.endsWith('.md'))
    .sort();
  
  console.log(`扫描到 ${files.length} 个 ADR 文件\n`);
  
  const debtItems = [];
  
  for (const file of files) {
    const filePath = path.join(ADR_DIR, file);
    const adrData = readAdrFile(filePath);
    
    if (!adrData) continue;
    
    const { status, title, content } = adrData;
    const issues = checkTechnicalDebt(status || '', content);
    
    if (issues.length > 0) {
      debtItems.push({
        file,
        title,
        status,
        issues
      });
    }
  }
  
  // 输出技术债务报告
  console.log('══════════════════════════════════════════════');
  console.log(' 技术债务项目');
  console.log('══════════════════════════════════════════════');
  
  if (debtItems.length === 0) {
    console.log('未发现技术债务项目');
  } else {
    debtItems.forEach(item => {
      console.log(`\n📄 ${item.file}`);
      console.log(`   标题: ${item.title || '(无标题)'}`);
      console.log(`   状态: ${item.status || '(无状态)'}`);
      console.log('   问题:');
      item.issues.forEach(issue => {
        console.log(`     - ${issue}`);
      });
    });
  }
  
  // 输出建议更新的 ADR
  console.log('\n══════════════════════════════════════════════');
  console.log(' 建议更新的 ADR');
  console.log('══════════════════════════════════════════════');
  
  const suggestedUpdates = debtItems.filter(item => 
    item.issues.some(issue => 
      issue.includes('技术过时关键词') || 
      issue.includes('弃用/过时引用')
    )
  );
  
  if (suggestedUpdates.length === 0) {
    console.log('无');
  } else {
    suggestedUpdates.forEach(item => {
      console.log(`- ${item.file}: ${item.status}`);
    });
  }
  
  // 输出已废弃的 ADR
  console.log('\n══════════════════════════════════════════════');
  console.log(' 已废弃的 ADR');
  console.log('══════════════════════════════════════════════');
  
  const deprecated = debtItems.filter(item => 
    item.status && (
      item.status.includes('已废弃') || 
      item.status.includes('已放弃') ||
      item.status.includes('已搁置')
    )
  );
  
  if (deprecated.length === 0) {
    console.log('无');
  } else {
    deprecated.forEach(item => {
      console.log(`- ${item.file}: ${item.status}`);
    });
  }
  
  console.log('\n══════════════════════════════════════════════');
  console.log(' 检查完成');
  console.log('══════════════════════════════════════════════');
}

// 运行主函数
main();
