# MikuMikuAR 发版程序（Release Process）

> **作用**：本文件是人类操作视角的发版标准作业程序（SOP）。机器视角见 `.github/workflows/release.yml`，版本发布说明见同目录 `vX.Y.Z.md`，缓存机制见 `docs/adr/adr-082-ci-cross-tag-cache-warm.md`。
> **单一事实源**：版本号以 `package.json` 的 `version` 字段为准，三平台构建脚本均从此读取。

---

## 0. 触发机制总览

| 触发方式 | 入口 | 行为 |
|----------|------|------|
| 推 tag | `git push origin vX.Y.Z` | 跑 `prepare` 校验 → 并行构建 Win/Linux/Android → 建 GitHub Release |
| 手动触发 | `workflow_dispatch`（含 `skip_sign` 选项） | 仅构建三平台；**不建 Release**（见 §5 注意事项） |

产物：Windows `dist/MikuMikuAR-X.Y.Z-windows-amd64.exe`、Linux `bin/mikumikuar-X.Y.Z-linux-amd64`、Android `dist/*.apk`，全部挂到同名 GitHub Release。

---

## 1. 前置条件

### 1.1 依赖与版本
- Go `1.25.0`（CI 固定；`wails/v3` 版本从 `go.mod` 动态读取，三者同源，禁写死 `@latest`）。
- Node `24`、`npm ci` 基于 `frontend/package-lock.json`。
- Wails v3 CLI：CI 由 `go install` 安装并缓存；本地需 `go install github.com/wailsapp/wails/v3/cmd/wails3@<go.mod 中版本>`。

### 1.2 Secrets（仅 Android 签名需要）
| Secret | 用途 |
|--------|------|
| `ANDROID_KEYSTORE_BASE64` | Base64 编码的 release keystore；缺失则只出 **debug APK** |
| `ANDROID_KEYSTORE_PASSWORD` | keystore 密码 |
| `ANDROID_KEY_ALIAS` | 签名别名 |
| `ANDROID_KEY_PASSWORD` | 密钥密码 |

`GITHUB_TOKEN` 由 runner 自动提供，无需配置。

### 1.3 缓存预热顺序（关键，避免冷启动）
见 ADR-082：tag run 的 `actions/cache` 作用域按 tag 隔离，跨发版不可见。必须：
1. 先把依赖变更（改 `go.mod` / `go.sum` / `frontend/package-lock.json`）推到 `main`，等 `cache-warm.yml` 落盘到 `main` 作用域（约 1–2 分钟）。
2. **再**推 `vX.Y.Z` tag，Release run 才会回退命中缓存，否则三平台 `wails3` / `node_modules` / `go modules` 全冷启动，多花 3–4 分钟。
- 升 wails 版本或加 npm 包 → 缓存 key 变化 → 同样需先推 `main` 重暖一次。

---

## 2. 标准发版步骤（9 步）

> 可一步到位执行的命令序列见附录 §11。

1. **定版本号**：按 semver 决定 `X.Y.Z`（当前见 `package.json`）。

2. **改 `package.json` 的 `version`**：这是唯一事实源。
   - 同步修改 **`build/windows/info.json`** 的 `file_version` 和 `ProductVersion`（该文件不是事实源，但 Windows 产物属性读取它，不同步则右键属性显示旧版本）。

3. **提交版本号变更**：
   ```bash
   git add package.json build/windows/info.json
   git commit -m "chore: bump version to X.Y.Z"
   ```

4. **写发布说明**：新建 `docs/releases/vX.Y.Z.md`（手写 notes；缺则 CI 自动生成，质量不可控）。
   - 格式参考同目录既有 `v1.3.5.md`。
   - ⚠️ **路径大小写敏感**：CI 查 `docs/releases/vX.Y.Z.md`（小写 `releases`）。`docs/Releases/`（大写 R）在 Linux runner 上不会命中。已在 v1.5.0 修复 CI 为小写，但如果改目录名或路径结构，务必同步更新 `release.yml:339` 的 `NOTES_FILE`。

5. **提交发布说明**：
   ```bash
   git add docs/releases/vX.Y.Z.md
   git commit -m "docs: add vX.Y.Z release notes"
   git push origin main
   ```

6. **等缓存预热**（仅当本版动了依赖时）：若修改了 `go.mod` / `go.sum` / `frontend/package-lock.json`，等 `cache-warm` workflow 落盘（约 1–2 分钟，GitHub Actions 页确认绿勾）。未动依赖则跳过此步。

7. **打 tag 触发**：
   ```bash
   git tag vX.Y.Z && git push origin vX.Y.Z
   ```

8. **等 CI 完成**：`gh run list --workflow release.yml --limit 3` 监控进度。四个 job 全绿：Prepare → Windows → Linux → Android → GitHub Release。

