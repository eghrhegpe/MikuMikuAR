/**
 * [doc:adr-273] 场景启动顺序显式化（boot plan）——纯机制层，零 Babylon / 零 scene 依赖。
 *
 * 问题：`_doInitScene()` 里的装配顺序原先只活在**语句行号**和四段注释里
 * （Loader 必须在 modelManager 之后、footstep 必须在 startFeetAdjustment 之后……）。
 * 把两行换个位置，`tsc` 不报、`vitest` 不报（headless 下多数子系统是空操作），
 * 只有真实加载模型时才炸——因为 `scene-context.ts` 的槽类型写成 `ModelManager`
 * 而不是 `ModelManager | undefined`，类型系统在这里说了谎。
 *
 * 解法：把顺序变成**数据**。每个步骤声明自己 `requires`（消费哪些资源）与
 * `provides`（产出哪些资源），执行器按声明顺序跑，并在两个地方强制校验：
 *   1. `validateBootPlan()` —— 运行前静态检查（缺依赖 / 重复 id / 重复 provide），纯函数；
 *   2. `runBootPlan()` —— 运行时断言（依赖未被更早的步骤提供 → 立刻抛错，报出步 id 与资源名；
 *      声明了 provide 却没在返回值里给出 → 立刻抛错）。
 *
 * 为什么 `run(deps)` 只拿声明过的资源：这样依赖不是"我记得要这么做"，
 * 而是"不给我 ModelManager 我连参都传不出来"。类型是这里的门禁。
 */

import type { IMmdRuntime } from 'babylon-mmd/esm/Runtime/IMmdRuntime';
import type { BeatDetector } from '@/motion-algos/beat-detector';
import type { ModelManager } from './manager/model-manager';

/** 启动期在步骤之间流动的资源名。新增资源必须同时在这里和 {@link BootResourceMap} 里登记。 */
export type BootResource =
    | 'mmd-loaders'
    | 'mmd-runtime'
    | 'wind-physics'
    | 'ground-collision'
    | 'lighting'
    | 'renderer'
    | 'env'
    | 'beat'
    | 'beat-attach'
    | 'scene-events'
    | 'runtime-callbacks'
    | 'model-manager'
    | 'model-callbacks'
    | 'loader'
    | 'playback'
    | 'feet-adjustment'
    | 'footstep'
    | 'bone-override'
    | 'wasm-ik-resolver'
    | 'motion-modules'
    | 'env-state'
    | 'sun-disc'
    | 'render-bridge'
    | 'ai-bridge';

/**
 * 资源名 → 类型。`void` 表示"该步骤无产出，但它的完成必须先于消费者"——
 * 这是纯顺序契约的显式写法，别改成从 requires 里删掉（删掉就丢掉了顺序）。
 */
export interface BootResourceMap {
    'mmd-loaders': void;
    'mmd-runtime': IMmdRuntime;
    'wind-physics': void;
    'ground-collision': void;
    lighting: void;
    renderer: void;
    env: void;
    beat: BeatDetector;
    'beat-attach': void;
    'scene-events': void;
    'runtime-callbacks': void;
    'model-manager': ModelManager;
    'model-callbacks': void;
    loader: void;
    playback: void;
    'feet-adjustment': void;
    footstep: void;
    'bone-override': void;
    'wasm-ik-resolver': void;
    'motion-modules': void;
    'env-state': void;
    'sun-disc': void;
    'render-bridge': void;
    'ai-bridge': void;
}

/** 步骤拿到的依赖表：只含它声明过的键，且值类型由 {@link BootResourceMap} 决定。 */
export type BootDeps<R extends BootResource> = { [K in R]: BootResourceMap[K] };

/** 步骤的返回值：必须包含它声明的每一个 `provides` 键（执行器会逐个核对）。 */
export type BootOutputs = Partial<{ [K in BootResource]: BootResourceMap[K] }>;

