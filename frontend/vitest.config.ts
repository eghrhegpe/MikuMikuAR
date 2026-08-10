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
        // [2026-08] 全量 56s 的墙钟由每 worker 固定成本（环境+模块导入 ~40s）
        // 主导，与测试数量弱相关：排除全部 14 个 int 文件（累加 36.7s）后
        // test:unit 仍 53.3s（仅省 2.7s）——删/减测试救不了耗时，勿生此念。
        // no-isolate 复测（2026-08-10）342 失败，比 ADR-219 判死时的 229 更差
        // （债随用例增长），结构性提速仅剩「清偿 mock 形状债 → isolate=false」
        // 一条大工程路。日常反馈用 npm run test:file -- <路径>（秒级），
        // 全量留给提交前/CI。
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
        deps: {
            optimizer: {
                ssr: {
                    enabled: true,
                    include: ['babylon-mmd', '@babylonjs/core', '@babylonjs/materials'],
                },
            },
        },
        testTimeout: 10000,
        hookTimeout: 15000,
        forceExit: true,
        // 并发上限：24 核机器上实测 12 路最优（32.6s），16/20 因每 worker 重复
        // 编译 babylon-mmd 等重模块，边际收益转负。瓶颈是环境搭建+模块导入而非
        // CPU 核数，故固定 12 而不吃满全核。isolate 保持默认 true（关掉会暴露
        // 测试间状态污染，见 ADR/技术债），待清理污染后再评估 isolate=false。
        // [2026-08] 308 文件/4994 用例规模复核：8/12/16 worker 墙钟全在 55-58s
        // 噪声带内（55.42/55.95/56.21s），pool=threads 仅 54.34s（~3%，且 Babylon/
        // WASM 场景在线程池下不如进程稳，ADR-219 已否决）。每 worker 的
        // environment+import 累加恒定 ~40s，即「环境搭建+重模块编译」是绝对瓶颈，
        // 墙钟被其钉死，worker 数/池类型均非杠杆——改此配置前先重读 ADR-219。
        maxWorkers: 12,
        minWorkers: 12,
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
