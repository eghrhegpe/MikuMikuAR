# ADR-011: Wails v3 迁移评估与决策

**日期**：2026-07-03（初版），2026-07-（迁移完成）
> **状态**: 已完成 — 已迁至 Wails v3，项目当前运行于 v3 构建管线

---

## 背景

项目初始使用 Wails v2.12.0。2026-07-03 评估 v3 以解决下载功能（WebView2 `DownloadStarting` 事件）和 Android 适配需求。

**关键发现**：
- v3 不解决下载问题（底层 WebView2 库与 v2 相同）
- v3 Android 路径已打通（JNI + WebViewAssetLoader），但 [#5020](https://github.com/wailsapp/wails/issues/5020) 等 P1 issue 未解
- 迁移成本估计 7-9 天

## 决定与演进

| 阶段 | 决策 | 后续 |
|------|------|------|
| **初始决策** | 继续使用 Wails v2，Android 路径两阶段推进（①前端抽象层 ②~~待定~~ → ✅ 已解决：v3 迁移后 Android 通过 `CanChooseDirectories(true)` + SAF 原生目录选择走通，见 ADR-023 Phase C） | — |
| **实际演进** | 仍迁至 v3（alpha2.105）| 抽象层不再需要（v3 直接支持 Go binding import） |

最终迁移路径：选择了原方案 A（立即迁 v3），尽管有 Alpha 风险，但因 Android 需求和时间表压力触发迁移。迁移后 Android 端通过 `CanChooseDirectories(true)` 走通 SAF 原生目录选择（见 ADR-023 Phase C）。

## 相关文档

- [ADR-003](adr-003-download-strategy.md) — 下载策略决策
- [ADR-008](adr-008-download-watch-spec.md) — 下载目录监听规范
- [ADR-023](adr-023-android-file-access-strategy.md) — Android SAF 接入策略
