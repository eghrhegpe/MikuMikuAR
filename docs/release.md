# 发版指南

> 版本管理、构建产线、Release Notes 规范。
> 构建脚本详见 `scripts/build-*.sh` / `scripts/build-*.ps1`。

---

## 版本管理

单一信源 `package.json` → `build/config.yml`（构建脚本自动同步）→ `go build -ldflags -X main.AppVersion` 注入运行时。

发版前：更新 `package.json version` → `git tag v$(node -p "require('./package.json').version")` → `git push --tags`。

---

## 构建

| 平台 | 命令 | 产物 |
|------|------|------|
| Windows | `scripts/build-windows.ps1 [--production]` | `dist/MikuMikuAR-{ver}-windows-amd64.exe` |
| Linux | `scripts/build-linux.sh [--production]` | `dist/mikumikuar-{ver}-linux-amd64` |
| macOS | `scripts/build-darwin.sh [--production]` | `dist/mikumikuar-{ver}-darwin-{amd64\|arm64}` |
| iOS | `scripts/build-ios.sh`（占位，需 Xcode） | 见 `build/ios/Taskfile.yml` |
| Android | `wails3 task android:build` | `dist/MikuMikuAR-{ver}-android.apk` |

> **Blender 路径**: Linux/macOS 未覆盖自动检测，需用户手动在 设置 → 系统 中配置。

`--production` 启用 `-tags production -s -w`（裁剪调试符号）；`--clean` 清理 `bin/` 目录。

---

## Release Notes

`docs/changelog/archive/` 是内部技术纪要，**发版时必须写面向用户的 release notes**：`docs/changelog/release-{version}.md`

```
## ✨ 新功能
- **功能名**：一句话说明 + 怎么用

## 🔧 改进
- **改进名**：之前怎样 → 现在怎样

## 🐛 Bug 修复
- **问题名**：触发场景、修复后行为
```

| ❌ 禁止 | ✅ 应该 |
|---------|---------|
| `24 files changed` / `a3f2c91` | "布料模拟来了，模型会随风摆动" |
| 内部架构名（`Phase 9a`） | 用户可见的功能描述 |
| "重构了 observer 模式" | "修复了切换模型时动作残留" |

---

## 发版清单

- [ ] `package.json` version → `docs/changelog/release-{ver}.md`（面向用户）→ `docs/status.md` 一致
- [ ] `go build ./...` + `cd frontend && npm run check && npm run build && npm run test`
- [ ] 目标平台构建脚本运行成功 → `dist/` 产物完整性
- [ ] `git tag v{version} && git push --tags`
