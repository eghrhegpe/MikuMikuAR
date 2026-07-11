# ADR-082: 跨发版 CI 缓存预热（cache-warm 落盘 main 作用域）

> **状态**: 已实施（2026-07-11 经 commit `788b2e9` 落地 `cache-warm.yml`，Linux GTK 修复 `4192631`；v1.2.7 tag run `29118031286` 实测三平台全命中）

## 一、背景与问题

MikuMikuAR 的 Release CI 由 `.github/workflows/release.yml` 驱动，触发条件为 `on: push: tags: ['v*']` + `workflow_dispatch`。三个平台 job（Windows / Linux / Android）各自用 `actions/cache@v5` 缓存四类产物：

| 缓存 | key 形态 | 用途 |
|------|----------|------|
| `wails-<ver>-<OS>` | 无 sha | wails3 CLI 二进制（`go install` 约 1 分钟） |
| `nm-<OS>-<lockHash>` | 无 sha | `frontend/node_modules`（`npm ci`） |
| `go-<OS>-<go.sumHash>` | 无 sha | Go modules（`go mod download`） |
| `go-build-<OS>-<GOVER>-<sha>` | 含 sha | Go 编译缓存（每次新 commit 必 miss） |

**根因**：GitHub Actions 的 `actions/cache` 在 **tag 触发的 run 里按 tag 作用域隔离**——一个 tag run 写入的缓存，对其他 tag run **不可见**，仅回退到 default branch（`main`）与当前/base branch。而仓库唯一的 `push:main` workflow（`ci.yml`）只用 `setup-node`/`setup-go` 自带缓存，**从不**用 `actions/cache` 存 wails3 与 node_modules。

后果：每个新发版（新 tag）检索不到上一版的缓存 → **`wails`/`node_modules`/`go modules` 全部冷启动**，每次发版白白多花约 3–4 分钟（`go install` 1 分钟 + `npm ci` 数十秒），且 `npm ci` 第一步删 `node_modules` 还会把刚恢复的缓存自己清掉（见 ADR-082 §三 历史坑）。配置语法本身正确，是平台作用域限制，非 YAML bug。

## 二、决策

新增轻量 workflow `.github/workflows/cache-warm.yml`（**方案 B**），在 `push: branches: [main]` 时复用与 `release.yml` **完全相同**的缓存 key，把 `wails3 二进制` / `frontend/node_modules` / `Go modules` 三类预热到 `main` 作用域。下次打 `v*` tag，Release run 的 restore 即回退命中 `main`，跳过 `go install` / `npm ci` / `go mod download`。

**选择 B 而非 A/C 的理由**：

| 方案 | 做法 | 取舍 |
|------|------|------|
| A | 给 `release.yml` 的 `on:` 加 `push: branches:[main]`，让构建 job 在推 main 时落盘 main | 改动最小但每次推 main 跑全量三平台构建（~十几分钟）；且须避免同秒推 main+tag 的竞态 |
| **B（采用）** | 独立 `cache-warm.yml`，只 checkout + `go install wails3` + `npm ci` + `go mod download` 落盘，不构建不发布 | 复用同 key、零发布风险、不跑 vite；多维护一个轻量 workflow |
| C | 接受跨发版不缓存 | 无改动，但每版慢 3–4 分钟，纯浪费 |

## 三、历史坑（已修，留作记录）

1. **`npm ci` 清空缓存**：早期 `release.yml` 的 `Build Frontend` 无条件跑 `npm ci`，而 `npm ci` 第一步删 `node_modules` 重建 → 上方刚恢复的 `nm-*` 缓存被自己清掉。修复（commit `e749d20`）：`npm ci` 抽为独立 `Install Frontend deps` 步，受 `if: steps.cache-nm.outputs.cache-hit != 'true'` 守卫，命中即跳过。
2. **wails3 CLI 在 Linux 需 GTK 开发包**：误判 wails3 为纯 Go。`warm-linux` 的 `go install wails3` 编译时链接 `gtk4`/`webkitgtk-6.0`（CGO，`internal/operatingsystem`），缺包报 `Package gtk4 was not found in the pkg-config search path`。修复：`Install Wails` 前加 `sudo apt-get install libgtk-4-dev libwebkitgtk-6.0-dev …`，按 wails 缓存命中门控。
3. **每次 push 空跑**：cache-warm 初版无 `paths` 过滤，任意 push（含纯重构如删 `catTag`）都触发，浪费。修复：加 `paths: [go.mod, go.sum, frontend/package-lock.json, .github/workflows/cache-warm.yml]`——缓存 key 只取决于这三个依赖文件 + 本 workflow，纯文档/重构推送不改变 key，不再重暖。

