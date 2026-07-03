// beat-detector.ts — Web Audio API 节拍检测
// [doc:architecture] 程序化动作子系统 — 节拍检测
// 能量峰值法：低频能量 > 1.3× 滑动均值 且 距上次 beat > 250ms → 触发

const BASS_BIN_COUNT = 10; // 前 10 个频段 (~0-430Hz @ 44100/256 fft)
const ENERGY_HISTORY_SIZE = 43; // ~1s @ 43fps update
const BEAT_THRESHOLD = 1.3;
const MIN_BEAT_INTERVAL_MS = 250;
const BPM_WINDOW = 8; // 最近 8 次 beat 间隔求均值

// BPM 量化：偏差 ±5 BPM 内吸附到常见值，大偏差保留原始值
const COMMON_BPMS = [80, 90, 100, 110, 120, 130, 140, 150, 160, 170, 180];
const QUANTIZE_THRESHOLD = 5;
function quantizeBpm(raw: number): number {
    for (const bpm of COMMON_BPMS) {
        if (Math.abs(raw - bpm) <= QUANTIZE_THRESHOLD) {
            return bpm;
        }
    }
    return raw;
}

export class BeatDetector {
    private ctx: AudioContext | null = null;
    private analyser: AnalyserNode | null = null;
    private source: MediaElementAudioSourceNode | null = null;
    /** GainNode：连接 analyser → gain → destination，使音量独立于 audioElement.volume */
    private gain: GainNode | null = null;
    private freqData: Uint8Array<ArrayBuffer> = new Uint8Array(0);
    private energyHistory: number[] = [];
    private energySum = 0; // running sum for avg
    private lastBeatTime = 0;
    private beatTimes: number[] = []; // 最近 beat 时间戳 (ms)
    private currentBpm = 120;
    private phaseStartTime = 0;
    private phaseInterval = 500; // ms per beat
    private bpmQuantizeEnabled = true; // P1 开关：BPM 量化（默认开）

