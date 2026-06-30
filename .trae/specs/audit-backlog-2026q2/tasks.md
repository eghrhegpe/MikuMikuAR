# 审计遗留建议处理 - The Implementation Plan (Decomposed and Prioritized Task List)

---

## 第一阶段：🔴 高风险修复（3 项）

### [x] Task 1: settings.ts XSS 安全加固（用户输入路径优先）
- **Priority**: high
- **Depends On**: None
- **Description**: 
  - 先 grep 确认 settings.ts 中所有 `innerHTML` 使用点，按攻击面分级
  - **高风险优先处理**：`addToggleRow`/`addSliderRow` 的 label 参数、软件管理用户输入名称、外部库路径显示
  - 后端已校验数据（`SoftwareEntry`、`ExternalPath` 等）的 innerHTML 延后处理
  - 方案：用户可控字符串统一使用 `escapeHtml` 转义；动态结构改用 `createElement` + `textContent`
- **Acceptance Criteria Addressed**: AC-1, AC-8, AC-9
- **Test Requirements**:
  - `programmatic` TR-1.1: grep 确认用户输入相关的 innerHTML 已全部转义或重构
  - `programmatic` TR-1.2: `tsc --noEmit` 零错误，`vite build` 成功
  - `human-judgement` TR-1.3: 设置页各子菜单功能正常，样式无明显变化
- **Notes**: 不追求 100% 消除 innerHTML，先堵住用户输入攻击面

### [x] Task 2: loadPMXFile 返回模型 ID，改造预设加载路径
- **Priority**: high
- **Depends On**: None
- **Description**:
  - **第一步**：grep 全量确认 `loadPMXFile(` 所有调用点（拖拽导入、onModelRowClick、applyPresetFromLib、replaceModel 等）
  - **第二步**：`loadPMXFile` 改为返回 `Promise<string | null>`（模型 ID）
  - **第三步**：`applyPresetFromLib` 直接使用返回的模型 ID，替代路径匹配查找
  - **第四步**：同步适配所有其他调用点
- **Acceptance Criteria Addressed**: AC-2, AC-8, AC-9
- **Test Requirements**:
  - `programmatic` TR-2.1: model-preset 测试全部通过
  - `programmatic` TR-2.2: 所有 `loadPMXFile` 调用点均已适配返回值
  - `human-judgement` TR-2.3: 从模型库应用预设功能正常，拖拽加载、模型库点击等均正常
- **Notes**: 改动影响面大，务必先全量 grep 确认调用点

### [x] Task 3: 材质启用状态序列化（materialEnabled）
- **Priority**: high
- **Depends On**: None
- **Description**:
  - `ModelPresetFile` 新增 `materialEnabled: Record<string, boolean>` 字段
  - `serializeModelPreset` 中收集材质启用状态
  - `applyModelPreset` 中恢复材质启用状态
  - 扩展 model-preset 测试用例验证序列化/反序列化正确性
- **Acceptance Criteria Addressed**: AC-3, AC-8, AC-9
- **Test Requirements**:
  - `programmatic` TR-3.1: 新增材质启用状态序列化测试用例并通过
  - `programmatic` TR-3.2: 预设 JSON 中包含 `materialEnabled` 字段
  - `human-judgement` TR-3.3: 保存→应用预设后材质可见性与保存时一致
- **Notes**: 材质标识使用材质名，与现有材质系统一致

---

## 第二阶段：🟡 快赢项 + 验证项（改动小，收益大）

### [x] Task 4: 异步加载占位 UI（motion-popup + scene-menu）
- **Priority**: medium
- **Depends On**: None
- **Description**:
  - motion-popup.ts `buildDanceSetsOverviewLevel` async render 前显示加载占位
  - scene-menu.ts `buildPresetScenesLevel` 同样添加加载占位
  - 统一使用「加载中…」样式
- **Acceptance Criteria Addressed**: AC-6, AC-8
- **Test Requirements**:
  - `programmatic` TR-4.1: 两个 async renderCustom 均有初始加载状态
  - `human-judgement` TR-4.2: 慢速下可见加载提示，无空白闪烁
- **Notes**: 改动小，用户感知强，优先做

### [x] Task 5: beforeunload 状态持久化验证 + 补全
- **Priority**: medium
- **Depends On**: None
- **Description**:
  - 先验证 `scene-serialize.ts` 中是否已有 `beforeunload` / `visibilitychange` 监听
  - 如已有：检查是否覆盖环境状态（envState）的持久化，不足则补
  - 如未有：新增 `beforeunload` + `visibilitychange` 监听，调用 `saveSceneImmediate()`
