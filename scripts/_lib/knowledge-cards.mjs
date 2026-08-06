/**
 * knowledge-cards.mjs
 * 知识卡常量共享层（scripts/_lib）—— 各 gen-* 脚本与 .vitepress/config.ts
 * 各自复制 KNOWLEDGE_ORDER / CATEGORY_LABEL / 非卡片文件清单导致漂移
 * （2026-08-06 实证：gen-knowledge-graph.mjs 的 NON_CARDS 缺 tier-review.md），
 * 由本模块单点导出统一。
 *
 * 零依赖（仅 node:path）。
 */
import path from 'node:path';
import { ROOT } from './scan-files.mjs';

/** 知识卡分类展示顺序（未分类卡片排在最后）。 */
export const KNOWLEDGE_ORDER = ['env', 'scene', 'physics', 'rendering', 'motion', 'ui', 'core', 'backend'];

/** 分类 → 中文标签（sidebar / graph / 索引共用）。 */
export const CATEGORY_LABEL = {
  env: '环境系统',
  scene: '场景编排',
  physics: '物理系统',
  rendering: '渲染系统',
  motion: '动作系统',
  ui: 'UI / 菜单',
  core: '核心基础设施',
  backend: '后端',
};

/** 非知识卡目录成员（索引 / 路由表 / 机器生成地图），单列不参与分类统计。 */
export const KNOWLEDGE_NON_CARDS = new Set([
  'index.md',
  'README.md',
  'routes.md',
  'menu-map.md',
  'graph.md',
  'tier-review.md',
]);

/** 知识卡目录（供各 gen-* 脚本复用，避免各自 path.join 漂移）。 */
export const KNOW_DIR = path.join(ROOT, 'docs', 'knowledge');
