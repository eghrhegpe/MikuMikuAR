import { Color4, Vector3, Texture, GPUParticleSystem, ParticleSystem } from '@babylonjs/core';
import { EnvState, envState } from '@/core/config';
import { getWindVector } from '@/core/physics/wind-utils';
import { _envSys, getScene, addRipple } from './env-impl';

// ======== Particle System ========
let _currentParticleType: EnvState['particleType'] = 'none';
const _particleTextures = new Map<string, Texture>();

// ======== Splash System (Phase B) ========
let _splashSystem: GPUParticleSystem | null = null;

// 保存粒子系统创建时的初始发射方向，风力基于此计算，避免叠加
let _initialDir1: Vector3 | null = null;
let _initialDir2: Vector3 | null = null;

// 保存基础参数值（未乘 multiplier 前的值），供运行时滑条更新使用
let _baseEmitRate = 0;
let _baseMinSize = 0;
let _baseMaxSize = 0;
let _baseMinEmitPower = 0;
let _baseMaxEmitPower = 0;

// ---------- 全景天气 vs 局部效果参数 ----------
// 全景天气（雨/雪/樱花/落叶）：粒子出生在世界地面以上固定高度，XZ 大幅覆盖
const WEATHER_HEIGHT_ABOVE_GROUND = 25; // 发射器在 groundLevel 以上 25 单位
const WEATHER_BOX_Y_RANGE = 5; // box emitter 垂直带宽度（出生 Y 偏移范围）
const WEATHER_BOX_XZ_HALF = 40; // XZ 半宽（80×80 覆盖区）

// 局部效果：相对于 groundLevel 的偏移
const FIREFLY_HEIGHT_OFFSET = 1.5;
const FIREWORK_HEIGHT_OFFSET = 8;

function makeParticleTexture(kind: string, externalUrl?: string): Texture {
    const scene = getScene();

    // 自定义纹理优先：从外部图片加载
    if (externalUrl) {
        const cacheKey = `_custom_${externalUrl}`;
        const cached = _particleTextures.get(cacheKey);
        if (cached) {
            return cached;
        }
        const tex = new Texture(externalUrl, scene, false, false);
        tex.hasAlpha = true;
        _particleTextures.set(cacheKey, tex);
        return tex;
    }

    const cached = _particleTextures.get(kind);
    if (cached) {
        return cached;
    }
    const canvas = document.createElement('canvas');
    canvas.width = 64;
    canvas.height = 64;
    const ctx = canvas.getContext('2d')!;
    drawParticleShape(ctx, kind);
    const tex = new Texture(canvas.toDataURL(), scene, false, false);
    tex.hasAlpha = true;
    _particleTextures.set(kind, tex);
    return tex;
}

