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

## 2. 标准发版步骤（7 步）

1. **定版本号**：按 semver 决定 `X.Y.Z`（当前见 `package.json`）。
2. **改 `package.json` 的 `version`**：这是唯一事实源。
3. **提交版本号变更**：`git add package.json && git commit -m "chore: bump version to X.Y.Z"`。
4. **写发布说明**：新建 `docs/releases/vX.Y.Z.md`（手写 notes；缺则 CI 自动生成，质量不可控）。格式参考同目录既有 `v1.3.5.md`。
5. **推 `main` 并等缓存预热**（若本版动了依赖）：`git push origin main` → 等 `cache-warm` 绿。
6. **打 tag 触发**：`git tag vX.Y.Z && git push origin vX.Y.Z`。
7. **核对 Release**：到 GitHub Releases 页确认三平台产物齐全、`vX.Y.Z.md` 已作为 body 渲染、应用内「关于 / 检查更新」显示真实版本（非 `dev`）。

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

- [ ] `package.json.version` 已更新且等于目标 tag（去 `v`）。
- [ ] 已提交版本号变更。
- [ ] `docs/releases/vX.Y.Z.md` 已写好（手写 notes）。
- [ ] 若动了依赖：已先推 `main` 并等 `cache-warm` 落盘。
- [ ] `git tag vX.Y.Z && git push origin vX.Y.Z` 已执行。
- [ ] CI 三平台 job 全绿，无 `Version mismatch`。
- [ ] GitHub Release 已建，三平台产物齐全，body 为手写 notes。
- [ ] 应用内「关于 / 检查更新」显示真实版本（非 `dev`）。
- [ ] Android：有签名则为 release APK，无签名则为 debug（符合预期）。