9. **核对 Release**：
   - 到 `https://github.com/eghrhegpe/MikuMikuAR/releases/tag/vX.Y.Z` 确认三平台产物齐全、body 为手写 notes（非自动生成的 `**Full Changelog**: https://...`）。
   - 若 body 不对：`gh release edit vX.Y.Z --notes-file docs/releases/vX.Y.Z.md` 修正（无需重跑 CI）。
   - 应用内「关于 / 检查更新」应显示真实版本（非 `dev`）。

---

## 3. 版本一致性闸门（CI 强制）

`release.yml` 的 `prepare` 步会执行：
```
PKG_VER = package.json.version
TAG_VER = git tag 去掉 'v' 前缀
if PKG_VER != TAG_VER → ::error::Version mismatch → 中断
```
**操作者必须保证 `package.json.version === tag`**（tag 即 `v` + 版本号，如 `1.3.5` → `v1.3.5`），否则流水线在第一步即失败。

---

## 4. 版本号注入三平台对照

应用内「关于 / 检查更新」依赖 `main.AppVersion`（及 `BuildTime` / `CommitHash`）。三平台注入方式各异，**新增构建路径必须复制注入逻辑，否则显示 `dev`**：

| 平台 | 注入方式 | 代码位置 |
|------|----------|----------|
| Windows | 构建前同步 `build/config.yml` 的 `version` + `build/windows/Taskfile.yml` 的 `{{.APP_VERSION}}`/`{{.BUILD_TIME}}`/`{{.COMMIT_HASH}}` 占位符 → `wails3 build` 读取；失败时降级 `go build -ldflags "-X main.AppVersion=..."` | `scripts/build-windows.ps1`（§39–60、§117–119） |
| Linux | `go build -ldflags="-X main.AppVersion=$VER -X main.BuildTime=... -X main.CommitHash=... -s -w"` | `release.yml` `build-linux` 步（§190–192） |
| Android | `go build -buildmode=c-shared -ldflags "-X main.AppVersion=... -X main.BuildTime=... -X main.CommitHash=..."` | `scripts/build-android-so.ps1`（§73–74） |

> 三平台均从 `package.json.version` 读取，单一事实源一致。

---

## 5. 手动触发（`workflow_dispatch`）与 `skip_sign`

- 入口：GitHub Actions → Release → Run workflow。
- 输入 `skip_sign`：`true` 时 Android 强制走 debug 构建（不签名）。
- **注意事项**：`release.yml` 的 `release` 步带 `if: startsWith(github.ref, 'refs/tags/v')`。手动触发时 `github.ref` 是分支引用而非 tag，因此 **`release` 步被跳过，只构建不发布**。手动触发仅用于验证构建，真正发版必须走 tag。

---

## 6. 发布说明约定

- 路径：`docs/releases/vX.Y.Z.md`（与版本号严格对应）。
- `release` 步优先用该文件作 Release body；**缺失则 `generate_release_notes: true` 自动生成**（基于 PR/commit，质量不可控，不建议依赖）。
- 文件名带 `v` 前缀，与 tag 一致。
- ⚠️ **路径大小写**：文件名采用小写 `docs/releases/`。`release.yml:339` 也对应小写。若改目录名须同步 CI。
- ⚠️ **body 覆盖顺序**：CI 的 `Create Release (hand-written notes)` 步是**幂等的**——同名 tag 重推会覆盖前一次的 Release body。所以即使第一次 body 错了，重推 tag 修正后 body 会恢复。但若 CI 未命中 hand-written 分支（路径不对或文件缺失），自动生成会覆盖之前的 body。

---

## 7. 回滚 / 补发

- **发布内容有误但产物可复用**：直接编辑 GitHub Release 的 body 或重新上传资产，无需重跑 CI。
- **需要重新构建**：修正代码/`package.json` 后，必须 **删除旧 tag 并重建同名 tag** 才能复触发（`git tag -d vX.Y.Z && git push origin :vX.Y.Z`，再重新打 tag 推送）。注意：同名 tag 重推会复用缓存，但 `go-build-<sha>` 因 commit 变化必 miss（设计如此，见 ADR-082 §七）。
- **撤销已发布 Release**：GitHub 删除 Release 即可，tag 可保留或同步删除；不涉及代码回退时无需 revert commit。

---

## 8. 本地干跑（发版前自检）

发版前在本地验证构建链路，避免 CI 白跑：

```bash
# Windows
npm run build:win              # = scripts/build-windows.ps1（默认 debug tags）
# Linux
npm run build:linux            # = scripts/build-linux.sh
# Android（debug）
npm run build:android          # = scripts/build-android.ps1 -Arch arm64
# Android（release 签名）
npm run build:android:release  # = scripts/build-android.ps1 -Arch arm64 -Production
```

本地构建同样会注入 `package.json.version`，可在产物「关于」中核对版本显示。

---

## 9. 发版验证清单

### 发版前
- [ ] `package.json.version` 已更新且等于目标 tag（去 `v`）。
- [ ] `build/windows/info.json` 的 `file_version` 和 `ProductVersion` 已同步。
- [ ] 已提交版本号变更（package.json + info.json）。
- [ ] `docs/releases/vX.Y.Z.md` 已写好（手写 notes；路径确认小写 `releases`）。
- [ ] 已提交发布说明。

