// beat-detector.ts — Web Audio API 节拍检测
// [doc:architecture] 程序化动作子系统 — 节拍检测
// 能量峰值法：低频能量 > 1.3× 滑动均值 且 距上次 beat > 250ms → 触发

export interface BeatInfo {
    bpm: number;        // 当前估计 BPM
    beatPhase: number;  // 0..1 当前 beat 周期内的相位
    isBeat: boolean;    // 本帧是否触发 beat
    energy: number;     // 当前低频能量 (0..255)
}

const BASS_BIN_COUNT = 10;   // 前 10 个频段 (~0-430Hz @ 44100/256 fft)
const ENERGY_HISTORY_SIZE = 43; // ~1s @ 43fps update
const BEAT_THRESHOLD = 1.3;
const MIN_BEAT_INTERVAL_MS = 250;
const BPM_WINDOW = 8; // 最近 8 次 beat 间隔求均值

export class BeatDetector {
    private analyser: AnalyserNode | null = null;
    private freqData: Uint8Array = new Uint8Array(0);
    private energyHistory: number[] = [];
    private lastBeatTime = 0;
    private beatTimes: number[] = []; // 最近 beat 时间戳 (ms)
    private currentBpm = 120;
    private phaseStartTime = 0;
    private phaseInterval = 500; // ms per beat
    private isBeatFlag = false;

    /** 接入音频元素。惰性创建 AudioContext。
     *  注意：createMediaElementSource 后音频路由经 AudioContext，
     *  须 resume() 否则浏览器自动播放策略下静音。 */
    attach(audioElement: HTMLAudioElement): void {
        const AudioCtx = (window as any).AudioContext || (window as any).webkitAudioContext;
        if (!AudioCtx) return;
        const ctx = new AudioCtx();
        // 浏览器 autoplay 策略：AudioContext 默认 suspended，需用户交互后 resume
        if (ctx.state === "suspended") ctx.resume().catch(() => {});
        const source = ctx.createMediaElementSource(audioElement);
        this.analyser = ctx.createAnalyser();
        this.analyser.fftSize = 256;
        this.analyser.smoothingTimeConstant = 0.3;
        this.freqData = new Uint8Array(this.analyser.frequencyBinCount);
        source.connect(this.analyser);
        this.analyser.connect(ctx.destination);
    }

    /** 每帧调用。更新能量历史、检测 beat、估计 BPM。 */
    update(): void {
        if (!this.analyser) return;
        this.analyser.getByteFrequencyData(this.freqData as any);

        // 计算低频能量
        let sum = 0;
        const bins = Math.min(BASS_BIN_COUNT, this.freqData.length);
        for (let i = 0; i < bins; i++) sum += this.freqData[i];
        const energy = bins > 0 ? sum / bins : 0;

        // 更新滑动历史
        this.energyHistory.push(energy);
        if (this.energyHistory.length > ENERGY_HISTORY_SIZE) this.energyHistory.shift();

        // 计算历史均值
        const avg = this.energyHistory.reduce((a, b) => a + b, 0) / Math.max(1, this.energyHistory.length);

        // beat 检测
        const now = performance.now();
        this.isBeatFlag = false;
        if (energy > avg * BEAT_THRESHOLD && energy > 30
            && now - this.lastBeatTime > MIN_BEAT_INTERVAL_MS) {
            this.isBeatFlag = true;
            this.lastBeatTime = now;
            this.beatTimes.push(now);
            if (this.beatTimes.length > BPM_WINDOW + 1) this.beatTimes.shift();
            this.phaseStartTime = now;
            // 更新 BPM
            if (this.beatTimes.length >= 2) {
                const intervals: number[] = [];
                for (let i = 1; i < this.beatTimes.length; i++) {
                    intervals.push(this.beatTimes[i] - this.beatTimes[i - 1]);
                }
                const avgInterval = intervals.reduce((a, b) => a + b, 0) / intervals.length;
                if (avgInterval > 0) {
                    this.currentBpm = Math.round(60000 / avgInterval);
                    this.phaseInterval = avgInterval;
                }
            }
        }
    }

    /** 重置状态（音频停止/切换时调用）。 */
    reset(): void {
        this.energyHistory = [];
        this.beatTimes = [];
        this.lastBeatTime = 0;
        this.currentBpm = 120;
        this.phaseInterval = 500;
        this.phaseStartTime = performance.now();
        this.isBeatFlag = false;
    }

    getBPM(): number { return this.currentBpm; }

    /** 当前 beat 周期内的相位 0..1。 */
    getBeatPhase(): number {
        const elapsed = performance.now() - this.phaseStartTime;
        return Math.min(1, elapsed / Math.max(1, this.phaseInterval));
    }

    isBeat(): boolean { return this.isBeatFlag; }
    getEnergy(): number { return this.energyHistory[this.energyHistory.length - 1] ?? 0; }
    hasAudio(): boolean { return this.analyser !== null; }

    /** 纯逻辑：给定能量序列，返回 beat 触发帧索引。供测试用。 */
    static detectBeatsFromEnergies(energies: number[], threshold = BEAT_THRESHOLD, minInterval = 6): number[] {
        const beats: number[] = [];
        const history: number[] = [];
        for (let i = 0; i < energies.length; i++) {
            history.push(energies[i]);
            if (history.length > ENERGY_HISTORY_SIZE) history.shift();
            const avg = history.reduce((a, b) => a + b, 0) / history.length;
            const lastBeat = beats.length > 0 ? beats[beats.length - 1] : -minInterval;
            if (energies[i] > avg * threshold && energies[i] > 30 && i - lastBeat >= minInterval) {
                beats.push(i);
            }
        }
        return beats;
    }

    /** 纯逻辑：从 beat 时间戳数组计算 BPM。 */
    static bpmFromIntervals(intervalsMs: number[]): number {
        if (intervalsMs.length === 0) return 120;
        const avg = intervalsMs.reduce((a, b) => a + b, 0) / intervalsMs.length;
        return avg > 0 ? Math.round(60000 / avg) : 120;
    }
}