function drawParticleShape(ctx: CanvasRenderingContext2D, kind: string): void {
    ctx.clearRect(0, 0, 64, 64);
    const cx = 32,
        cy = 32;
    switch (kind) {
        case 'sakura': {
            ctx.fillStyle = '#ffb7c5';
            for (let i = 0; i < 5; i++) {
                ctx.save();
                ctx.translate(cx, cy);
                ctx.rotate((i * Math.PI * 2) / 5);
                ctx.beginPath();
                ctx.ellipse(0, -15, 7, 13, 0, 0, Math.PI * 2);
                ctx.fill();
                ctx.restore();
            }
            ctx.fillStyle = '#ffe080';
            ctx.beginPath();
            ctx.arc(cx, cy, 5, 0, Math.PI * 2);
            ctx.fill();
            break;
        }
        case 'rain': {
            const grad = ctx.createLinearGradient(32, 6, 32, 58);
            grad.addColorStop(0, 'rgba(180,210,255,0)');
            grad.addColorStop(0.5, 'rgba(200,225,255,0.95)');
            grad.addColorStop(1, 'rgba(220,235,255,0)');
            ctx.fillStyle = grad;
            ctx.fillRect(30, 6, 4, 52);
            break;
        }
        case 'snow': {
            ctx.strokeStyle = 'rgba(255,255,255,0.95)';
            ctx.lineWidth = 2.5;
            ctx.lineCap = 'round';
            for (let i = 0; i < 6; i++) {
                ctx.save();
                ctx.translate(cx, cy);
                ctx.rotate((i * Math.PI) / 3);
                ctx.beginPath();
                ctx.moveTo(0, 0);
                ctx.lineTo(0, -24);
                ctx.moveTo(0, -15);
                ctx.lineTo(-5, -21);
                ctx.moveTo(0, -15);
                ctx.lineTo(5, -21);
                ctx.stroke();
                ctx.restore();
            }
            break;
        }
        case 'fireworks': {
            const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, 30);
            grad.addColorStop(0, 'rgba(255,240,180,1)');
            grad.addColorStop(0.3, 'rgba(255,200,100,0.6)');
            grad.addColorStop(1, 'rgba(255,150,50,0)');
            ctx.fillStyle = grad;
            ctx.fillRect(0, 0, 64, 64);
            ctx.strokeStyle = 'rgba(255,255,220,0.9)';
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.moveTo(cx, 4);
            ctx.lineTo(cx, 60);
            ctx.moveTo(4, cy);
            ctx.lineTo(60, cy);
            ctx.stroke();
            break;
        }
        case 'fireflies': {
            const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, 28);
            grad.addColorStop(0, 'rgba(210,255,130,1)');
            grad.addColorStop(0.4, 'rgba(150,255,80,0.6)');
            grad.addColorStop(1, 'rgba(100,200,50,0)');
            ctx.fillStyle = grad;
            ctx.fillRect(0, 0, 64, 64);
            break;
        }
        case 'leaves': {
            ctx.fillStyle = '#c9742a';
            ctx.save();
            ctx.translate(cx, cy);
            ctx.rotate(-0.3);
            ctx.beginPath();
            ctx.ellipse(0, 0, 9, 21, 0, 0, Math.PI * 2);
            ctx.fill();
            ctx.strokeStyle = '#8a4a18';
            ctx.lineWidth = 1.5;
            ctx.beginPath();
            ctx.moveTo(0, -19);
            ctx.lineTo(0, 19);
            ctx.stroke();
            ctx.restore();
            break;
        }
        case 'splash': {
            // 溅射水滴：小圆形白色粒子
            const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, 12);
            grad.addColorStop(0, 'rgba(220,235,255,0.9)');
            grad.addColorStop(0.5, 'rgba(200,220,255,0.5)');
            grad.addColorStop(1, 'rgba(180,210,255,0)');
            ctx.fillStyle = grad;
            ctx.fillRect(0, 0, 64, 64);
            break;
        }
        default: {
            console.warn('[drawParticleShape] unknown particle kind: ' + kind);
            ctx.fillStyle = '#ff00ff';
            ctx.fillRect(0, 0, 64, 64);
            break;
        }
    }
}

