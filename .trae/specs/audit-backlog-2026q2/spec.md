# 审计遗留建议处理 - Product Requirement Document

## Overview
- **Summary**: 处理 2026-06-30 全模块审计中延后的 48 项遗留建议，涵盖高风险安全问题、性能优化、状态一致性、崩溃防护、代码质量、架构重构和 UI 细节打磨。
- **Purpose**: 消除技术债务，提升系统稳定性、安全性和可维护性，为后续功能开发奠定坚实基础。
- **Target Users**: 开发者（代码质量提升）、终端用户（稳定性/性能/体验改善）

## Goals
- 消除全部 3 项高风险问题（XSS 安全隐患、预设加载路径匹配、材质可见性序列化）
- 处理全部 15 项中等优先级问题（性能、状态一致性、崩溃防护）
- 选择性处理 30 项低优先级问题中收益较高的部分
- 所有改动通过构建验证（`tsc --noEmit` + `vite build`）
- 不引入回归 bug，现有测试全部通过

## Non-Goals (Out of Scope)
- 大规模架构重构（如 scene/ 目录分子目录）— 作为独立项目规划
- 新增功能模块（如布料 tube/cape 拓扑、lipSync 多 morph）— 排入 roadmap
- 完整的虚拟滚动实现 — 超出本次修复范围
- 移动端适配专项 — 独立项目

## Background & Context
- 2026-06-30 完成前端全模块深度审计与修复（第二轮），覆盖 25+ 文件，修复 80+ 项问题
- 剩余 48 项因工作量大、风险高或优先级低而延后
- 项目处于体验打磨阶段，核心功能已稳定，适合进行技术债务清理
- 已有 Vitest 测试套件（160+ tests）可用于回归验证

## Functional Requirements

### 🔴 高风险（必须修复）
- **FR-1**: settings.ts XSS 安全加固——优先处理用户输入路径（`addToggleRow`/`addSliderRow` 的 label、软件管理用户输入名称等），后端已校验数据可延后
- **FR-2**: model-preset.ts 中 `applyPresetFromLib` 改造，`loadPMXFile` 返回模型 ID 后直接使用，替代路径查找
- **FR-3**: model-preset.ts 中 `ModelPresetFile` 新增 `materialEnabled` 字段，序列化/反序列化材质启用状态

### 🟡 中等优先级
- **FR-4**: motion-popup.ts + scene-menu.ts 异步加载添加占位 UI（改动小，用户感知强）
- **FR-5**: scene-env-bridge.ts `beforeunload` 状态持久化验证（如已实现则跳过，不白干）
- **FR-6**: scene-loader.ts 缩略图捕获改用 `scene.whenReadyAsync()` 替代双 rAF
- **FR-7**: xpbd-cloth.ts 中 `_updateClothMesh` 的 `Float32Array` 缓存复用
- **FR-8**: xpbd-collider.ts 移除每帧冗余的方向向量归一化
- **FR-9**: cloth-manager.ts `recreateCloth` 在 `clothEnabled=false` 时明确返回值/提示
- **FR-10**: scene-env-bridge.ts `_timeOfDayTick` 加调用阈值，减少 `redoEnvAutoLink` 调用
- **FR-11**: library-core.ts `refreshLibrary` 记录并恢复导航深度
- **FR-12**: model-detail.ts 变换面板滑条随外部修改自动刷新
- **FR-13**: scene-lighting.ts 阴影渐隐——先确认 `ShadowGenerator` 是否支持 `intensity` 属性再决定实现方案
- **FR-14**: library-core.ts 大量模型列表构建 rAF 分片渲染，避免卡顿
- **FR-15**: model-detail.ts `buildModelInfoLevel` 边缘场景 null safety 补全（主路径已修）

### 🟢 低优先级（高收益项）
- **FR-16**: motion-popup.ts 回调中 `motionMenu` 空引用防护
- **FR-17**: camera.ts Concert 模式改用 `scene.deltaTime` 替代硬编码帧时间
- **FR-18**: 清理各模块未使用导入（scene-env-impl.ts、model-material.ts、library-core.ts）
- **FR-19**: xpbd-collider.ts `updateCapsuleSizes` 接入 cloth-manager 实际调用
- **FR-20**: scene-env-water.ts 焦散纹理缓存复用，切换粒子类型时不重复生成
- **FR-21**: env-menu.ts `buildPropDetailLevel` 5 个滑块提取为配置循环
- **FR-22**: menu.ts 过渡时间统一为 CSS 常量
- **FR-23**: outfit-ui.ts 点击变体后添加 loading 视觉反馈
- **FR-24**: procedural-motion.ts 眨眼候选不匹配时加 `console.debug` 提示