## 四、实施细节

**`cache-warm.yml` 结构**：
- 触发：`push: branches: [main]` + `paths` 过滤（见 §三.3）
- 两个 job：`warm-windows`(windows-latest) + `warm-linux`(ubuntu-latest)，各 10 steps
- 暖三类：`wails3 二进制` / `frontend/node_modules` / `Go modules`
- **故意省略** `go-build`：key 含 commit sha，需 CGO 真编译才能填充，留着会把 B 变重
- `warm-windows` 额外覆盖 Android：Android job 也跑 `windows-latest`，与 `warm-windows` 共享 `wails-*-Windows` / `nm-Windows-*` / `go-Windows-*` 同一组 key → **一个 job 同时暖 Windows + Android**，且因 cache-warm 无独立 Android job，彻底规避了 `release.yml` 里 Android 抢 Windows 同 key 的 `Failed to save` 良性冲突
- **不发版、不跑 vite**，保持轻量

**发版约定（已写入文件头注释）**：先 `git push origin main` 等 Cache Warm 落盘，再 `git push origin vX.Y.Z`。若同秒推 main+tag，本次发版不受益（仅下次受益），无破坏。

**版本同源**：本机 `scripts/wails/build.ps1` 的 wails3 安装提示已从写死 `@latest` 改为 `Select-String go.mod` 动态读（commit `1f1ed6c`），与 `release.yml` 的 `prepare.wails_ver`、`cache-warm.yml` 的 `wv` 取数逻辑**三者同源**，杜绝 `@latest` 漂移。

## 五、验证（v1.2.7，run `29118031286`，结论 success）

三类缓存三平台**全部 `Cache hit`**，回退命中 cache-warm #3（`29117765341`，`4192631`）落盘的 `main` 作用域：

| 缓存 | Linux | Windows | Android |
|------|-------|---------|---------|
| `wails-<ver>-<OS>` | ✅ hit | ✅ hit | ✅ hit |
| `nm-<OS>-<lockHash>` | ✅ hit | ✅ hit | ✅ hit |
| `go-<OS>-<go.sumHash>` | ✅ hit | ✅ hit | ✅ hit |
| `go-build-<OS>-<GOVER>-<sha>` | ⚠️ miss | ⚠️ miss | ⚠️ miss |

日志实证：`Cache hit for: wails-v3.0.0-alpha2.105-Linux` / `Cache restored from key: nm-Linux-953b3af6…` / `Cache hit occurred on the primary key ..., not saving cache`（命中且不重写，无冲突）。方案 B 跨发版缓存**验证通过**。

## 六、受影响文件

| 文件 | 处置 |
|------|------|
| `.github/workflows/cache-warm.yml` | 新增（本 ADR 核心） |
| `.github/workflows/release.yml` | `e749d20`：`npm ci` 受缓存命中守卫；其余缓存步不变 |
| `.github/workflows/ci.yml` | 不变（仍只 `setup-*` 自带缓存，不存 wails/nm） |
| `scripts/wails/build.ps1` | `1f1ed6c`：wails3 安装提示对齐 go.mod（去 `@latest`） |
| `docs/Releases/v1.2.6.md` / `v1.2.7.md` | 发版说明与实测命中表 |

## 七、后续注意

- 升 wails 版本（`go.mod` 改 `wails/v3`）→ `wails-<ver>-<OS>` key 变 → 自动重暖一次；`main` 推上去后等 Cache Warm 跑完再打 tag。
- 加/升 npm 包 → `package-lock.json` 哈希变 → `nm-*` key 变 → 同。
- `go-build-<sha>` 缓存按设计每次新 commit miss，不影响发版速度（编译缓存本就靠本 run 内填充）。
