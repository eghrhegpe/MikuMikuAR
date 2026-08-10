import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
    // [2026-08] cacheDir 挪出 node_modules（默认 node_modules/.vite）：
    // CI 每次 npm ci 重装 node_modules 会清掉 vitest transform 缓存 + 预构建产物，
    // 2 核 runner 上每次 push 白付全量编译（实测 vitest --coverage 独占 ~2 分钟）。
    // 挪到 .vitest-cache 后 ci.yml 用 actions/cache 跨 run 复用；本地不受影响。
    cacheDir: path.resolve(__dirname, ".vitest-cache"),
    resolve: {
        alias: {
            // Path aliases (matching tsconfig.json paths)
            "@": path.resolve(__dirname, "src"),
            "@bindings": path.resolve(__dirname, "bindings"),
            // Redirect Engine import to our mock BEFORE esbuild sees the real source.
            // This prevents the _renderLoops parse error on CI (Ubuntu/Node 20).
            "@babylonjs/core/Engines/engine": path.resolve(
                __dirname,
                "src/__tests__/mocks/engine-mock.ts"
            ),
        },
    },
    test: {
        environment: "happy-dom",
        globals: true,
        // 兜底防卡死：
        // 1) testTimeout/hookTimeout 管「用例/钩子本身卡死」——漏挂 mock 或永不 resolve 的
        //    Promise 最多挂 10s/15s 后报超时失败，不拖垮整个 vitest run。
        // 2) forceExit 管「用例全过但进程不退」——如整桶 import 触发 pending 微任务导致
        //    fork worker 回收失败（virtual-skirt 历史 hang 即此形态）。开它可保证 run 终会退出。
        // [2026-08] 全量 56s 的墙钟由每文件固定成本（isolate 下环境重建+模块导入）主导，
        // 与测试数量弱相关：排除全部 14 个 int 文件（累加 36.7s）后
        // test:unit 仍 53.3s（仅省 2.7s）——删/减测试救不了耗时，勿生此念。
        // no-isolate 复测（2026-08-10）342 失败，比 ADR-219 判死时的 229 更差
        // （债随用例增长），结构性提速仅剩「清偿 mock 形状债 → isolate=false」
        // 一条大工程路。日常反馈用 npm run test:file -- <路径>（秒级），
        // 全量留给提交前/CI。
        // [2026-08-10] environment 分流落地（见 ADR-255）：isolate=true 下 happy-dom
        // 环境是「每文件」重建（单文件实测 ~285ms，非每 worker 一次），
        // 无 DOM 依赖的测试文件加 `// @vitest-environment node` 注释分流
        // （首批 181 个，含第二轮 3 个源码模块惰性化解锁的 46 个；
        // 增删以 rg -l "@vitest-environment node" 为准），
        // 全量墙钟 55.95s → ~40s（-29%），环境累加 255s → ~90-105s。
        // 新增测试若纯逻辑请同款标注；依赖 window/document 的保持默认 happy-dom 即可。
        // [2026-08] deps.optimizer 预构建（vitest 4 默认关闭）——CI 视角启用：
        // 本地 24 核 CPU 富余，预构建收益 ~4% 落在噪声带（ROI 负不成立）；
        // 但 CI 是 2 核 runner，CPU 是绝对瓶颈（实测 vitest 独占 ~2 分钟），
        // 预构建把每 worker 重复编译 babylon 的 CPU 总账转成一次预构建，
        // 且产物落 cacheDir（.vitest-cache）由 ci.yml 的 actions/cache 跨 run
        // 复用——每次 push 只付一次预构建，之后全命中缓存。风险：Ubuntu 上
        // .fx shader/WASM 预构建行为未在本地验证（esbuild 0.25 已支持 class
        // field/.fx，vite.config.ts 构建期排除是 dev/build 场景），若 CI 崩
        // 快速回滚此块即可。本地已验证三件套 include 全量 308 全绿 + coverage
        // 4995 全绿。仅预构建 babylon-mmd 无效（依赖链不完整），必须三件套。
        // ⚠️ [2026-08-11 勘误] 上轮「确认不采纳」注释系错误认知：当时 edit
        // 回滚失败未验证，deps 块实际一直在（git log -S 证实 7d36c010 后
        // 从未删除），所谓「关闭基线 30.56s」实为开启态数据。
        // 真对照（2026-08-11）：开启冷 29.76s / 开启热 31.09s / 真关闭 30.93s
        // ——本地 24 核上开/关无差异（±1s 噪声带）。保留开启：决策在 CI 侧
        // （2 核 runner CPU 瓶颈 + .vitest-cache actions/cache 复用），
        // 本地无差异不构成关闭理由。
        deps: {
            optimizer: {
                ssr: {
                    enabled: true,
                    include: ['babylon-mmd', '@babylonjs/core', '@babylonjs/materials'],
                },
            },
        },
        // [2026-08] 测试资产盘点结论（子代理审计，见 vitest.config.ts 同区注释）：
        // ① P0-1 perception int 8→5 文件合并 ✅（682b1ba4，累加 42.5s→30.3s）
        // ② P0-2 env-water mock 重纹理 ✅（b25ec5da，9.1s→2.4s）
        // ③ P0-3 同系列测试文件合并 ✅（本轮：model-detail-ui 3→1、
        //    model-preset 5→1、material-editor 4→1、library-core 6→1，
        //    import 累加 201s→154s；vitest isolate 每文件独立依赖图，
        //    self 仅 ~100ms 却付 ~5s total import 的文件优先合并）
        // ④ P1-1 双份测试删 8 文件 ✅（4a79fd3d，删 61 重复用例）
        // ⑤ P1-3 坏断言修复 ✅（a0c78e2f）
        // ⑥ P2 目录整理 ❌ 不采纳：70 文件移动 + import 路径重写无 codemod
        //    支持，纯组织收益零、破坏风险高——保持平铺命名约定。
        // [2026-08] deps.optimizer 预构建决策（vitest 4 默认关闭）——CI 视角启用：
        // 本地 24 核 CPU 富余，三件套 include（babylon-mmd/@babylonjs/core/
        // @babylonjs/materials）热缓存 50.4-51.6s vs 关闭 54-56s（省 ~5s/~9%）；
        // 仅预构建 babylon-mmd 无效（依赖链不完整），必须三件套。
        // 后续改此配置前先读本段 + vitest.config.ts 顶部结论区。
        testTimeout: 10000,
        hookTimeout: 15000,
        forceExit: true,
        // [2026-08-11] maxWorkers 12→8（ADR-257）：并发实测双 AI 各 12 worker
        // （24 核拉满）69.4s > 各 8 worker 64.3s——核占满后 CPU 竞争使墙钟反超；
        // 单 AI 8 核仅慢 3.7s（43.7 vs 40.0s）。共享机器场景 8 核是资源甜点，
        // 留 8 核余量给另一 AI/IDE/构建。4 核不可取（56.2s）。CI（2 核 runner）
        // 不受影响（worker 数由机器核数钳制）。ADR-219 的 isolate/预构建决策保留。
        // 历史参考：12 路在 308 文件/4994 用例时代单 AI 独占最优（55.95s→40s，
        // ADR-255/256 合并后），但未考虑共享机器；16/20 因每 worker 重复编译
        // babylon 边际收益转负（ADR-219 原文）。
        maxWorkers: 8,
        minWorkers: 8,
        exclude: [
            "e2e/**",
            "node_modules/**",
            "**/*.perf.test.ts",
        ],
        setupFiles: ["./src/__tests__/setup-wails.ts"],
        coverage: {
            provider: "v8",
            reporter: ["text-summary", "html", "json"],
            include: ["src/**/*.ts"],
            exclude: [
                "src/**/*.test.ts",
                "src/__tests__/**",
                "src/**/index.ts",
                "src/wailsjs/**",
            ],
            thresholds: {
                // 诚实基线 35.59/28.37/30.91/35.51（2026-07-25；6 个测试文件已恢复计入覆盖率）
                // 旧基线 31.87/24.75/27.55/31.94 因排除 223 用例失真，已作废。
                // 该阈值仅防止「整体覆盖率回退」，不保护「新代码有测试」——新代码保护见 scripts/check-diff-coverage.mjs（P8-A）。
                lines: 35,
                branches: 28,
                functions: 30,
                statements: 35,
            },
        },
    },
});
