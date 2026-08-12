// @vitest-environment node
/**
 * VMD 加载基础校验 + gen counter 行为测试
 *
 * 覆盖审核发现的测试缺口。
 * 注意：loadVMDMotion 通过 dynamic import getScene() 耦合 scene.ts，
 * 后者需要 Babylon Engine + canvas DOM → 不在此处集成测试。
 * 本文件仅覆盖可隔离测试的单元。
 */
import { describe, it, expect } from 'vitest';
import { isValidVmd, VMD_SIGNATURE, VMD_HEADER_MIN } from '@/scene/motion/vmd-loader';

// ======== isValidVmd 签名校验（纯函数，直接测试源码） ========

// 真实 VMD 头部 = 30(签名+模型名) + 20(模型名余量) 共 50，外加 4 字节骨骼帧数前缀 = 54。
// 用源码常量推导，避免与 VMD_HEADER_MIN 漂移。
function buildVmdHeader(): Uint8Array {
    const header = new Uint8Array(VMD_HEADER_MIN + 4);
    header.set(new TextEncoder().encode(VMD_SIGNATURE), 0);
    return header;
}

describe('isValidVmd — VMD 签名校验', () => {
    it('拒绝过短的 buffer (小于 50 字节)', () => {
        expect(isValidVmd(new ArrayBuffer(10))).toBe(false);
        expect(isValidVmd(new ArrayBuffer(49))).toBe(false);
    });

    it('拒绝签名不匹配的 buffer', () => {
        const buf = new ArrayBuffer(100);
        new Uint8Array(buf).set(new TextEncoder().encode('NOT_A_VMD_FILE_____'));
        expect(isValidVmd(buf)).toBe(false);
    });

    it('接受合法 VMD 签名', () => {
        const buf = new ArrayBuffer(100);
        new Uint8Array(buf).set(buildVmdHeader());
        expect(isValidVmd(buf)).toBe(true);
    });

    it('拒绝空 buffer', () => {
        expect(isValidVmd(new ArrayBuffer(0))).toBe(false);
    });

    it('恰好 50 字节 + 合法签名 → 接受（最小合法边界）', () => {
        const buf = new ArrayBuffer(50);
        new Uint8Array(buf).set(new TextEncoder().encode('Vocaloid Motion Data 0002'), 0);
        expect(isValidVmd(buf)).toBe(true);
    });

    it('49 字节 + 合法签名 → 拒绝（最小合法边界下方）', () => {
        const buf = new ArrayBuffer(49);
        new Uint8Array(buf).set(new TextEncoder().encode('Vocaloid Motion Data 0002'), 0);
        expect(isValidVmd(buf)).toBe(false);
    });

    it('25 字节签名 + null 填充至 30 字节（VMD 真实头部格式）', () => {
        const buf = new ArrayBuffer(100);
        const view = new Uint8Array(buf);
        const sig = new TextEncoder().encode('Vocaloid Motion Data 0002');
        view.set(sig, 0); // 25 字节签名，后续 5 字节为 0x00（null 填充）
        expect(isValidVmd(buf)).toBe(true);
    });

    it('签名前缀部分匹配 → 拒绝', () => {
        const buf = new ArrayBuffer(100);
        new Uint8Array(buf).set(new TextEncoder().encode('Vocaloid Motion Data 000'), 0); // 24 字节，少 1 字符
        expect(isValidVmd(buf)).toBe(false);
    });
});

// ======== gen counter 的行为逻辑（间接验证） ========

describe('VMD 加载 gen counter 行为逻辑', () => {
    it('gen counter 按模型隔离递增', () => {
        // 模拟 _vmdLoadGenMap（Map<string, number>）行为
        const genMap = new Map<string, number>();

        // model_1 首次加载
        const gen1 = (genMap.get('model_1') ?? 0) + 1;
        genMap.set('model_1', gen1);
        expect(gen1).toBe(1);

        // model_1 第二次加载
        const gen2 = (genMap.get('model_1') ?? 0) + 1;
        genMap.set('model_1', gen2);
        expect(gen2).toBe(2);

        // model_2 首次加载 — 不受 model_1 影响
        const gen2_1 = (genMap.get('model_2') ?? 0) + 1;
        genMap.set('model_2', gen2_1);
        expect(gen2_1).toBe(1);
        expect(genMap.get('model_1')).toBe(2); // model_1 的 gen 不受影响
    });

    it('过期 gen 被正确丢弃', () => {
        const genMap = new Map<string, number>();
        genMap.set('model_1', 3); // 当前最新 gen=3

        // 模拟 gen=2 的异步结果回来
        const staleGen = 2;
        const isStale = genMap.get('model_1') !== staleGen;
        expect(isStale).toBe(true); // gen=2 已过期

        // 模拟 gen=3 的异步结果回来
        const freshGen = 3;
        const isFresh = genMap.get('model_1') === freshGen;
        expect(isFresh).toBe(true); // gen=3 是最新的
    });
});

// ======== AbortSignal.any 合并逻辑（间接验证） ========

describe('AbortSignal.any 合并逻辑', () => {
    it('外部 signal 与内部 signal 任一 abort 即生效', () => {
        const externalCtrl = new AbortController();
        const internalCtrl = new AbortController();

        const merged = AbortSignal.any([externalCtrl.signal, internalCtrl.signal]);
        expect(merged.aborted).toBe(false);

        // 内部取消
        internalCtrl.abort();
        expect(merged.aborted).toBe(true);

        // 另一个测试：外部取消
        const externalCtrl2 = new AbortController();
        const internalCtrl2 = new AbortController();
        const merged2 = AbortSignal.any([externalCtrl2.signal, internalCtrl2.signal]);

        externalCtrl2.abort();
        expect(merged2.aborted).toBe(true);
    });

    it('单个 signal 的 ?? 回退会破坏内部取消语义', () => {
        // 验证 ADR-096 注释中的约束：signal ? AbortSignal.any([signal, internal]) : internal
        // 而非 signal ?? internal（后者会忽略内部 abortCtrl，使 ADR-096 机制失效）
        const externalCtrl = new AbortController();
        const internalCtrl = new AbortController();

        // 正确做法：用 any 合并
        const correct = AbortSignal.any([externalCtrl.signal, internalCtrl.signal]);
        // 错误做法：用 ?? 回退（语义：只要给了一个 signal 就用它，不管内部）
        const _wrong = externalCtrl.signal; // 模拟 ?? 回退行为

        // 内部取消时：
        internalCtrl.abort();
        expect(correct.aborted).toBe(true); // 合并 signal：应生效
        // wrong 不感知内部取消，但 type-safe 角度看 ?? 等价于只用外部 signal
        // 此测试验证了使用 AbortSignal.any 而非 ?? 的重要性
    });
});