export function createParticleEmitter(type: EnvState['particleType'], windEnabled: boolean): void {
    if (_envSys.particles.system && _currentParticleType === type) {
        return;
    }

    if (_envSys.particles.system) {
        disposeParticles();
    }
    _currentParticleType = type;
    if (type === 'none') {
        return;
    }

    const scene = getScene();

    // capacity >= max(emitRate) * max(maxLifeTime) * 2.5
    // 雨上限：1000 * 2 * 2.5 = 5000；particleEmitRate 放大时需要同步扩大
    const ps = new GPUParticleSystem('envParticles', { capacity: 10000 }, scene);
    ps.particleTexture = makeParticleTexture(type, envState.particleCustomTexture || undefined);
    _prevCustomTexKey = envState.particleCustomTexture
        ? `_custom_${envState.particleCustomTexture}`
        : null;
    ps.updateSpeed = 0.01;
    // 初始 emitter 占位（实际位置在 followObserver 中设置）
    ps.emitter = new Vector3(0, 0, 0);

    // 判断当前类型是全景天气还是局部效果
    const isWeather = ['sakura', 'rain', 'snow', 'leaves'].includes(type);

    switch (type) {
        case 'sakura': {
            ps.blendMode = ParticleSystem.BLENDMODE_STANDARD;
            ps.emitRate = 40;
            ps.gravity = new Vector3(0, -0.8, 0);
            ps.minLifeTime = 8;
            ps.maxLifeTime = 15;
            ps.minEmitPower = 0.5;
            ps.maxEmitPower = 1.5;
            ps.minAngularSpeed = -1;
            ps.maxAngularSpeed = 1;
            ps.minSize = 0.15;
            ps.maxSize = 0.35;
            if (isWeather) {
                // 全景天气：XZ 大幅覆盖，出生 Y 在 emitter 附近窄带
                ps.createBoxEmitter(
                    new Vector3(-0.5, -0.2, -0.5),
                    new Vector3(0.5, 0.2, 0.5),
                    new Vector3(-WEATHER_BOX_XZ_HALF, 0, -WEATHER_BOX_XZ_HALF),
                    new Vector3(WEATHER_BOX_XZ_HALF, WEATHER_BOX_Y_RANGE, WEATHER_BOX_XZ_HALF)
                );
            }
            ps.addColorGradient(0, new Color4(1, 0.72, 0.78, 1), new Color4(1, 0.8, 0.85, 1));
            ps.addColorGradient(0.8, new Color4(1, 0.72, 0.78, 1), new Color4(1, 0.8, 0.85, 1));
            ps.addColorGradient(1, new Color4(1, 0.72, 0.78, 0), new Color4(1, 0.8, 0.85, 0));
            break;
        }
        case 'rain': {
            ps.blendMode = ParticleSystem.BLENDMODE_STANDARD;
            ps.emitRate = 1000;
            ps.gravity = new Vector3(0, -25, 0);
            ps.minLifeTime = 1;
            ps.maxLifeTime = 2;
            ps.minEmitPower = 15;
            ps.maxEmitPower = 20;
            ps.minSize = 0.1;
            ps.maxSize = 0.2;
            if (isWeather) {
                ps.createBoxEmitter(
                    new Vector3(-0.1, -1, -0.1),
                    new Vector3(0.1, -1, 0.1),
                    new Vector3(-WEATHER_BOX_XZ_HALF, 0, -WEATHER_BOX_XZ_HALF),
                    new Vector3(WEATHER_BOX_XZ_HALF, WEATHER_BOX_Y_RANGE, WEATHER_BOX_XZ_HALF)
                );
            }
            ps.addColorGradient(0, new Color4(0.7, 0.8, 1, 0.6), new Color4(0.8, 0.9, 1, 0.8));
            ps.addColorGradient(1, new Color4(0.7, 0.8, 1, 0), new Color4(0.8, 0.9, 1, 0));
            break;
        }
        case 'snow': {
            ps.blendMode = ParticleSystem.BLENDMODE_STANDARD;
            ps.emitRate = 250;
            ps.gravity = new Vector3(0, -1.5, 0);
            ps.minLifeTime = 6;
            ps.maxLifeTime = 12;
            ps.minEmitPower = 0.3;
            ps.maxEmitPower = 0.8;
            ps.minAngularSpeed = -0.5;
            ps.maxAngularSpeed = 0.5;
            ps.minSize = 0.1;
            ps.maxSize = 0.25;
            if (isWeather) {
                ps.createBoxEmitter(
                    new Vector3(-0.5, -0.3, -0.5),
                    new Vector3(0.5, -0.3, 0.5),
                    new Vector3(-WEATHER_BOX_XZ_HALF, 0, -WEATHER_BOX_XZ_HALF),
                    new Vector3(WEATHER_BOX_XZ_HALF, WEATHER_BOX_Y_RANGE, WEATHER_BOX_XZ_HALF)
                );
            }
            ps.addColorGradient(0, new Color4(1, 1, 1, 0.9), new Color4(1, 1, 1, 1));
            ps.addColorGradient(1, new Color4(1, 1, 1, 0), new Color4(1, 1, 1, 0));
            break;
        }
        case 'fireworks': {
            ps.blendMode = ParticleSystem.BLENDMODE_ADD;
            ps.emitRate = 5; // 低发射率环境光晕；实际爆发由 burst 管理器生成临时系统
            ps.gravity = new Vector3(0, -2, 0);
            ps.minLifeTime = 1.5;
            ps.maxLifeTime = 3;
            ps.minEmitPower = 2;
            ps.maxEmitPower = 5;
            ps.minSize = 0.05;
            ps.maxSize = 0.12;
            ps.createSphereEmitter(2);
            ps.addColorGradient(0, new Color4(1, 0.9, 0.4, 0.3), new Color4(1, 0.8, 0.2, 0.2));
            ps.addColorGradient(1, new Color4(1, 0.5, 0.1, 0), new Color4(0.8, 0.3, 0, 0));
            break;
        }
        case 'fireflies': {
            ps.blendMode = ParticleSystem.BLENDMODE_ADD;
            ps.emitRate = 15;
            ps.gravity = new Vector3(0, 0, 0);
            ps.minLifeTime = 4;
            ps.maxLifeTime = 8;
            ps.minEmitPower = 0.2;
            ps.maxEmitPower = 0.5;
            ps.minSize = 0.1;
            ps.maxSize = 0.2;
            ps.createSphereEmitter(8);
            ps.addColorGradient(0, new Color4(0.6, 1, 0.3, 0), new Color4(0.8, 1, 0.4, 0));
            ps.addColorGradient(0.3, new Color4(0.6, 1, 0.3, 1), new Color4(0.8, 1, 0.4, 1));
            ps.addColorGradient(0.6, new Color4(0.6, 1, 0.3, 0.2), new Color4(0.8, 1, 0.4, 0.2));
            ps.addColorGradient(1, new Color4(0.6, 1, 0.3, 1), new Color4(0.8, 1, 0.4, 1));
            break;
        }
        case 'leaves': {
            ps.blendMode = ParticleSystem.BLENDMODE_STANDARD;
            ps.emitRate = 30;
            ps.gravity = new Vector3(0, -1, 0);
            ps.minLifeTime = 8;
            ps.maxLifeTime = 14;
            ps.minEmitPower = 0.5;
            ps.maxEmitPower = 1.5;
            ps.minAngularSpeed = -2;
            ps.maxAngularSpeed = 2;
            ps.minSize = 0.2;
            ps.maxSize = 0.4;
            if (isWeather) {
                ps.createBoxEmitter(
                    new Vector3(-0.8, -0.3, -0.8),
                    new Vector3(0.8, 0.3, 0.8),
                    new Vector3(-WEATHER_BOX_XZ_HALF, 0, -WEATHER_BOX_XZ_HALF),
                    new Vector3(WEATHER_BOX_XZ_HALF, WEATHER_BOX_Y_RANGE, WEATHER_BOX_XZ_HALF)
                );
            }
            ps.addColorGradient(0, new Color4(0.9, 0.5, 0.2, 1), new Color4(0.8, 0.6, 0.1, 1));
            ps.addColorGradient(1, new Color4(0.9, 0.5, 0.2, 0), new Color4(0.8, 0.6, 0.1, 0));
            break;
        }
    }

    // 保存基础参数值（供运行时滑条更新使用）
    _baseEmitRate = ps.emitRate;
    _baseMinSize = ps.minSize;
    _baseMaxSize = ps.maxSize;
    _baseMinEmitPower = ps.minEmitPower;
    _baseMaxEmitPower = ps.maxEmitPower;

    // 保存初始发射方向，风力始终基于初始值计算，避免叠加
    _initialDir1 = ps.direction1.clone();
    _initialDir2 = ps.direction2.clone();

    // 应用 multiplier
    const er = envState.particleEmitRate;
    if (er !== 1) {
        ps.emitRate = Math.max(0, ps.emitRate * er);
    }

    const sz = envState.particleSize;
    if (sz !== 1) {
        ps.minSize *= sz;
        ps.maxSize *= sz;
    }

    const sp = envState.particleSpeed;
    if (sp !== 1) {
        ps.minEmitPower *= sp;
        ps.maxEmitPower *= sp;
    }

    if (windEnabled) {
        applyWindToParticles(ps);
    }

    // 每帧更新 emitter 位置（基于 groundLevel 和类型定位策略）
    _envSys.particles.followObserver = scene.onBeforeRenderObservable.add(() => {
        const cam = scene.activeCamera;
        if (!cam) {
            return;
        }
        const e = ps.emitter;
        if (!(e instanceof Vector3)) {
            return;
        }

        const groundY = envState.groundLevel ?? 0;

        if (isWeather) {
            // 全景天气：XZ 跟随相机，Y 固定在世界空间地面以上
            e.x = cam.position.x;
            e.z = cam.position.z;
            e.y = groundY + WEATHER_HEIGHT_ABOVE_GROUND;
        } else {
            // 局部效果：XZ 跟随相机，Y 相对于地面偏移
            e.x = cam.position.x;
            e.z = cam.position.z;
            if (type === 'fireflies') {
                e.y = groundY + FIREFLY_HEIGHT_OFFSET;
            } else if (type === 'fireworks') {
                e.y = groundY + FIREWORK_HEIGHT_OFFSET;
            }
        }
    });

    _envSys.particles.system = ps;
    ps.start();

    // 粒子类型变更后同步溅射状态（雨/雪才有溅射）
    syncSplashState();

    // 烟花类型启动 burst 调度
    if (type === 'fireworks') {
        scheduleNextFireworkBurst();
    }
}

