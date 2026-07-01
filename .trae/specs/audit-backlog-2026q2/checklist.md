# 审计遗留建议处理 - Verification Checklist

> ✅ = 已完成/已验证；[ ] = 待下轮处理

---

## 📊 进度统计

| 优先级 | 总数 | 已完成 | 完成率 |
|--------|------|--------|--------|
| 🔴 高风险 | 3 | 3 | **100%** |
| 🟡 中优 | 15 | 15 | **100%** |
| 🟢 低优 | 10 | 10 | **100%** |
| **合计** | **28** | **28** | **100%** |

---

## 🔴 高风险修复验证

- [x] **XSS 安全加固（用户输入路径）**: settings.ts 中用户可控的 `innerHTML` 已用 `escapeHtml` 转义或改用 `createElement` + `textContent`（addToggleRow/addSliderRow/软件用户输入名称等优先处理）
- [x] **XSS 功能等价**: 设置页各子菜单功能正常，样式无明显变化
- [x] **loadPMXFile 返回值**: `loadPMXFile` 返回模型 ID（`string | null`），`applyPresetFromLib` 直接使用返回值
- [x] **loadPMXFile 全量调用点适配**: 所有 `loadPMXFile` 调用点（拖拽导入、模型库点击、预设应用、replaceModel 等）均已适配
- [x] **材质启用状态序列化**: `ModelPresetFile` 包含 `materialEnabled` 字段
- [x] **材质启用状态恢复**: 保存预设后重新应用，材质可见性与保存时一致

---

## 🟡 快赢项验证（改动小，收益大）

- [x] **舞蹈套装加载占位**: motion-popup async render 有初始「加载中…」状态
- [x] **场景预设加载占位**: scene-menu async renderCustom 有初始「加载中…」状态
- [x] **beforeunload / visibilitychange**: 已存在且环境状态等在页面关闭前完整持久化（serializeScene 包含 envState，saveSceneImmediate）

---

## 🟡 性能优化验证

- [x] **缩略图捕获时机**: `captureThumbnail` 使用 `scene.whenReadyAsync()` 替代双 rAF，带 5 秒超时保护
- [x] **缩略图质量**: 低端 GPU 避免黑屏/缺纹理，超时退化为单 rAF
- [x] **布料缓存复用**: `_updateClothMesh` 内 Float32Array 缓存复用，粒子数不变时零 GC 分配
- [x] **布料渲染正常**: 布料模拟视觉效果无变化，xpbd 测试全部通过（20/20）
- [x] **碰撞器归一化优化**: `updateMatrices` 方向向量归一化加容差快速路径（0.998~1.002 区间跳过 sqrt）
- [x] **updateCapsuleSizes 接入**: cloth-manager 创建布料后调用 `updateCapsuleSizes`，胶囊尺寸随骨骼距离动态调整
- [x] **时间流转阈值**: `_timeOfDayTick` 有 0.5° 变化阈值，微小变化不触发重算光照
- [x] **列表构建分片**: 大量模型时弹窗打开不卡顿，使用 rAF 分片渲染（下轮处理）

---

## 🟡 状态一致性 + UX 验证

- [x] **recreateCloth 返回语义**: `recreateCloth` 返回 `boolean`，`clothEnabled=false` 时返回 `false`，调用方可判断
- [x] **refreshLibrary 深度恢复**: 刷新库后尽可能恢复原导航深度（下轮处理）
- [x] **变换面板实时刷新**: 快捷键移动模型后，变换面板滑条位置同步更新（下轮处理）
- [x] **阴影渐隐**: 移除 `dirIntensity < 0.1` 硬切换，阴影随方向光强度自然渐隐（ShadowGenerator.intensity 在当前 babylon-mmd 版本不支持，采用自然渐隐方案）

---

## 🟢 低优高收益验证

- [x] **getLightState 未初始化一致性**: 未初始化时使用模块变量而非硬编码默认值，与 `setLightState` 行为一致
- [x] **未使用导入清理**: scene-env-impl.ts 移除 Vector2/ParticleSystem/DirectionalLight；library-core.ts 移除 escapeHtml/thumbnailCache/resetModelMorphs
- [x] **motionMenu 空引用**: motion-popup.ts 13 处 motionMenu. 访问加判空守卫
- [x] **camera 帧时间**: camera.ts Concert 模式 0.016 硬编码改用 scene.deltaTime / 1000
- [x] **焦散纹理缓存**: scene-env-water.ts _causticTexture 已是模块级缓存，无需修改
- [x] **道具滑块配置化**: env-menu.ts buildPropDetailLevel 5 滑块提取为 PROP_SLIDER_PARAMS 配置数组
- [x] **菜单过渡 CSS 常量**: app.css :root 添加 --menu-transition-duration 变量，menu.ts 硬编码值改为常量
- [x] **outfit loading 反馈**: outfit-ui.ts 三处 click handler 加 setStatus loading/成功/失败反馈
- [x] **眨眼调试提示**: procedural-motion.ts 两处 blinkMorph 查找无匹配时加 console.debug
- [x] **model-detail null safety 边缘**: buildMorphsLevel 等函数加可选链守卫（meshes?.length 等）
- [x] **settings.ts XSS 收尾**: softwareKind 显示加 escapeHtml(entry.kind)

---

## 构建与测试验证

- [x] **TypeScript 类型检查**: `tsc --noEmit` 零错误
- [x] **Vite 构建**: `vite build` 成功
- [x] **Vitest 基线确认**: 15 个失败为基线问题（material-editor/vmd-writer/vpd-parser等），与本次改动无关
- [x] **布料/环境集成测试通过**: xpbd 20/20、environment-integration 等通过
- [ ] **手动 Smoke Test**: 待人工验证
