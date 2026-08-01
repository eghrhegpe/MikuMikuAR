<!-- 本文件由 scripts/gen-docs-index.mjs 自动生成，请勿手改。重跑：npm run gen:docsindex -->

# Bug 日志索引

> 排障记录共 **41** 篇：23 篇按日期归档、18 篇早期记录（命名规范确立前）。每篇记录现象、根因、修复与验证方式，供回归时快速比对。

> 写作规范见 [Buglog 规范](./README.md)。

## 2026 年 8 月（1）

- `2026-08-01` [网页版界面文本全变 key 字符串（locales/*.json 404）](./2026-08-01-web-locale-404-text-keys.md)

## 2026 年 7 月（22）

- `2026-07-31` [babylon-mmd -dist git 依赖产物三类 ESM 解析缺陷（build 绿但 vitest 全挂）](./2026-07-31-babylon-mmd-dist-esm-resolution.md)
- `2026-07-29` [自定义 slog.Handler WithAttrs 违反契约导致 exe 启动挂起](./2026-07-29-slog-custom-handler-hang.md)
- `2026-07-28` [pre-push 门禁连环阻断：三元语句 lint error + 过时测试断言](./2026-07-28-prepush-lint-and-stale-test.md)
- `2026-07-25` [网页端 ZIP 内子目录 PMX 贴图读取失配（多维 zip 加载不出贴图）](./2026-07-25-web-zip-pmx-subdir-textures.md)
- `2026-07-25` [网页端不同目录同名 PMX 纹理键互相覆盖（静默错渲染）](./2026-07-25-web-texture-stem-collision.md)
- `2026-07-21` [切后台回来渲染器冻结：visibilitychange 误 disposeScene](./2026-07-21-visibilitychange-dispose-scene-freeze.md)
- `2026-07-20` [GroundMesh.render 崩溃：ShaderMaterial._effect 为 null](./2026-07-20-GroundMesh-ShaderMaterial-effect-null-crash.md)
- `2026-07-19` [测试修复：env-context mock 缺失 + 测试断言过时](./2026-07-19-test-mock-gap-and-stale-assertions.md)
- `2026-07-17` [水面预设点击后水面消失且开关/滑条不可逆（NaN uniform 污染）](./2026-07-17-water-preset-nan-uniform.md)
- `2026-07-17` [骨骼覆盖父子骨冲突：`_computeOverride` weight≥1 丢弃父骨传播旋转](./2026-07-17-bone-override-parent-child-propagation.md)
- `2026-07-17` [ADR-124 文件系统迁移踩坑记录](./2026-07-17-adr124-file-access-migration.md)
- `2026-07-16` [缩略图缓存 miss（网格不认图）BUG 追踪](./2026-07-16-thumbnail-cache-miss.md)
- `2026-07-16` [缩略图宽高比连环坑：从FOV误解、投影矩阵时序到UI网格自适应](./2026-07-16-thumbnail-aspect-ratio-ui-grid.md)
- `2026-07-16` [环境状态恢复失败：config.json 写入时机不可靠 + 场景文件 env 被 skipEnv 跳过](./2026-07-16-env-state-not-restored.md)
- `2026-07-15` [设置菜单两处功能缺陷（2026-07-15）](./2026-07-15-settings-menu-defects.md)
- `2026-07-15` [路径覆写失效：多个函数绕过 OverridePaths 导致幽灵目录与统计数据不准](./2026-07-15-path-override-ignored.md)
- `2026-07-11` [第⑤轮审核 — VMD 加载 + 图层类型安全修复](./2026-07-11-vmd-layers-type-comments.md)
- `2026-07-11` [七轮代码审核汇总（2026-07-11）](./2026-07-11-seven-rounds-summary.md)
- `2026-07-11` [第⑥轮审核 — perception.ts _writeMatToBuffer 优化](./2026-07-11-perception-writeMatToBuffer.md)
- `2026-07-11` [第⑦轮审核 — MmdRuntimeBoneExtended 接口去重](./2026-07-11-MmdRuntimeBoneExtended-dedup.md)
- `2026-07-11` [第④轮审核 — 光照模块 tween 功能 BUG + 资源管理](./2026-07-11-lighting-tween-bugs.md)
- `2026-07-11` [env-water: setWorldMatrix / freezeWorldMatrix 运行时不存在于 FreeCamera](./2026-07-11-env-water-setWorldMatrix.md)

## 早期记录（18）

> 命名规范（`YYYY-MM-DD-简短英文描述.md`）确立前的记录，按标题排序。

- [菜单两套导航机制，AI 难重写](./菜单两套导航机制AI难重写.md)
- [程序化动作脚穿透地面](./程序化动作脚穿透地面.md)
- [程序化动作切换与缩略图截帧时序冲突](./程序化动作切换与缩略图截帧时序冲突.md)
- [程序化动作应用到角色无效（动作1 / 基础槽位）](./程序化动作应用到角色无效（动作1）.md)
- [单一全局音量控制所有声音](./单一全局音量控制所有声音.md)
- [骨骼变换覆写无效（视线追踪 程序化骨骼旋转）](<./骨骼变换覆写无效（视线追踪 程序化骨骼旋转）.md>)
- [两套物理引擎并存，性能差 3-5 倍](./两套物理引擎并存性能差3至5倍.md)
- [水面关掉后不恢复](./水面关掉后不恢复.md)
- [纹理不显示：模型无颜色](./纹理不显示：模型无颜色.md)
- [用户 VMD 加载后角色呼吸消失](./用户VMD加载后角色呼吸消失.md)
- [CORS：Wails WebView 跨域被拦](<./CORS：Wails WebView 跨域被拦.md>)
- [Ctrl+Space 被三个模块同时注册，静默覆盖](<./Ctrl+Space 被三个模块同时注册静默覆盖.md>)
- [grid 切换后地面变纯色，重启才恢复](./grid切换后地面变纯色重启才恢复.md)
- [PMX 加载失败：`is not pmx file`](<./PMX 加载失败：`is not pmx file`.md>)
- [Shader 404：textureAlphaChecker.vertex.fx](<./Shader 404：textureAlphaChecker.vertex.fx.md>)
- [UI 硬编码中文，无法切换语言](<./UI 硬编码中文无法切换语言.md>)
- [VMD 播放无反应](<./VMD 播放无反应.md>)
- [WASM 404：`index_bg.wasm` 无法加载](<./WASM 404：`index_bg.wasm` 无法加载.md>)