export function disposeParticles(): void {
    const scene = getScene();
    if (_envSys.particles.followObserver) {
        scene.onBeforeRenderObservable.remove(_envSys.particles.followObserver);
        _envSys.particles.followObserver = null;
    }
    if (_envSys.particles.system) {
        _envSys.particles.system.dispose();
        _envSys.particles.system = null;
    }
    disposeSplash(); // 粒子销毁时同步销毁溅射
    stopFireworkBursts(); // 烟花 burst 清理
    // 释放粒子纹理缓存（防止 GPU 资源泄漏）
    for (const tex of _particleTextures.values()) {
        tex.dispose();
    }
    _particleTextures.clear();
    _initialDir1 = null;
    _initialDir2 = null;
    _baseEmitRate = 0;
    _baseMinSize = 0;
    _baseMaxSize = 0;
    _baseMinEmitPower = 0;
    _baseMaxEmitPower = 0;
    _prevCustomTexKey = null;
    // 不重置 _currentParticleType，以便 particleEnabled 自动恢复时知道上次类型
}

/** 获取当前粒子类型（用于 particleEnabled 自动启停） */
export function getCurrentParticleType(): EnvState['particleType'] {
    return _currentParticleType;
}

// ======== Splash System (Phase B: 雨雪落地溅射) ========