- **Acceptance Criteria Addressed**: AC-8
- **Test Requirements**:
  - `programmatic` TR-5.1: 存在 `beforeunload` / `visibilitychange` 监听器
  - `programmatic` TR-5.2: 关闭窗口前环境状态等完整持久化
- **Notes**: status.md 显示可能已修场景序列化的 beforeunload，需确认环境状态是否也覆盖

---

## 第三阶段：🟡 性能优化（5 项）

### [x] Task 6: 缩略图捕获时机优化（whenReadyAsync）
- **Priority**: medium
- **Depends On**: None
- **Description**:
  - scene-loader.ts 中 `captureThumbnail` 改用 `scene.whenReadyAsync()` 替代双 rAF
  - 确保纹理、阴影等全部就绪后再截图
  - 设置超时保护，避免低端设备等待过久
- **Acceptance Criteria Addressed**: AC-4, AC-8
- **Test Requirements**:
  - `programmatic` TR-6.1: 代码中双 rAF 模式已移除
  - `human-judgement` TR-6.2: 缩略图无黑屏/缺纹理现象
- **Notes**: 低端 GPU 需超时兜底

### [x] Task 7: 布料网格更新 Float32Array 缓存复用
- **Priority**: medium
- **Depends On**: None
- **Description**:
  - xpbd-cloth.ts `_updateClothMesh` 中 `new Float32Array` 改为复用缓存
  - 粒子数量变化时才重新分配
  - positions / normals / uvs 三个数组分别缓存
- **Acceptance Criteria Addressed**: AC-5, AC-8
- **Test Requirements**:
  - `programmatic` TR-7.1: `_updateClothMesh` 内无每帧 `new Float32Array`（初始化除外）
  - `programmatic` TR-7.2: 布料模拟测试全部通过
  - `human-judgement` TR-7.3: 布料渲染正常
- **Notes**: 注意粒子数变化时的缓存重建

### [x] Task 8: 碰撞器优化 + updateCapsuleSizes 接入 cloth-manager
- **Priority**: medium
- **Depends On**: None
- **Description**:
  - xpbd-collider.ts `updateMatrices` 移除冗余的方向向量归一化（骨骼 Y 轴通常已是单位向量）
  - cloth-manager.ts 实际调用 `updateCapsuleSizes`，使身体胶囊尺寸随骨骼缩放动态调整
- **Acceptance Criteria Addressed**: AC-8
- **Test Requirements**:
  - `programmatic` TR-8.1: `updateMatrices` 中无冗余归一化调用
  - `programmatic` TR-8.2: cloth-manager 创建布料后调用 `updateCapsuleSizes`
  - `human-judgement` TR-8.3: 布料碰撞检测正常，模型缩放后碰撞体正确跟随
- **Notes**: 两项合并，同属 xpbd 模块

### [x] Task 9: 时间流转阈值优化
- **Priority**: medium
- **Depends On**: None
- **Description**:
  - scene-env-bridge.ts `_timeOfDayTick` 增加太阳角变化阈值
  - 微小变化（< 0.5°）不触发 `redoEnvAutoLink`
  - 减少不必要的光照重算
- **Acceptance Criteria Addressed**: AC-8
- **Test Requirements**:
  - `programmatic` TR-9.1: `_timeOfDayTick` 有阈值判断逻辑
  - `human-judgement` TR-9.2: 时间流转时光照过渡流畅，无卡顿感
- **Notes**: 阈值建议 0.5°，平衡性能与流畅度

### [x] Task 10: 库列表构建 rAF 分片渲染
- **Priority**: medium
- **Depends On**: None
- **Description**:
  - library-core.ts 大量模型列表构建时使用 rAF 分片渲染
  - 先渲染首屏（~30 项），后续渐进补充
  - 避免一次性 DOM 操作导致主线程卡顿
- **Acceptance Criteria Addressed**: AC-8
- **Test Requirements**:
  - `programmatic` TR-10.1: 列表构建使用 requestAnimationFrame 分片
  - `human-judgement` TR-10.2: 大量模型（1000+）时弹窗打开不卡顿
- **Notes**: 轻量方案，不做完整虚拟滚动

---

## 第四阶段：🟡 状态一致性 + UX（4 项）

### [x] Task 11: cloth-manager recreateCloth 明确返回语义
- **Priority**: medium
- **Depends On**: None
- **Description**:
  - `recreateCloth` 在 `clothEnabled=false` 时不再静默返回
  - 改为返回 boolean 表示是否成功重建
  - UI 层根据返回值给出相应提示
- **Acceptance Criteria Addressed**: AC-8
- **Test Requirements**:
  - `programmatic` TR-11.1: `recreateCloth` 有明确返回值
  - `human-judgement` TR-11.2: 布料关闭时调用重建操作有明确反馈