    /** 接入音频元素。惰性创建 AudioContext + GainNode。
     *  注意：createMediaElementSource 后音频路由经 AudioContext，
     *  须 resume() 否则浏览器自动播放策略下静音。 */
    attach(audioElement: HTMLAudioElement): void {
        if (this.ctx) {
            return;
        }
        const AudioCtx =
            window.AudioContext ||
            (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
        if (!AudioCtx) {
            return;
        }
        try {
            this.ctx = new AudioCtx();
        } catch (err) {
            console.warn('BeatDetector: AudioContext creation failed:', err);
            return;
        }
        if (this.ctx.state === 'suspended') {
            this.ctx.resume().catch(() => {});
        }
        this.source = this.ctx.createMediaElementSource(audioElement);
        this.analyser = this.ctx.createAnalyser();
        this.analyser.fftSize = 256;
        this.analyser.smoothingTimeConstant = 0.3;
        this.freqData = new Uint8Array(this.analyser.frequencyBinCount);
        // GainNode：使音量控制独立于 audioElement.volume（被 createMediaElementSource 旁路）
        this.gain = this.ctx.createGain();
        this.gain.gain.value = 1;
        this.source.connect(this.analyser);
        this.analyser.connect(this.gain);
        this.gain.connect(this.ctx.destination);
    }

    /** 设置输出音量 (0~1)。通过 GainNode 控制，独立于 audioElement.volume。 */
    setVolume(value: number): void {
        if (this.gain) {
            this.gain.gain.value = Math.max(0, Math.min(1, value));
        }
    }

    /** 释放所有 AudioContext 资源。 */
    dispose(): void {
        if (this.gain) {
            this.gain.disconnect();
            this.gain = null;
        }
        if (this.analyser) {
            this.analyser.disconnect();
            this.analyser = null;
        }
        if (this.source) {
            this.source.disconnect();
            this.source = null;
        }
        if (this.ctx) {
            this.ctx.close();
            this.ctx = null;
        }
        this.freqData = new Uint8Array(0);
        this.energyHistory = [];
        this.energySum = 0;
        this.beatTimes = [];
        this.lastBeatTime = 0;
        this.currentBpm = 120;
        this.phaseInterval = 500;
        this.phaseStartTime = 0;
    }

    /** 每帧调用。更新能量历史、检测 beat、估计 BPM。 */
    update(): void {
        if (!this.analyser) {
            return;
        }
        this.analyser.getByteFrequencyData(this.freqData);

        let sum = 0;
        const bins = Math.min(BASS_BIN_COUNT, this.freqData.length);
        for (let i = 0; i < bins; i++) {
            sum += this.freqData[i];
        }
        const energy = bins > 0 ? sum / bins : 0;

        // 滑动窗口：维护 running sum 避免全量 reduce
        this.energyHistory.push(energy);
        this.energySum += energy;
        if (this.energyHistory.length > ENERGY_HISTORY_SIZE) {
            this.energySum -= this.energyHistory.shift()!;
        }

        const avg = this.energySum / this.energyHistory.length;

        const now = performance.now();
        if (
            energy > avg * BEAT_THRESHOLD &&
            energy > 30 &&
            now - this.lastBeatTime > MIN_BEAT_INTERVAL_MS
        ) {
            this.lastBeatTime = now;
            this.beatTimes.push(now);
            if (this.beatTimes.length > BPM_WINDOW + 1) {
                this.beatTimes.shift();
            }
            this.phaseStartTime = now;
            if (this.beatTimes.length >= 2) {
                const intervals: number[] = [];
                for (let i = 1; i < this.beatTimes.length; i++) {
                    intervals.push(this.beatTimes[i] - this.beatTimes[i - 1]);
                }
                const avgInterval = intervals.reduce((a, b) => a + b, 0) / intervals.length;
                if (avgInterval > 0) {
                    const rawBpm = Math.round(60000 / avgInterval);
                    this.currentBpm = this.bpmQuantizeEnabled ? quantizeBpm(rawBpm) : rawBpm;
                    this.phaseInterval = 60000 / this.currentBpm;
                }
            }
        }
    }

    /** 重置状态（音频停止/切换时调用）。 */
    reset(): void {
        this.energyHistory = [];
        this.energySum = 0;
        this.beatTimes = [];
        this.lastBeatTime = 0;
        this.currentBpm = 120;
        this.phaseInterval = 500;
        this.phaseStartTime = performance.now();
    }

    getBPM(): number {
        return this.currentBpm;
    }

    /** 获取/设置 BPM 量化开关（默认 true）。关闭后使用原始 BPM 值。 */
    getBpmQuantizeEnabled(): boolean {
        return this.bpmQuantizeEnabled;
    }
    setBpmQuantizeEnabled(v: boolean): void {
        this.bpmQuantizeEnabled = v;
    }

    /** 当前 beat 周期内的相位 0..1。 */
    getBeatPhase(): number {
        const elapsed = performance.now() - this.phaseStartTime;
        return Math.min(1, elapsed / Math.max(1, this.phaseInterval));
    }

    /** 当前帧指定频段的平均能量 (0..1)。须在 update() 之后调用。 */
    getLevel(startBin = 0, endBin?: number): number {
        if (!this.analyser) {
            return 0;
        }
        return BeatDetector.getLevel(this.freqData, startBin, endBin);
    }

    hasAudio(): boolean {
        return this.analyser !== null;
    }

    /** 纯逻辑：给定能量序列，返回 beat 触发帧索引。供测试用。 */
    static detectBeatsFromEnergies(
        energies: number[],
        threshold = BEAT_THRESHOLD,
        minInterval = 6
    ): number[] {
        const beats: number[] = [];
        const history: number[] = [];
        let sum = 0;
        for (let i = 0; i < energies.length; i++) {
            history.push(energies[i]);
            sum += energies[i];
            if (history.length > ENERGY_HISTORY_SIZE) {
                sum -= history.shift()!;
            }
            const avg = sum / history.length;
            const lastBeat = beats.length > 0 ? beats[beats.length - 1] : -minInterval;
            if (energies[i] > avg * threshold && energies[i] > 30 && i - lastBeat >= minInterval) {
                beats.push(i);
            }
        }
        return beats;
    }

    /** 纯逻辑：从 beat 时间戳数组计算 BPM。 */
    static bpmFromIntervals(intervalsMs: number[]): number {
        if (intervalsMs.length === 0) {
            return 120;
        }
        const avg = intervalsMs.reduce((a, b) => a + b, 0) / intervalsMs.length;
        return avg > 0 ? Math.round(60000 / avg) : 120;
    }

    /** 纯逻辑：从频谱数据计算指定频段平均能量 (0..1)。 */
    static getLevel(freqData: Uint8Array, startBin = 0, endBin?: number): number {
        if (freqData.length === 0) {
            return 0;
        }
        const start = Math.max(0, startBin);
        const end = Math.min(endBin ?? freqData.length, freqData.length);
        if (end <= start) {
            return 0;
        }
        let sum = 0;
        for (let i = start; i < end; i++) {
            sum += freqData[i];
        }
        return sum / (end - start) / 255;
    }
}