/** 判断当前粒子类型是否支持溅射 */
function isWeatherType(type: EnvState['particleType']): boolean {
    return type === 'rain' || type === 'snow';
}

/** 创建溅射粒子系统（地面随机位置脉冲触发，视觉欺骗方案） */
export function createSplashEmitter(): void {
    if (_splashSystem) {
        return;
    }
    const scene = getScene();
    const ps = new GPUParticleSystem('splashParticles', { capacity: 500 }, scene);
    ps.particleTexture = makeParticleTexture('splash');
    ps.emitRate = 8; // 低频持续发射，位置随机化产生溅射感
    ps.emitter = new Vector3(0, 0, 0);
    ps.minLifeTime = 0.3;
    ps.maxLifeTime = 0.6;
    ps.minSize = 0.03;
    ps.maxSize = 0.08;
    ps.minEmitPower = 2;
    ps.maxEmitPower = 5;
    ps.gravity = new Vector3(0, -15, 0);
    ps.blendMode = ParticleSystem.BLENDMODE_STANDARD;

    // 向上溅射 + 水平随机偏移
    ps.direction1 = new Vector3(-1, 2, -1);
    ps.direction2 = new Vector3(1, 4, 1);

    ps.addColorGradient(0, new Color4(0.8, 0.9, 1, 0.8), new Color4(0.9, 0.95, 1, 0.9));
    ps.addColorGradient(1, new Color4(0.8, 0.9, 1, 0), new Color4(0.9, 0.95, 1, 0));

    _splashSystem = ps;
    ps.start();

    // 每帧在地面随机位置移动发射器，产生散落溅射效果
    _envSys.splash.observer = scene.onBeforeRenderObservable.add(() => {
        if (!envState.particleSplash || !isWeatherType(_currentParticleType)) {
            return;
        }
        const cam = scene.activeCamera;
        if (!cam) {
            return;
        }
        const groundY = envState.groundLevel ?? 0;
        // 在相机附近 80x80 范围内随机跳动
        const rx = cam.position.x + (Math.random() - 0.5) * 80;
        const rz = cam.position.z + (Math.random() - 0.5) * 80;
        ps.emitter = new Vector3(rx, groundY + 0.1, rz);

        // 雨滴落水涟漪：水面开启时，溅射位置在水面范围内则概率触发
        if (envState.waterEnabled) {
            const halfSize = envState.waterSize / 2;
            if (Math.abs(rx) <= halfSize && Math.abs(rz) <= halfSize && Math.random() < 0.25) {
                addRipple(new Vector3(rx, envState.waterLevel, rz), 1.5, 0.25, 1, 2);
            }
        }
    });
}