### 发版中
- [ ] 若动了依赖：已先推 `main` 并等 `cache-warm` 绿勾。
- [ ] `git tag vX.Y.Z && git push origin vX.Y.Z` 已执行。
- [ ] CI 四 job 全绿（Prepare / Windows / Linux / Android），无 `Version mismatch`。

### 发版后
- [ ] GitHub Release 已建，三平台产物齐全（Windows .exe / Linux binary / Android .apk）。
- [ ] Release body 为手写 notes（非自动生成 changelog）。
- [ ] 应用内「关于 / 检查更新」显示真实版本（非 `dev`）。
- [ ] Android：有签名则为 release APK，无签名则为 debug（符合预期）。

---

## 10. 发版常见坑

### 10.1 版本与构建

| 坑 | 现象 | 根因 | 对策 |
|----|------|------|------|
| `info.json` 版本漏改 | Windows 产物属性显示 `1.0.0` | 该文件硬编码，非事实源，SOP 容易忘 | checklist 第一项即校验它 |
| 手写 notes 路径大小写 | Release body 自动生成 | CI 查 `docs/Releases/`（大写 R）但仓库实际 `docs/releases/`（小写 r） | 已修：`release.yml:339` 改为小写；不改目录结构不会再犯 |
| 手动触发 workflow_dispatch | 构建成功但无 Release | `release` job 有 `if: startsWith(github.ref, 'refs/tags/v')`，手动触发时 ref 是分支 | 正式发版必须走 tag |
| Android Secrets 缺失 | 产出 debug APK（不可发布） | `ANDROID_KEYSTORE_BASE64` 等四个 Secret 未配置 | `gh secret list` 确认四键齐全 |

### 10.2 缓存与 CI

| 坑 | 现象 | 根因 | 对策 |
|----|------|------|------|
| tag run 缓存互相不可见 | 每次发版冷启动多花 3–4 分钟 | `actions/cache` 按 tag 作用域隔离 | 先推 `main` 等 `cache-warm` 落盘，再推 tag（ADR-082） |
| 同秒推 main+tag | 本次发版依然冷启动 | Release restore 早于 Cache Warm save | 推 main 后至少等 1–2 分钟确认 cache-warm 绿 |
| `npm ci` 先删 `node_modules` | 刚恢复的缓存被自己清掉 | `npm ci` 第一步删 `node_modules` 重建 | 已修：`npm ci` 步受 `cache-hit` 守卫 |
| 改了依赖没等 cache-warm | Release run 全冷启动 | 依赖变化后未推 main 暖缓存 | **改 go.mod/package-lock.json 后必须先推 main 暖缓存再推 tag** |
| Linux wails3 缺 GTK 开发包 | `go install wails3` 报 `pkg-config` not found | wails3 CLI 编译时链接 GTK (CGO) | 缓存 miss 时才装 `libgtk-4-dev libwebkitgtk-6.0-dev` |
| Go build cache 必 miss | `go-build-*` 每次都重建 | key 含 `github.sha`，设计如此 | 预期行为，无法预热 |

### 10.3 产物与发布

| 坑 | 现象 | 根因 | 对策 |
|----|------|------|------|
| 自动 changelog 比较基准跳跃 | body 写 `v1.4.0...v1.5.0` 而非 `v1.4.1...v1.5.0` | 自动生成基于 git tag 排序，可能跳 tag | 用手写 notes 完全规避 |
| 重推同名 tag | body 被自动生成覆盖 | `Create Release` 步幂等写入 | 确保手写 notes 路径正确后再重推 |
| 回滚后删 tag 重建 | 新 commit 推同名 tag 不触发 CI | tag 已存在，push 被跳过 | `git tag -d vX.Y.Z && git push origin :vX.Y.Z` 删除远端 tag 后再打 |

---

## 11. 发版快速命令序列

一行接一行执行，按需跳步：

```bash
# 步骤 2：改版本号
VER="X.Y.Z"  # ← 改成实际版本号

# 步骤 3+4：改文件 + 写 notes
sed -i "s/\"version\": \".*\"/\"version\": \"$VER\"/" package.json
# 手动改 build/windows/info.json 的 file_version 和 ProductVersion
# 手动写 docs/releases/v$VER.md

# 步骤 5：提交
git add package.json build/windows/info.json
git commit -m "chore: bump version to $VER"
git add docs/releases/v$VER.md
git commit -m "docs: add v$VER release notes"
git push origin main

# 步骤 6：等缓存预热（仅动了依赖时需要）
# 手动去 GitHub Actions 等 cache-warm 绿勾

# 步骤 7：打 tag
git tag v$VER && git push origin v$VER

# 步骤 8+9：监控 + 核对
gh run list --workflow release.yml --limit 3
gh release view v$VER --json body,tagName,assets --jq '{tag: .tagName, body: (.body[0:80]+"..."), assets: (.assets | length)}'
```
