#!/usr/bin/env node

/**
 * ADR 状态检查脚本
 * 扫描所有 ADR 文件，检查状态，并生成报告
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const ADR_DIR = path.join(__dirname, '..', 'docs', 'adr');

// 状态分类
const STATUS_CATEGORIES = {
  completed: ['已完成', '已实施', '已落地', '已批准', '已采纳', '已实现', '已交付', '通过', '✅'],
  inProgress: ['实施中', '规划中', '草案', '提议', 'Proposed'],
  deprecated: ['已废弃', '已放弃', '已搁置', '搁置', '废弃'],
  unknown: []
};

// 检查文件是否存在
function fileExists(filePath) {
  return fs.existsSync(filePath);
}

// 读取 ADR 文件并提取状态
function readAdrFile(filePath) {
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    const lines = content.split('\n');
    
    // 查找状态行
    for (const line of lines) {
      const statusMatch = line.match(/^>\s*\*\*状态\*\*:\s*(.+)/);
      if (statusMatch) {
        return statusMatch[1].trim();
      }
    }
    
    return null;
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

// 主函数
function main() {
  console.log('══════════════════════════════════════════════');
  console.log(' ADR 状态检查报告');
  console.log('══════════════════════════════════════════════');
  
  if (!fileExists(ADR_DIR)) {
    console.error(`ADR 目录不存在: ${ADR_DIR}`);
    process.exit(1);
  }
  
  const files = fs.readdirSync(ADR_DIR)
    .filter(file => file.startsWith('adr-') && file.endsWith('.md'))
    .sort();
  
  console.log(`扫描到 ${files.length} 个 ADR 文件\n`);
  
  const stats = {
    completed: 0,
    inProgress: 0,
    deprecated: 0,
    unknown: 0
  };
  
  const details = [];
  
  for (const file of files) {
    const filePath = path.join(ADR_DIR, file);
    const status = readAdrFile(filePath);
    const category = categorizeStatus(status);
    
    stats[category]++;
    
    details.push({
      file,
      status: status || '(无状态)',
      category
    });
    
    // 输出详细信息
    const categoryIcon = {
      completed: '✅',
      inProgress: '🔄',
      deprecated: '⚠️',
      unknown: '❓'
    }[category];
    
    console.log(`${categoryIcon} ${file}: ${status || '(无状态)'}`);
  }
  
  console.log('\n══════════════════════════════════════════════');
  console.log(' 统计摘要');
  console.log('══════════════════════════════════════════════');
  console.log(`已完成: ${stats.completed}`);
  console.log(`进行中: ${stats.inProgress}`);
  console.log(`已废弃: ${stats.deprecated}`);
  console.log(`未知状态: ${stats.unknown}`);
  console.log(`总计: ${files.length}`);
  
  // 检查可能需要更新的 ADR
  console.log('\n══════════════════════════════════════════════');
  console.log(' 可能需要更新的 ADR');
  console.log('══════════════════════════════════════════════');
  
  const needUpdate = details.filter(d => 
    d.category === 'inProgress' || 
    d.category === 'unknown' ||
    d.status.includes('规划中') ||
    d.status.includes('草案')
  );
  
  if (needUpdate.length === 0) {
    console.log('无');
  } else {
    needUpdate.forEach(d => {
      console.log(`- ${d.file}: ${d.status}`);
    });
  }
  
  // 检查已废弃的 ADR
  console.log('\n══════════════════════════════════════════════');
  console.log(' 已废弃的 ADR');
  console.log('══════════════════════════════════════════════');
  
  const deprecated = details.filter(d => d.category === 'deprecated');
  
  if (deprecated.length === 0) {
    console.log('无');
  } else {
    deprecated.forEach(d => {
      console.log(`- ${d.file}: ${d.status}`);
    });
  }
  
  console.log('\n══════════════════════════════════════════════');
  console.log(' 检查完成');
  console.log('══════════════════════════════════════════════');
}

// 运行主函数
main();