- **Notes**: 调用方先检查状态也可，返回值更清晰

### [x] Task 12: refreshLibrary 导航深度恢复
- **Priority**: medium
- **Depends On**: None
- **Description**:
  - library-core.ts `refreshLibrary` 记录当前导航路径（面包屑层级）
  - 刷新后尝试恢复到原深度的对应层级
  - 如原路径不存在则回退到顶层
- **Acceptance Criteria Addressed**: AC-8
- **Test Requirements**:
  - `human-judgement` TR-12.1: 在子目录下刷新库后，尽可能回到原目录层级
  - `human-judgement` TR-12.2: 原目录不存在时正确回退，不崩溃
- **Notes**: UX 改进，原设计是强制回顶层。如不需要可跳过

### [x] Task 13: 变换面板滑条实时刷新
- **Priority**: medium
- **Depends On**: None
- **Description**:
  - model-detail.ts 变换面板滑条监听模型变化事件
  - 外部修改（快捷键/预设等）后自动刷新滑条值
  - 使用 `mmku:modelChanged` 或类似事件机制
  - 注意避免滑条拖动时自身触发的更新导致循环
- **Acceptance Criteria Addressed**: AC-8
- **Test Requirements**:
  - `human-judgement` TR-13.1: 用快捷键移动模型后，变换面板滑条位置同步更新
  - `human-judgement` TR-13.2: 应用预设后变换面板值与预设一致
- **Notes**: 需防循环更新

### [x] Task 14: 阴影渐隐（先验证 ShadowGenerator intensity）
- **Priority**: medium
- **Depends On**: None
- **Description**:
  - **第一步**：验证 babylon-mmd 的 `ShadowGenerator` 是否支持 `intensity` 属性
  - **支持**：实现阴影强度随 `dirIntensity` 渐变，`dirIntensity < 0.1` 时平滑淡出
  - **不支持**：降级方案（如 shadowBias 渐变、或用透明度贴图），记录结论后跳过
  - 与 `transitionLighting` 动画机制协调
- **Acceptance Criteria Addressed**: AC-7, AC-8
- **Test Requirements**:
  - `programmatic` TR-14.1: `ShadowGenerator` 能力已验证并有记录
  - `human-judgement` TR-14.2: 方向光强度变化时阴影平滑过渡（如支持）
- **Notes**: 先验证再实现，不做无用功

---

## 第五阶段：🟢 低优高收益（10 项）

### [ ] Task 15: 清理未使用导入
- **Priority**: low
- **Depends On**: None
- **Description**:
  - scene-env-impl.ts: 移除 `Vector2`, `ParticleSystem`, `DirectionalLight` 等未使用导入
  - model-material.ts: 移除未使用的 `Material`、`StandardMaterial`
  - library-core.ts: 移除未使用的 `escapeHtml`、`thumbnailCache`、`resetModelMorphs` 等
  - 其他文件一并审查清理
- **Acceptance Criteria Addressed**: AC-8, AC-9
- **Test Requirements**:
  - `programmatic` TR-15.1: `tsc --noEmit` 零错误
  - `programmatic` TR-15.2: ESLint `no-unused-vars` 告警减少
- **Notes**: 使用 ESLint 辅助检查

### [x] Task 16: motionMenu 空引用防护
- **Priority**: low
- **Depends On**: None
- **Description**:
  - motion-popup.ts 所有回调中访问 `motionMenu` 前先判空
  - `if (menu) menu.reRender()` 模式统一
- **Acceptance Criteria Addressed**: AC-8
- **Test Requirements**:
  - `programmatic` TR-16.1: 所有 `motionMenu.` 访问均有判空守卫
- **Notes**: 防御性编程

### [ ] Task 17: camera.ts 帧时间规范化
- **Priority**: low
- **Depends On**: None
- **Description**:
  - Concert 模式 `0.016` 硬编码改用 `scene.deltaTime / 1000`
  - 帧率波动时动画速度更准确
- **Acceptance Criteria Addressed**: AC-8
- **Test Requirements**:
  - `programmatic` TR-17.1: 无硬编码 `0.016` 帧时间
  - `human-judgement` TR-17.2: Concert 模式相机运动正常
- **Notes**: 小改动，正确性提升

### [ ] Task 18: 焦散纹理缓存复用
- **Priority**: low
- **Depends On**: None
- **Description**:
  - scene-env-water.ts `_causticTexture` 全局缓存
  - 切换粒子类型时不重复生成焦散纹理
  - disposeWater 中正确释放缓存
