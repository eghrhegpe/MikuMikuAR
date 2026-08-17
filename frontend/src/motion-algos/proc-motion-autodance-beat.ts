/**
 * proc-motion-autodance-beat.ts
 * 节拍栅格工具：拍号/相位/弹跳包络/强拍权重/重心摆动。
 *
 * [doc:adr-271] 从 proc-motion-autodance-bones.ts 下移。原因：trunk 与 limbs 两个生成器
 * 都需要这些栅格函数，而 bones.ts 又 re-export 两个生成器，形成
 * `bones ⇄ trunk` / `bones ⇄ limbs` 的双向依赖（size=3 强连通分量）。
 * 栅格数学不依赖任何骨骼解析结果，抽成叶子后两个生成器 → beat ← bones，
 * 环消失；bones.ts 转发这些符号保持外部导入路径不变。
 */

/** 节拍栅格缓存：循环帧数 + 每拍帧数。 */
export interface TrigCache {
    beatFrames: number;
    loopFrames: number;
}

export function buildTrigCache(loopFrames: number, beatFrames: number): TrigCache {
    return { beatFrames, loopFrames };
}

/**
 * 节拍信息：给定帧号，返回它在拍/循环中的相位。
 * 是「节拍栅格」模型的核心——所有生成器据此踩点，而非裸正弦。
 */
export interface BeatInfo {
    /** 全局拍号（从 0 起） */
    beatIndex: number;
    /** 循环内拍号（0..7，8 拍为一循环） */
    beatInLoop: number;
    /** 当前拍内相位 [0,1) */
    beatPhase: number;
    /** 循环内相位 [0,1) */
    loopPhase: number;
}

export function beatInfo(cache: TrigCache, f: number): BeatInfo {
    const beatFrames = cache.beatFrames;
    const loopFrames = cache.loopFrames;
    const beatIndex = Math.floor(f / beatFrames);
    const beatInLoop = ((beatIndex % 8) + 8) % 8;
    const beatPhase = (f % beatFrames) / beatFrames;
    const loopPhase = f / loopFrames;
    return { beatIndex, beatInLoop, beatPhase, loopPhase };
}

/**
 * 每拍弹跳包络：拍头 0 → 拍中峰值 1 → 拍尾 0。
 * 让位移/旋转在「拍点」达到极值，制造踩点感（替代旧的无拍点连续正弦）。
 */
export function beatBounce(beatPhase: number): number {
    return Math.sin(Math.PI * beatPhase);
}

/**
 * 强拍权重：0/4 为强拍、2/6 为次强、其余为弱拍。
 * 制造节奏层次，打破「每拍都一样」的机械重复。
 */
export function downbeatWeight(beatInLoop: number): number {
    if (beatInLoop % 4 === 0) {
        return 1.0;
    }
    if (beatInLoop % 2 === 0) {
        return 0.8;
    }
    return 0.55;
}

/**
 * 重心左右摆动（2 拍周期，period = 2 * beatFrames）：
 * +1 偏左、-1 偏右。用于重心转移与上下半身联动。
 * 在 f=0 与 f=loopFrames 处均为 0（周期整除循环长度），保证无缝循环。
 */
export function swayAt(cache: TrigCache, f: number): number {
    return Math.sin((2 * Math.PI * f) / (2 * cache.beatFrames));
}
