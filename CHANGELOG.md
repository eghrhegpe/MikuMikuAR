# Changelog

## v1.10.2 (2026-07-25)

### 🐛 修复

- **UI 稳定性大修**：async 点击守卫统一迁移（guard/guardedRun），覆盖材质/表情重灾区
- **UI 过渡期防护**：renderCustom async handler 补 transitioning 守卫（P0）
- **UI 视图切换**：补 transitioning 守卫 + seq-guard 测试类型修复
- **UI 孤儿节点防护**：toast/fullscreen/watchDir 相邻组件过渡期保护
- **UI seq guard 兜底**：过期时自动恢复，修复面板 opacity 卡 0 卡死
- **UI 鼠标竞态**：headerToggle folder 行补双守卫 + 抑制 renderCustom 级全量重建
- **UI 菜单 folder 竞态**：补过渡锁，修复鼠标 async 竞态
- **UI 弹窗重建**：被 closeAllOverlays 回收后无法重建，复用前校验容器挂载
- **Android 打包**：修复 mjs 打包链审核出的 3 个真 bug + Y 类全量修复 + EnvState 漂移
- **Android WebView 崩溃**：移除 ES2025 `using` 语法，修复启动崩溃
- **ADR 工具链**：统一 adr-258 文件名小写 + 同步链接引用
- **ADR 分类词表**：补「参考文档」归档识别，消除 check-adr-status 假红
- **tsc/lint/vitest 缓存**：修复路径+内容哈希漏洞
- **ADR 首部状态字段**：补全缺失字段

### ✨ 新功能

- **菜单 testid 钩子**：脚本/浏览器代理可稳定定位 UI 元素
- **安卓打包脚本**：新增纯 Node 安卓打包/安装脚本（android-build/install）
- **菜单可访问化**：标题栏返回按钮可被 AI/OCR 探测

### 🎨 重构

- **诊断面板无障碍**：diagnostic-control / diagnostic-session 属性收敛到 dom-contract 常量
- **aria/role 常量收敛**：统一归入 dom-contract
- **pre-commit**：精准 stage + pre-push 移除 amend，消除捎带文件风险
- **pre-push 输出精简**：移除跳过项的头行冗余（35→31 行）

### ⚡ 性能

- **pre-push 并行化**（A∥C 组），省 ~18% 耗时
- **pre-push 结果缓存**（ADR-259/260）
- **lint 增量扫描**：16s → 2-3s
- **pre-push 去死码**：移除 deadcode 检查（对用户无影响）

### 🧪 测试

- **ADR-262 隔离修复**：vi.mock 污染机制定稿 + 静态护栏
- **30+ 测试文件切 node 环境**：79 用例全绿验证
- **schema-snapshot 切 node**：load-refresh-registry 解耦 window
- **setup-wails.ts node 兜底**：rAF + localStorage 兼容
- **library-core-mocks**：加 node 兼容 helper

### 📖 文档

- ADR-258 系列：pre-push 门禁分层、正反方辩论、三方锐评修订
- ADR-259/260：近期优化演进记录
- ADR-261：测试环境分流实证修正
- ADR-262：实证节 + 技术债务扫描

---

## v1.10.1

(此前版本记录)