- **Acceptance Criteria Addressed**: AC-8
- **Test Requirements**:
  - `programmatic` TR-18.1: 切换粒子类型不重新生成焦散纹理
  - `human-judgement` TR-18.2: 水面焦散效果正常
- **Notes**: 注意不同水面预设是否需要不同焦散纹理

### [ ] Task 19: env-menu 道具滑块配置化
- **Priority**: low
- **Depends On**: None
- **Description**:
  - env-menu.ts `buildPropDetailLevel` 中 5 个滑块提取为配置数组循环渲染
  - 减少重复代码，便于后续扩展
- **Acceptance Criteria Addressed**: AC-8
- **Test Requirements**:
  - `programmatic` TR-19.1: 滑块配置数组化，无重复代码
  - `human-judgement` TR-19.2: 道具详情面板功能与之前完全一致
- **Notes**: 纯代码质量改进

### [ ] Task 20: menu.ts 过渡时间 CSS 常量
- **Priority**: low
- **Depends On**: None
- **Description**:
  - SlideMenu 过渡时间从硬编码 `0.12s`/`0.15s` 改为 CSS 变量
  - 在 `:root` 中定义 `--menu-transition-duration` 等常量
- **Acceptance Criteria Addressed**: AC-8
- **Test Requirements**:
  - `programmatic` TR-20.1: JS 中无硬编码过渡时间数值
  - `human-judgement` TR-20.2: 菜单动画速度与之前一致
- **Notes**: 便于主题系统统一调节

### [x] Task 21: outfit-ui 变体切换 loading 反馈
- **Priority**: low
- **Depends On**: None
- **Description**:
  - outfit-ui.ts 点击服装变体后显示 loading 状态
  - 应用完成/失败后恢复
  - 状态栏提示同步
- **Acceptance Criteria Addressed**: AC-8
- **Test Requirements**:
  - `human-judgement` TR-21.1: 点击变体按钮有视觉反馈（禁用态/loading 图标）
  - `human-judgement` TR-21.2: 应用失败有错误提示
- **Notes**: 提升用户体验

### [ ] Task 22: procedural-motion 眨眼调试提示
- **Priority**: low
- **Depends On**: None
- **Description**:
  - `MORPH_BLINK_CANDIDATES` 不匹配时加 `console.debug` 提示
  - 便于开发者排查眨眼不工作的问题
- **Acceptance Criteria Addressed**: AC-8
- **Test Requirements**:
  - `programmatic` TR-22.1: 无匹配 morph 时有 debug 日志
- **Notes**: 用 `console.debug`，不干扰正常输出

### [x] Task 23: model-detail null safety 边缘场景补全
- **Priority**: low
- **Depends On**: None
- **Description**:
  - 主路径已修，复查 model-detail.ts 其余潜在 null 访问点
  - Stage 模型等特殊模型类型确保不会崩溃
  - 扩展到整个文件的其他边缘场景
- **Acceptance Criteria Addressed**: AC-8
- **Test Requirements**:
  - `programmatic` TR-23.1: 无直接访问可能为 null 的属性（均有可选链或守卫）
  - `human-judgement` TR-23.2: 加载 Stage 等特殊模型时详情页不崩溃
- **Notes**: 主路径已修，降为低优收尾

### [ ] Task 24: settings.ts XSS 加固（收尾：后端已校验数据）
- **Priority**: low
- **Depends On**: Task 1
- **Description**:
  - 完成 Task 1 未处理的后端已校验数据的 innerHTML
  - 全面复查，确保无高风险遗漏
  - 提取通用 DOM 构建 helper（可选，看收益）
- **Acceptance Criteria Addressed**: AC-1, AC-8
- **Test Requirements**:
  - `programmatic` TR-24.1: settings.ts 中 innerHTML 使用均为安全场景
  - `human-judgement` TR-24.2: 设置页所有功能正常
- **Notes**: Task 1 的收尾工作，时间充足则做

---

## 第六阶段：验证与收尾

### [ ] Task 25: 全量回归测试 + 构建验证
- **Priority**: high
- **Depends On**: Task 1-24
- **Description**:
  - 运行完整 Vitest 测试套件
  - 运行 `tsc --noEmit`
  - 运行 `vite build`
  - 手动 smoke test 关键路径（模型加载/预设应用/环境切换/布料模拟）
- **Acceptance Criteria Addressed**: AC-8, AC-9
- **Test Requirements**:
  - `programmatic` TR-25.1: 所有测试通过
  - `programmatic` TR-25.2: 构建零错误
  - `human-judgement` TR-25.3: 关键路径手动测试通过
- **Notes**: 最后一道质量关卡
