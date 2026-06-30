import {
    Scene,
    Color4,
    Vector3,
    Texture,
    GPUParticleSystem,
    Observer,
    ParticleSystem,
} from '@babylonjs/core';
import { EnvState, envState } from '../core/config';
import { _envSys, getScene, getPipeline } from './scene-env-impl';

// ======== Particle System ========
let _currentParticleType: EnvState['particleType'] = 'none';
const _particleTextures = new Map<string, Texture>();

function makeParticleTexture(kind: string): Texture {
    const scene = getScene();
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
    }
}

export function createParticleEmitter(type: EnvState['particleType'], windEnabled: boolean): void {
    if (_envSys.particles.emitter && _currentParticleType === type) {
        return;
    }

    if (_envSys.particles.emitter) {
        disposeParticles();
    }
    _currentParticleType = type;
    if (type === 'none') {
        return;
    }

    const scene = getScene();

    const ps = new GPUParticleSystem('envParticles', { capacity: 5000 }, scene);
    ps.particleTexture = makeParticleTexture(type);
    ps.updateSpeed = 0.01;
    ps.emitter = new Vector3(0, 10, 0);

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
            ps.createBoxEmitter(
                new Vector3(-0.5, -0.2, -0.5),
                new Vector3(0.5, 0.2, 0.5),
                new Vector3(-12, 8, -12),
                new Vector3(12, 12, 12)
            );
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
            ps.createBoxEmitter(
                new Vector3(-0.1, -1, -0.1),
                new Vector3(0.1, -1, 0.1),
                new Vector3(-15, 12, -15),
                new Vector3(15, 15, 15)
            );
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
            ps.createBoxEmitter(
                new Vector3(-0.5, -0.3, -0.5),
                new Vector3(0.5, -0.3, 0.5),
                new Vector3(-15, 10, -15),
                new Vector3(15, 14, 15)
            );
            ps.addColorGradient(0, new Color4(1, 1, 1, 0.9), new Color4(1, 1, 1, 1));
            ps.addColorGradient(1, new Color4(1, 1, 1, 0), new Color4(1, 1, 1, 0));
            break;
        }
        case 'fireworks': {
            ps.blendMode = ParticleSystem.BLENDMODE_ADD;
            ps.emitRate = 80;
            ps.gravity = new Vector3(0, -4, 0);
            ps.minLifeTime = 1.2;
            ps.maxLifeTime = 2.2;
            ps.minEmitPower = 6;
            ps.maxEmitPower = 10;
            ps.minSize = 0.15;
            ps.maxSize = 0.35;
            ps.createSphereEmitter(0.1);
            ps.addColorGradient(0, new Color4(1, 1, 0.6, 1), new Color4(1, 0.9, 0.4, 1));
            ps.addColorGradient(0.5, new Color4(1, 0.6, 0.2, 1), new Color4(1, 0.4, 0.1, 1));
            ps.addColorGradient(1, new Color4(1, 0.3, 0.1, 0), new Color4(0.8, 0.2, 0, 0));
            ps.addSizeGradient(0, 0.1, 0.2);
            ps.addSizeGradient(0.3, 0.3, 0.4);
            ps.addSizeGradient(1, 0.05, 0.1);
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
            ps.createBoxEmitter(
                new Vector3(-0.8, -0.3, -0.8),
                new Vector3(0.8, 0.3, 0.8),
                new Vector3(-12, 8, -12),
                new Vector3(12, 12, 12)
            );
            ps.addColorGradient(0, new Color4(0.9, 0.5, 0.2, 1), new Color4(0.8, 0.6, 0.1, 1));
            ps.addColorGradient(1, new Color4(0.9, 0.5, 0.2, 0), new Color4(0.8, 0.6, 0.1, 0));
            break;
        }
    }

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

    _envSys.particles.followObserver = scene.onBeforeRenderObservable.add(() => {
        const cam = scene.activeCamera;
        if (!cam) {
            return;
        }
        const e = ps.emitter as Vector3;
        if (!e) {
            return;
        }
        e.x = cam.position.x;
        e.z = cam.position.z;
        e.y = type === 'fireflies' ? 2 : 11;
    });

    _envSys.particles.emitter = ps;
}

export function disposeParticles(): void {
    const scene = getScene();
    if (_envSys.particles.followObserver) {
        scene.onBeforeRenderObservable.remove(_envSys.particles.followObserver);
        _envSys.particles.followObserver = null;
    }
    if (_envSys.particles.emitter) {
        _envSys.particles.emitter.dispose();
        _envSys.particles.emitter = null;
    }
    _currentParticleType = 'none';
}

// ======== Wind System ========
export function applyWindToParticles(ps: GPUParticleSystem): void {
    const dir = envState.windDirection;
    const speed = envState.windSpeed;
    const wind = new Vector3(dir[0] * speed * 0.1, dir[1] * speed * 0.1, dir[2] * speed * 0.1);
    ps.direction1 = ps.direction1.add(wind);
    ps.direction2 = ps.direction2.add(wind);
}