export interface BootStep<R extends BootResource = BootResource> {
    /** 步骤标识，报错与测试定位用。同一 plan 内唯一。 */
    readonly id: string;
    /** 该步骤消费的资源。执行器保证它们全部由**更早**的步骤提供。 */
    readonly requires: readonly R[];
    /** 该步骤产出的资源。`run` 的返回值必须逐个带上这些键。 */
    readonly provides: readonly BootResource[];
    /**
     * 执行步骤。注意这里用的是**方法语法**而非属性函数类型：方法参数是双变的，
     * 从而 `BootStep<'beat'>` 可以安全地放进 `BootStep<BootResource>[]`（列表元素
     * 各自的 R 已经被精确推断过）。改成 `run: (deps) => ...` 属性写法会让整个数组推不出来。
     */
    run(deps: BootDeps<R>): BootOutputs | Promise<BootOutputs>;
}

/**
 * 构造单个步骤并保留 `requires` 的字面量类型，使 `run(deps)` 里的 `deps` 精确到
 * 该步骤真正需要的资源（而不是整张资源表——那样类型又在撒谎）。
 */
export function defineBootStep<R extends BootResource>(step: BootStep<R>): BootStep<R> {
    return step;
}

/** 启动 plan 在启动过程中失败（顺序违约 / 提供缺失）。带上步骤 id 便于定位。 */
export class BootPlanError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'BootPlanError';
    }
}

/**
 * 静态校验，**不执行任何步骤**。返回人类可读的问题列表，空数组表示 plan 合法。
 *
 * 检查项：
 * - 步骤 id 重复（报错时无法定位到底是谁）；
 * - `requires` 中的资源没有任何更早的步骤提供（顺序错误，或忘了 provide）；
 * - 同一资源被两个步骤 provide（谁是权威？不允许含糊）；
 * - 步骤 require 自己 provide 的东西（自环，说明声明写错了）。
 */
export function validateBootPlan(plan: readonly BootStep<BootResource>[]): string[] {
    const problems: string[] = [];
    const seenIds = new Set<string>();
    const providers = new Map<BootResource, string>();

    plan.forEach((step, index) => {
        if (seenIds.has(step.id)) {
            problems.push(`duplicate step id "${step.id}" (position ${index})`);
        }
        seenIds.add(step.id);

        for (const resource of step.requires) {
            if ((step.provides as readonly BootResource[]).includes(resource)) {
                problems.push(`step "${step.id}" requires "${resource}" which it also provides (self-dependency)`);
                continue;
            }
            if (!providers.has(resource)) {
                problems.push(
                    `step "${step.id}" (position ${index}) requires "${resource}", but no earlier step provides it`,
                );
            }
        }

        for (const resource of step.provides) {
            const existing = providers.get(resource);
            if (existing !== undefined) {
                problems.push(`resource "${resource}" provided by both "${existing}" and "${step.id}"`);
                continue;
            }
            providers.set(resource, step.id);
        }
    });

    return problems;
}

/**
 * 执行 plan：先静态校验，再逐步跑，并把每步返回的资源登记进 satisfied 表。
 *
 * 顺序违约（依赖早于提供）由 `validateBootPlan()` 在执行**前**拦下，因此这里只剩
 * 一类只能在运行期发现的问题："声明了 provide 却没在返回值里给出"——它的失败信息里
 * 同时给出步 id 与资源名，因为最常见的故障是改代码时顺手删了 return 里的一项。
 *
 * @returns 最终资源表（供调用方读取，如 dispose 句柄）；平时可以忽略。
 */
export async function runBootPlan(
    plan: readonly BootStep<BootResource>[],
): Promise<Map<BootResource, unknown>> {
    const problems = validateBootPlan(plan);
    if (problems.length > 0) {
        throw new BootPlanError(
            ['invalid boot plan (' + problems.length + ' problem(s)):', ...problems.map((p) => '  - ' + p)].join('\n'),
        );
    }

    const satisfied = new Map<BootResource, unknown>();
    for (const step of plan) {
        const deps = Object.fromEntries(step.requires.map((r) => [r, satisfied.get(r)])) as BootDeps<BootResource>;
        const outputs = await step.run(deps);

        for (const resource of step.provides) {
            if (!(resource in outputs)) {
                throw new BootPlanError(
                    `boot step "${step.id}" declares provides "${resource}", but its run() did not return it`,
                );
            }
            satisfied.set(resource, outputs[resource]);
        }
        for (const key of Object.keys(outputs) as BootResource[]) {
            if (!(step.provides as readonly BootResource[]).includes(key)) {
                throw new BootPlanError(
                    `boot step "${step.id}" returned undeclared resource "${key}" (add it to provides)`,
                );
            }
        }
    }
    return satisfied;
}