/** 销毁溅射粒子系统 */
export function disposeSplash(): void {
    if (_splashSystem) {
        _splashSystem.dispose();
        _splashSystem = null;
    }
    if (_envSys.splash.observer) {
        const scene = getScene();
        scene.onBeforeRenderObservable.remove(_envSys.splash.observer);
        _envSys.splash.observer = null;
    }
}

/** 溅射开关切换（由 env-impl 检测 particleSplash 变化时调用） */
export function syncSplashState(): void {
    const shouldShow =
        envState.particleSplash && isWeatherType(_currentParticleType) && envState.particleEnabled;
    if (shouldShow && !_splashSystem) {
        createSplashEmitter();
    } else if (!shouldShow && _splashSystem) {
        disposeSplash();
    }
}

// ======== Firework Multi-Burst System ========
interface FireworkBurstInstance {
    system: GPUParticleSystem;
    cleanupTimer: ReturnType<typeof setTimeout>;
}
let _fireworkBursts: FireworkBurstInstance[] = [];
let _fireworkScheduler: ReturnType<typeof setTimeout> | null = null;

function spawnFireworkBurst(): void {
    const scene = getScene();
    const cam = scene.activeCamera;
    if (!cam) {
        return;
    }

    const groundY = envState.groundLevel ?? 0;
    // 在相机附近随机位置爆散
    const pos = new Vector3(
        cam.position.x + (Math.random() - 0.5) * 30,
        groundY + FIREWORK_HEIGHT_OFFSET + (Math.random() - 0.5) * 4,
        cam.position.z + (Math.random() - 0.5) * 30
    );

    const burst = new GPUParticleSystem(
        `firework_${_fireworkBursts.length}_${Date.now()}`,
        { capacity: 200 },
        scene
    );
    burst.particleTexture = makeParticleTexture('fireworks');
    burst.emitter = pos;
    // 瞬时高密度爆发：emitRate=2000，50ms 内出约 100 粒子，之后停发
    burst.emitRate = 2000;
    setTimeout(() => {
        burst.emitRate = 0;
    }, 50);

    burst.minLifeTime = 0.4;
    burst.maxLifeTime = 1.0;
    burst.minEmitPower = 4;
    burst.maxEmitPower = 10;
    burst.gravity = new Vector3(0, -2, 0);
    burst.blendMode = ParticleSystem.BLENDMODE_ADD;
    burst.createSphereEmitter(0.2);

    // 每发随机色相
    const hue = Math.random();
    const r = 0.5 + Math.cos(hue * Math.PI * 2) * 0.5;
    const g = 0.5 + Math.cos((hue + 1 / 3) * Math.PI * 2) * 0.5;
    const b = 0.5 + Math.cos((hue + 2 / 3) * Math.PI * 2) * 0.5;

    burst.addColorGradient(0, new Color4(r, g, b, 1), new Color4(r, g, b, 1));
    burst.addColorGradient(
        0.4,
        new Color4(r, g, b, 0.8),
        new Color4(r * 0.8, g * 0.8, b * 0.8, 0.6)
    );
    burst.addColorGradient(
        1,
        new Color4(r * 0.3, g * 0.3, b * 0.3, 0),
        new Color4(r * 0.2, g * 0.2, b * 0.2, 0)
    );

    // 尺寸：爆炸膨胀后缩小
    burst.minSize = 0.05;
    burst.maxSize = 0.1;
    burst.addSizeGradient(0, 0.02, 0.04);
    burst.addSizeGradient(0.3, 0.2, 0.35);
    burst.addSizeGradient(1, 0.04, 0.08);

    burst.start();

    const cleanupTimer = setTimeout(() => {
        burst.dispose();
        _fireworkBursts = _fireworkBursts.filter((b) => b.system !== burst);
    }, 3000);

    _fireworkBursts.push({ system: burst, cleanupTimer });
}

