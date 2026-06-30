# 审计遗留建议处理 - Verification Checklist

> ✅ = 近期已修复，本次仅复查；[ ] = 本次待处理

---

## 🔴 高风险修复验证

- [ ] **XSS 安全加固（用户输入路径）**: settings.ts 中用户可控的 `innerHTML` 已用 `escapeHtml` 转义或改用 `createElement` + `textContent`
- [ ] **XSS 功能等价**: 设置页各子菜单（界面/系统/外部库/软件等）功能正常，样式无明显变化
- [ ] **loadPMXFile 返回值**: `loadPMXFile` 返回模型 ID，`applyPresetFromLib` 直接使用返回值
- [ ] **loadPMXFile 全量调用点适配**: 所有 `loadPMXFile` 调用点（拖拽导入、模型库点击、预设应用、replaceModel 等）均已适配
- [ ] **材质启用状态序列化**: `ModelPresetFile` 包含 `materialEnabled` 字段
- [ ] **材质启用状态恢复**: 保存预设后重新应用，材质可见性与保存时一致

---

## 🟡 快赢项验证（改动小，收益大）

- [ ] **舞蹈套装加载占位**: motion-popup async render 有初始加载状态
- [ ] **场景预设加载占位**: scene-menu async renderCustom 有初始加载状态
- [ ] **beforeunload / visibilitychange**: 环境状态等在页面关闭前完整持久化（如已有则复查确认）

---

## 🟡 性能优化验证

- [ ] **缩略图捕获时机**: `captureThumbnail` 使用 `scene.whenReadyAsync()` 替代双 rAF
- [ ] **缩略图质量**: 缩略图无黑屏/缺纹理现象
- [ ] **布料缓存复用**: `_updateClothMesh` 内无每帧 `new Float32Array`（初始化除外）
- [ ] **布料渲染正常**: 布料模拟视觉效果无变化，测试全部通过
- [ ] **碰撞器归一化优化**: `updateMatrices` 移除冗余方向向量归一化
- [ ] **updateCapsuleSizes 接入**: cloth-manager 创建布料后调用 `updateCapsuleSizes`，模型缩放后碰撞体正确跟随
- [ ] **时间流转阈值**: `_timeOfDayTick` 有变化阈值（~0.5°），微小变化不触发重算光照
- [ ] **列表构建分片**: 大量模型时弹窗打开不卡顿，使用 rAF 分片渲染

---

## 🟡 状态一致性 + UX 验证

- [ ] **recreateCloth 返回语义**: `recreateCloth` 在 `clothEnabled=false` 时有明确返回值/提示，不静默失败
- [ ] **refreshLibrary 深度恢复**: 刷新库后尽可能恢复原导航深度，原路径不存在时正确回退
- [ ] **变换面板实时刷新**: 快捷键移动模型后，变换面板滑条位置同步更新
- [ ] **阴影渐隐**: ShadowGenerator 支持 intensity 时，方向光强度降低时阴影平滑淡出；不支持时有降级方案记录

---

## 🟢 低优高收益验证

- [ ] **未使用导入清理**: scene-env-impl.ts / model-material.ts / library-core.ts 等文件无未使用导入
- [ ] **motionMenu 空引用**: motion-popup 所有回调访问 `motionMenu` 前均有判空守卫
- [ ] **camera 帧时间**: Concert 模式使用 `scene.deltaTime` 替代硬编码 `0.016`
- [ ] **焦散纹理缓存**: 切换粒子类型不重复生成焦散纹理
- [ ] **道具滑块配置化**: `buildPropDetailLevel` 滑块使用配置数组循环，无重复代码
- [ ] **菜单过渡 CSS 常量**: SlideMenu 过渡时间使用 CSS 变量，JS 中无硬编码数值
- [ ] **outfit loading 反馈**: 点击服装变体按钮有 loading 视觉反馈
- [ ] **眨眼调试提示**: 无匹配 blink morph 时有 `console.debug` 提示
- [ ] **model-detail null safety 边缘**: Stage 等特殊模型加载时详情页不崩溃（主路径 ✅已修，补边缘）
- [ ] **settings.ts XSS 收尾**: 后端已校验数据的 innerHTML 场景也已加固（时间充足时做）

---

## 构建与测试验证

- [ ] **TypeScript 类型检查**: `tsc --noEmit` 零错误
- [ ] **Vite 构建**: `vite build` 成功，无新增 warning
- [ ] **Vitest 测试**: 所有现有测试通过（160+ tests）
- [ ] **新增测试覆盖**: 材质启用序列化等新功能有对应测试
- [ ] **手动 Smoke Test**: 关键路径（加载模型/应用预设/环境切换/布料模拟）正常工作