## Non-Functional Requirements
- **NFR-1**: 所有改动通过 `tsc --noEmit` 零错误
- **NFR-2**: 所有改动通过 `vite build` 构建成功
- **NFR-3**: 现有 Vitest 测试套件全部通过（160+ tests）
- **NFR-4**: 性能优化项有可测量的改进（如内存分配减少、帧率提升）
- **NFR-5**: 代码风格与现有项目保持一致（遵循 terminology.md 规范）
- **NFR-6**: 新增/修改的公共 API 有 JSDoc 注释

## Constraints
- **Technical**: TypeScript + Babylon.js + Wails Go 后端，不能引入新的大型依赖
- **Business**: 本次为技术债务清理，不新增用户可见功能（UI 微调除外）
- **Dependencies**: 依赖现有测试套件验证回归，不新增测试框架

## Assumptions
- 高风险 3 项全部处理，中等 15 项全部处理，低优 30 项中筛选约 9 项高收益项处理
- settings.ts 的 XSS 加固优先处理用户输入路径，后端已校验数据的 innerHTML 延后
- `loadPMXFile` 被 5+ 处调用（拖拽导入/onModelRowClick/applyPresetFromLib/replaceModel 等），改前先 grep 全量确认
- 阴影渐隐需先验证 babylon-mmd 的 `ShadowGenerator` 是否支持 `intensity` 属性，不支持则降级为用 `shadowBias` 或透明度贴图方案
- `beforeunload` 兜底可能已在近期修复中实现（status.md 有相关记录），先验证再决定是否处理
- model-detail null safety 主路径已修，仅剩边缘场景补全，降为低优先级工作量

## Acceptance Criteria

### AC-1: XSS 安全隐患消除
- **Given**: settings.ts 中存在数十处 `innerHTML` 字符串拼接
- **When**: 完成重构，所有动态内容改用 `createElement` + `textContent` 或 `escapeHtml`
- **Then**: 搜索 `innerHTML` 仅出现于安全的静态模板场景；用户输入内容均经过转义
- **Verification**: `programmatic`（grep 检查 + 人工 code review）
- **Notes**: 需确保功能完全等价，无样式/交互回归

### AC-2: 预设加载路径匹配改造
- **Given**: `applyPresetFromLib` 通过路径查找已加载模型
- **When**: 改造 `loadPMXFile` 返回模型 ID，预设加载直接使用返回值
- **Then**: 预设应用不再依赖路径匹配，加载成功率 100%
- **Verification**: `programmatic`（model-preset 测试通过 + 手动验证）

### AC-3: 材质可见性序列化
- **Given**: `ModelPresetFile` 缺少 `materialEnabled` 字段
- **When**: 新增字段并完善序列化/反序列化逻辑
- **Then**: 保存的预设能正确恢复材质启用/禁用状态
- **Verification**: `programmatic`（扩展 model-preset 测试用例）

### AC-4: 缩略图捕获时机优化
- **Given**: 缩略图捕获使用双 rAF，低端 GPU 可能过早
- **When**: 改用 `scene.whenReadyAsync()` 等待场景就绪
- **Then**: 缩略图捕获成功率提升，低端设备不出现黑屏缩略图
- **Verification**: `human-judgment`（视觉验证缩略图质量）

### AC-5: 布料网格更新性能优化
- **Given**: `_updateClothMesh` 每帧分配 `new Float32Array`
- **When**: 实现缓存复用
- **Then**: 布料模拟时每帧内存分配减少，GC 压力降低
- **Verification**: `programmatic`（代码审查确认无新分配 + 性能测试）

### AC-6: 加载占位体验
- **Given**: async renderCustom 无加载占位，后端慢时空白闪烁
- **When**: 添加加载状态占位 UI
- **Then**: 异步加载期间显示「加载中…」提示，无空白闪烁
- **Verification**: `human-judgment`（视觉验证加载状态）

### AC-7: 阴影渐隐过渡
- **Given**: `dirIntensity<0.1` 时阴影突然消失；且 `ShadowGenerator` 支持 `intensity` 属性
- **When**: 实现阴影强度随方向光强度渐变
- **Then**: 方向光强度变化时阴影平滑过渡，无突然跳变
- **Verification**: `human-judgment`（视觉验证过渡效果）
- **Notes**: 若 `ShadowGenerator` 不支持 `intensity`，则降级为 shadowBias 渐变或其他方案

### AC-8: 构建验证
- **Given**: 完成所有改动
- **When**: 运行 `tsc --noEmit` 和 `vite build`
- **Then**: 零错误，构建成功
- **Verification**: `programmatic`

### AC-9: 测试通过
- **Given**: 完成所有改动
- **When**: 运行 `vitest run`
- **Then**: 所有现有测试通过，新增测试覆盖新功能
- **Verification**: `programmatic`

## Open Questions
- [ ] 低优先级 30 项中具体处理哪些？是否需要用户筛选？
- [ ] settings.ts XSS 重构是否需要分阶段（先转义后重构）？
- [ ] library-core.ts 导航深度恢复是否涉及 UX 决策？