function scheduleNextFireworkBurst(): void {
    const delay = 1200 + Math.random() * 1800; // 1.2~3s 间隔
    _fireworkScheduler = setTimeout(() => {
        if (_currentParticleType !== 'fireworks') {
            return;
        }
        if (!envState.particleEnabled) {
            return;
        }
        spawnFireworkBurst();
        scheduleNextFireworkBurst();
    }, delay);
}

function stopFireworkBursts(): void {
    if (_fireworkScheduler !== null) {
        clearTimeout(_fireworkScheduler);
        _fireworkScheduler = null;
    }
    for (const b of _fireworkBursts) {
        clearTimeout(b.cleanupTimer);
        b.system.dispose();
    }
    _fireworkBursts = [];
}

// ======== Wind System ========
// 基于初始方向计算风力，可安全多次调用（每帧调用也不会叠加）
export function applyWindToParticles(ps: GPUParticleSystem): void {
    if (!_initialDir1 || !_initialDir2) {
        return;
    }
    // 粒子风响应系数 0.1（比布料小，粒子更轻但受发射方向约束）
    const wind = getWindVector().scale(0.1);
    ps.direction1 = _initialDir1.clone().add(wind);
    ps.direction2 = _initialDir2.clone().add(wind);
}

// 运行时动态更新风力（由 ensureEnvUpdateObserver 每帧调用）
export function updateParticleWind(): void {
    if (_envSys.particles.system) {
        applyWindToParticles(_envSys.particles.system);
    }
}

/** 运行时更新粒子参数（密度/大小/速度），响应滑条变化 */
export function updateParticleParams(): void {
    const ps = _envSys.particles.system;
    if (!ps) {
        return;
    }
    ps.emitRate = Math.max(0, _baseEmitRate * envState.particleEmitRate);
    ps.minSize = _baseMinSize * envState.particleSize;
    ps.maxSize = _baseMaxSize * envState.particleSize;
    ps.minEmitPower = _baseMinEmitPower * envState.particleSpeed;
    ps.maxEmitPower = _baseMaxEmitPower * envState.particleSpeed;
}

/** 运行时更新粒子纹理（响应自定义纹理变化） */
let _prevCustomTexKey: string | null = null;
export function updateParticleTexture(): void {
    const ps = _envSys.particles.system;
    if (!ps || !_currentParticleType || _currentParticleType === 'none') {
        return;
    }
    const url = envState.particleCustomTexture || undefined;
    const newKey = url ? `_custom_${url}` : null;
    // 切换前 dispose 上一个自定义纹理（释放 GPU 资源）
    if (_prevCustomTexKey && _prevCustomTexKey !== newKey) {
        const old = _particleTextures.get(_prevCustomTexKey);
        if (old) {
            old.dispose();
            _particleTextures.delete(_prevCustomTexKey);
        }
    }
    ps.particleTexture = makeParticleTexture(_currentParticleType, url);
    _prevCustomTexKey = newKey;
}
