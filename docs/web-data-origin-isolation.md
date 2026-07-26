# 网页端数据存储与 Origin 隔离说明

> 关联：ADR-176 / ADR-180 / ADR-182 / ADR-183
> 来源：多端成熟度矩阵 `docs/multi-end-maturity-matrix.md`「存储维度弱点②」与 🟡 P3 卡点
> 校准日期：2026-07-26

## 一句话结论

网页端（浏览器形态）的**全部本地数据都存放在浏览器的 IndexedDB 里，且严格按 origin 隔离**。
因此 `localhost:5173`（本地开发）与线上 GitHub Pages（`eghrhegpe.github.io/MikuMikuAR/`）是
**两个互不连通的数据库**——在 dev 导入的模型、授权的目录，切到线上一个都看不到，反之亦然。

这是浏览器同源策略的**硬约束**，不是 Bug，也不是我们可绕过的实现缺陷。

## 什么是 origin

浏览器以 `协议://域名:端口` 三元组作为「来源(origin)」隔离存储。三者任一不同即视为不同 origin：

| 形态 | origin | 数据互通？ |
|------|--------|-----------|
| 本地开发（`wails dev` / `vite` 调试） | `http://localhost:5173` | 自成一体 |
| GitHub Pages 线上版 | `https://eghrhegpe.github.io/MikuMikuAR/` | 自成一体 |
| 桌面端（Wails 打包） | 非浏览器环境 | 走 Go 后端磁盘存储，与 IDB 无关 |

> 提示：端口不同的两个 localhost（如 `5173` 与 `5174`）也是不同 origin，同样不互通。

## 网页端存了什么（IDB 实况）

数据库名 `mikumikuar-web`（版本 `1`），按用途分 9 个 object store：

| Store | 内容 | 关联 ADR |
|-------|------|----------|
| `models` | 导入的 PMX/ZIP 原档字节 + 元数据（`entry:<name>` / `file:<name>`） | ADR-176（browser-adapter） |
| `config` | FSA 根目录句柄 `fsaRootHandle`、授权提示 dismissed 标志 `fsaAuthPromptDismissed` | ADR-180 / ADR-183 |
| `uistate` | UI 持久化状态 | ADR-141 |
| `scenes` | 场景存档 | ADR-166 |
| `thumbnails` | 模型/场景缩略图缓存 | — |
| `caches` | 资源缓存统计 | ADR-176 |
| `presets` | 动作/环境预设 | — |
| `tags` | 资源标签 | — |
| `meta` | 杂项（含 `web-loader.lastModel` 最近模型键） | — |

源码：`frontend/src/core/backend/idb.ts`、`frontend/src/core/backend/browser-adapter.ts`。

## 这对用户/开发者意味着什么

1. **dev ↔ 线上数据不共享**：在 `localhost:5173` 调试时导入的模型，打开线上 Pages 版看不到，需重新导入 / 重新授权目录。属预期行为。
2. **删库需重选目录**：清空某 origin 的 IndexedDB 后，FSA 已授权句柄随之丢失，下次需重新
   `showDirectoryPicker` 选目录并授权。ADR-180 的「重扫自愈」会重新扫描，但前提是先重新授权。
3. **FSA 句柄无法跨 origin 迁移**：`FileSystemDirectoryHandle` 的权限授权本身也按 origin 绑定，
   导出/导入工具**无法搬运授权**——在新 origin 必须重新点一次授权。这是浏览器安全模型决定的硬约束。

## 为什么没做迁移工具

- IndexedDB 与 FSA 授权都是浏览器按 origin 强制隔离，跨 origin 读写被同源策略禁止。
- ADR-180 选择「句柄持久化 + 启动重扫自愈」而非跨 origin 共享，正是为了避免在安全边界上打洞。
- 迁移工具若落地，只能导出**已缓存进 IDB 的模型二进制 + 元数据**，目录授权仍需在新 origin 重新完成；
  因此优先级低于「先讲清楚」。迁移工具目前列为**待评估**，不阻塞发布。

## 操作指引

### 用户：在两个 origin 间搬数据

- 现状：无一键迁移。推荐做法——在源 origin 通过「下载/导出」把模型文件落到本地磁盘，
  再到目标 origin 重新导入。
- 清库：浏览器 DevTools → Application → IndexedDB → `mikumikuar-web` → 右键 Delete database；
  或 Settings 内「清空缓存」入口（如已提供）。

### 开发者：本地验证

- 本地 `npm run dev` 跑在 `localhost:5173`，与 CI 部署的 Pages 数据是两套，验证缓存/导入行为互不影响。
- 想从干净状态验证：清掉 `localhost:5173` 的 IndexedDB 即可，不影响线上用户。

## 状态

本说明即多端成熟度矩阵 🟡 P3 卡点中「文档化」分支的落地；导出/迁移工具待评估。
