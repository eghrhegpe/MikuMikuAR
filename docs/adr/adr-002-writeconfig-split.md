# ADR-002: 配置写入分离 — writeConfig 轻写 vs writeConfigAndRescan 全量

**日期**：2026-07-16
> **状态**: 已完成 — writeConfig 从 writeConfigAndRescan 拆出，SetBlenderPath 改用轻写

---

### 背景

`SetBlenderPath` 调用了 `writeConfigAndRescan`，该方法每次都会执行全量 `ScanModelDir` + 重写 `index.json`。但设置 Blender 路径不影响模型索引，全量扫描是浪费。

类似的配置项（如主题、语言、窗口布局等）未来也可能落入同一陷阱。

### 决定

1. 从 `writeConfigAndRescan` 中提取 `writeConfig`，只做 JSON 序列化 + 写 `config.json`
2. `writeConfigAndRescan` 改为调 `writeConfig` + 扫描 + 写 `index.json`
3. `SetBlenderPath` 改为调 `writeConfig`

### 影响

- 设置 Blender 路径：从 ~2 秒（含扫描）→ 即时
- 后续加「不影响索引的配置项」直接复用 `writeConfig`，无需再踩坑
