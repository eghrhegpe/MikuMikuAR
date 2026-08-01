# ADR-224: Plaza 广场数据源统一与持久化 — GitHub 远程配置 + Go 用户目录缓存 + 内置兜底 + id 统一

> **状态**: 已实施（2026-08-01）
> **日期**: 2026-08-01
> **前置**: ADR-075（广场基础架构）、ADR-176（前后端适配器）、ADR-177（Web Loader 统一路径）

## 背景

- 广场站点/创作者数据存在三份来源：前端内置常量 `PLAZA_SITES`（3 站，id 带 `plaza:` 前缀）、GitHub 远程 `creators.json` + `workshop_sites.json`（10 站，id 无前缀）、前端 `plaza_cache.json` 缓存。
- **缺陷 1（id 前缀不一致）**：内置三站用 `plaza:mzhouse` 等，配置文件/缓存/远程用 `mzhouse` 等。`mergeSites` 按 id 去重，前缀不同导致内置三站与配置站无法融合、同时保留重复显示；`SITE_GROUPS` 引用带前缀 id，无前缀站落入 others 组。
- **缺陷 2（持久化走 CWD）**：前端 `loadPlazaCache/savePlazaCache/loadCustomSites` 用相对路径 `plaza_cache.json`/`workshop_sites.json` 经 Go `ReadTextFile/WriteTextFile`（`os.ReadFile/WriteFile` 直用 path）→ 解析到进程 CWD（开发=仓库根目录且被 git 跟踪；打包安装版=安装目录可能只读/无文件）→ 持久化位置错误/不可写/读不到仓库文件。
- **缺陷 3（加载路径不统一）**：`ensureSitesLoaded` 各分支行为不一致，仅兜底分支才 `mergeSites(PLAZA_SITES, custom)`。

## 决策

1. **id 统一去前缀**：`PLAZA_SITES` 三站 id `plaza:mzhouse`→`mzhouse`、`plaza:bowlroll`→`bowlroll`、`plaza:booth`→`booth`；`SITE_GROUPS` 同步去前缀。内置站与配置站按统一 id 经 `mergeSites` 融合。
2. **持久化走 Go 用户目录**：新增 Go 绑定 `SavePlazaConfig(creators string, sites string) error`，复用 `writePlazaCache` 写 `%APPDATA%/MikuMikuAR/plaza-cache/creators.json` + `workshop_sites.json`（原子替换 .tmp→Rename）。前端 `savePlazaCache()` 调它、`loadPlazaCache()` 改读 `GetCachedPlazaConfig()`，**不再经 CWD 相对路径**。
3. **加载路径统一**：`ensureSitesLoaded` 简化为两级——①已加载直接 return；②`loadPlazaCache()` 命中→`preserveBuiltinRouting(mergeSites(PLAZA_SITES, cached.sites))` + 有创作者则 setAllCreators；③冷启动兜底 `[...PLAZA_SITES]` + `[...PLAZA_CREATORS]`（不依赖 CWD 文件）。
4. **删除死文件/死代码**：仓库根目录 `plaza_cache.json`（旧合并缓存格式，零引用）移出 git 跟踪并加入 `.gitignore`；`plaza-state.ts` 死常量 `CUSTOM_SITES_PATH` 删除；`plaza-browser.ts` 的 `loadCustomSites()`/`loadCachedConfig()`（后者错误地把 Go 返回的 `[creators, sites]` 独立数组当作 `{sites,creators}` 对象解析）删除。
5. **网页端兼容**：`browser-adapter.ts` 的 `GetCachedPlazaConfig` 改读 IndexedDB `plaza_cache.json`（键 `file:plaza_cache`）、新增 `SavePlazaConfig` 写同一键；`FetchPlazaConfig` 保持三源 fetch（raw→jsdelivr→GitHub API）。

## 备选方案

- **保留前缀、merge 时特判**：改 `mergeSites` 剥离前缀再比对——复杂度更高、易埋坑，未选。
- **保持相对路径仅修 merge**：开发环境可用但安装版仍不可写、仓库文件被污染，未选。
- **前端直写用户目录绝对路径**：需额外暴露路径绑定，且 `WriteTextFile` 语义为"按传入路径"，不如新增语义明确的 `SavePlazaConfig`，未选。

## 影响

- **新增**：`internal/app/plaza_config.go` 的 `SavePlazaConfig` 绑定；`frontend/src/core/wails-bindings.ts` 的 `SavePlazaConfig = _p('SavePlazaConfig')`；`frontend/bindings/mikumikuar/internal/app/app.ts` 经 `npm run generate:bindings` 重新生成。
- **修改**：`plaza-sites.ts`（id 去前缀）、`plaza-state.ts`（SITE_GROUPS 去前缀、删 CUSTOM_SITES_PATH）、`plaza-browser.ts`（load/save/ensureSitesLoaded 重写）、`browser-adapter.ts`（GetCachedPlazaConfig/SavePlazaConfig）、`.gitignore`（加 plaza_cache.json）。
- **删除**：仓库根 `plaza_cache.json`（git rm --cached）、`loadCustomSites()`/`loadCachedConfig()`。
- **测试**：`plaza.contract.test.ts` mock 加 `SavePlazaConfig`、`GetCachedPlazaConfig`，preserveBuiltinRouting 用例 id 去前缀；`bindings/app.contract.test.ts` 的 `expectedFunctions` 两处数组加 `'SavePlazaConfig'`。
- **验证**：`npm run check` / `npm run test`（244 文件 4156 测试）/ `npm run build` / `go build ./...` / `npm run gen:funcmap` + `check:funcmap` / `npm run check:docs` 全部通过（仅既有 i18n 非阻塞警告）。

## 相关文档

- ADR-075（广场基础架构，站点元数据描述已同步修正）
- docs/knowledge/plaza-browser.md（symbols/invariants 已同步：持久化走 Go 用户目录 plaza-cache/，不依赖 CWD 仓库文件）
