# Wails vs Tauri 技术选型权衡

> 从 research-notes.txt 提取整理。MMDHub 项目壳语言选型的完整决策记录。

## 背景

渲染层已锁定 babylon-mmd（Web 技术栈），壳语言只决定 fs/下载/解压/zip/PMX header 等周边能力，不碰渲染。

## 对比表

| 维度 | Wails (Go) | Tauri (Rust) |
|------|-----------|--------------|
| 包体 | ~12MB（v3 内置轻量 Blink） | ~5MB（系统 WebView） |
| 后端语言 | Go | Rust |
| 文件系统 | Go stdlib 直读，跨平台成熟 | Rust std::fs + capability 权限模型 |
| PMX header 解析 | 现成库 `toy80/pmx` | 需自己写或引 MikuMikuFormats |
| zip/rar/7z 解压 | `archive/zip` + `nwaples/rarfs` + `ulikunitz/xz` 全套 | `zip` crate 现成，rar/7z 稍折腾 |
| 下载拦截 | Wails Bind + WebView 注入 | Tauri capability-based 更贴合 |
| Android 支持 | v3 实验，CEF 路线重 | Tauri mobile 路线图更清晰 |
| 后端 ↔ 前端通信 | Bind() 自动生成 TS 绑定，无需手写 | `#[tauri::command]` + TS 类型需对齐 |
| 安全模型 | 7/10 | capability-based 更严谨 |
| 社区/生态 | ~2万 star | ~7万 star |
| 企业采用 | 较少 | ClickUp、Bitwarden 等 |

## 决策结论

**对 MMDHub 这个项目：**

- 渲染层已锁 babylon-mmd（Web 技术栈），壳语言只决定**本地能力层**（扫目录/解压/下载/PMX header）
- 这些事全是"本地 IO + 二进制解析 + 进程调用"，Go 的主场，Rust 也没输但没优势
- **Go + Wails 完全成立**，甚至本地能力层 Go 比 Rust 顺

**但有一个硬变量——Android 后期：**

- Wails 的 Android 支持不如 Tauri 成熟
- Tauri mobile 路线图比 Wails 的 Android 实验分支清晰
- 如果 Android 是正式目标 → 留 Tauri
- 如果 Android 是"想想而已" → 换 Wails 没问题

## 最终建议

> 别现在定死。Week 1 那种"能播 PMX+物理"的最小骨架，Tauri 和 Wails 都能两天搭出来——不如两边都 hello world 一下，看哪个本地跑通 PMX header + 扫目录 + 前端 Bind 更顺手。壳语言这层返工成本低（前端 Vite+babylon-mmd 那 80% 不动）。
