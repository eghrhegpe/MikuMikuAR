# Round 75 审核报告 — Go 测试集群（12 文件）

> 日期: 2026-10-25
> 模式: 跳过 TS 队列顺序，直接审核 round-14 漏审的 12 个 Go _test.go（价值更高，用户选择）。主模型直接审核（12 文件共 2448 行，逐文件通读 + 交叉核实上游源码）。
> 范围: internal/app/{ai_binding,app,coep_middleware,decodezip,fs,proxy,shutdown,update}_test.go + internal/app/llm/client_test.go + internal/util/{pmx,safecall,safecall_integration}_test.go
> 上游核实: writeConfig/updateConfig/configDir/settingDir/presetDir/AiSetLLMConfig/serveRootDir 落盘面

---

## 执行摘要

| 文件 | 用例数 | 结论 | 关键发现 |
|------|--------|------|---------|
| ai_binding_test.go | 2 | ⚠️ 有缺陷（已修） | P3：两测试缺 testConfigDir 隔离，AiSetLLMConfig 把假 LLMConfig 写进用户真实 config.json |
| app_test.go | 17 | ✅ 通过（1 处已修） | ADR-253 presence mask 10 用例极扎实；P4：TestScenePresetDir 无隔离 MkdirAll 真实用户目录（已修） |
| coep_middleware_test.go | 2 | ✅ 通过 | mpr build tag 对称 skip 设计良好；默认 CI 只跑 Off 侧，On 侧需 -tags mpr（本轮双跑验证） |
| decodezip_test.go | 12 | ✅ 通过 | 边界全覆盖（非法 SJIS 字节、控制字符、RuneError、CJK 优雅降级） |
| fs_test.go | 17 | ✅ 通过 | SSRF ?f= 穿越 + ADR-058 corruptIndex（ShiftJIS/GBK/collision warning）覆盖好；3 处 P4 卫生 |
| proxy_test.go | 11 | ✅ 通过 | SSRF 防线完整：host-mismatch / isBlockedIP（含 IPv4-mapped IPv6 round14-P3 回归）/ dial guard / size cap 清理 |
| shutdown_test.go | 3 | ✅ 通过 | 真实 TCP 监听 + 临时端口；1 处 P4（断言恒真） |
| update_test.go | 18 | ✅ 通过 | 版本比较全边界（dev 串、大 V、缺段、前导零） |
| llm/client_test.go | 8 | ✅ 通过 | 真实 API 怪癖回归（SenseNova 空 finish_reason、Ollama 双格式、model 回退） |
| pmx_test.go | 7 | ✅ 通过 | 自包含二进制 fixture 构造器，UTF16/UTF8/invalid/trim 覆盖好 |
| safecall_test.go | 9 | ✅ 通过 | panic 恢复链（string/error/nil/int/void）完整 |
| safecall_integration_test.go | 3 | ✅ 通过（P4） | 名为 integration 实为模拟 panic，与 safecall_test.go 重复覆盖 |

**本轮修复**：3 处测试卫生（全部 testConfigDir(t) 一行修复，零生产代码改动）

---

## 缺陷详情

### P3：ai_binding_test.go 污染用户真实配置（已修）

- **机制**: AiSetLLMConfig（internal/app/ai_binding.go:138）→ a.updateConfig（internal/app/config.go:129）→ 无条件 a.writeConfig（internal/app/model_preset.go:201）→ configDir()（internal/app/app.go:813）/ settingDir(cfg)（internal/app/app.go:806）→ userConfigDir hook（internal/app/app.go:779-780，默认 os.UserConfigDir）。writeConfig 无 launched 门控，测试态照样落盘。
- **后果**: 两测试未调 testConfigDir(t)，GetConfig 会**读**用户真实 config.json（若配了 ResourceRoot 还会 MkdirAll 用户资源目录下的 setting/），再**写回**合并了测试假值（BaseURL=token.sensenova.cn、AIKey=sk-secret-key/new）的配置 → 用户真实 LLM 设置被测试污染。
- **先例**: 同类缺陷 2026-07-17 已在 internal/app/proxy_test.go:208 修复（buglog 注释明言"隔离 configDir，否则 updateConfig 把 tmpDir 写进 %APPDATA%/MikuMikuAR/config.json"），但 ai_binding 两个测试漏网。
- **修复**: 两测试各加 testConfigDir(t)（internal/app/app_test.go:62 定义，t.TempDir + t.Cleanup 恢复 userConfigDir）。

### P4：TestScenePresetDir 落真实用户目录（已修）

- **机制**: internal/app/app_test.go:21 用 &App{} 未隔离，scenePresetDir → presetDir（internal/app/scene_preset.go:15）→ GetConfig（读真实配置）+ settingDir + os.MkdirAll(dir, 0755)。
- **后果**: 测试在真实用户 setting 目录下建 scenes/ 子目录（污染）；若配了 ResourceRoot 则落在用户资源目录。
- **修复**: 加 testConfigDir(t)，GetConfig 读到空配置 → ResourceRoot 为空 → 全落临时目录。

### P4：其余卫生项（登记，不修）

| 文件 | 位置 | 观察 |
|------|------|------|
| shutdown_test.go | TestShutdown_ClosesHTTPServers 末段 | 测试自己先清空 a.httpServers 再调 shutdownServers，末条"期望 0 servers"断言恒真，未真正验证 shutdown 行为 |
| safecall_integration_test.go | 全文件 | 名为 integration 但三用例全是模拟 panic（无真实 zip 提取集成），与 safecall_test.go 大量重复；ExtractZipRecoversFromPanic 名不副实 |
| fs_test.go | TestBasenameFallbackFS_NonExistentRoot | 仅断言不 panic（_ = rec.Code 无状态码断言），弱用例 |
| fs_test.go | CorruptIndexCollisionWarning 尾注 | 注释称"just verify the indexing doesn't panic"，但函数体有两条硬断言（corrupt entries / corruptIndex collision 日志），注释与代码矛盾、过时 |

---

## 亮点（全集群）

- **SSRF 防线可测且齐**: proxy_test 覆盖 host-mismatch（下载前拒绝，不发网络）、isBlockedIP 含 IPv4-mapped IPv6（::ffff:127.0.0.1 等，round14 P3 回归钉死）、dial guard 对 loopback/link-local/private 全拒绝、size cap 超限即中止并清理残留分片。
- **真实 API 怪癖回归**: llm/client_test 把 SenseNova 空 finish_reason 误判结束、Ollama 双格式、req.Model 空回退 config.Model 三个线上坑都钉成回归用例。
- **ADR-253 presence mask 完备**: app_test 10 用例覆盖 partial/zero/explicit-false/full/null-absent/legacy-alias/no-present-legacy，UIState 与 EnvState 对称。
- **配置持久化原子性**: writeConfig 走 tmp+rename（internal/app/model_preset.go:201），测试未破坏该不变量。

---

## 验证

| 项 | 结果 |
|---|---|
| go build ./... | exit 0 |
| go test ./internal/... | 全 ok（app 0.302s / llm / i18nerr / util） |
| go test -tags mpr ./internal/app/ | ok（COOP/COEP On 分支本轮实际执行） |
| go vet ./internal/... | exit 0，无告警 |

## 队列状态

test-files.txt 未审 39 → 27（本轮消 12 项 Go 测试）。剩余 27：TS 测试 8（dialogue-speech、core/backend 7）、scene 4、scripts 16、python 2、Go 余 0。