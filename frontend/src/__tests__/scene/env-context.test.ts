import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { Scene } from '@babylonjs/core';
import type { DefaultRenderingPipeline } from '@babylonjs/core';

import {
    initEnvImpl,
    resetEnvContext,
    getScene,
    isInitialized,
    getPipeline,
    effectiveGroundSize,
    INFINITE_GROUND_SIZE,
    resolveStaticAsset,
} from '../../scene/env/_shared/env-context';

const mkScene = () => ({}) as unknown as Scene;
const mkPipeline = () => ({}) as unknown as DefaultRenderingPipeline;

afterEach(() => {
    // 复位共享上下文，避免用例间泄漏
    resetEnvContext();
});

describe('env-context — 初始化 / 复位（含 fix P2 幽灵引用复位）', () => {
    it('未初始化时 getScene 抛错且 isInitialized=false', () => {
        expect(isInitialized()).toBe(false);
        expect(() => getScene()).toThrow(/Scene not initialized/);
    });

    it('未初始化时 getPipeline 抛错', () => {
        expect(() => getPipeline()).toThrow(/Pipeline not initialized/);
    });

    it('initEnvImpl 后 isInitialized=true，getScene/getPipeline 返回注入依赖', () => {
        const s = mkScene();
        const p = mkPipeline();
        initEnvImpl(s, p);
        expect(isInitialized()).toBe(true);
        expect(getScene()).toBe(s);
        expect(getPipeline()).toBe(p);
    });

    it('[fix P2] resetEnvContext 清空引用：复位后 getScene/getPipeline 重新抛错', () => {
        initEnvImpl(mkScene(), mkPipeline());
        expect(isInitialized()).toBe(true);
        // 关键修复行：_scene/_pipeline 置 null
        resetEnvContext();
        expect(isInitialized()).toBe(false);
        expect(() => getScene()).toThrow(/Scene not initialized/);
        expect(() => getPipeline()).toThrow(/Pipeline not initialized/);
    });
});

describe('env-context — 地水共享尺寸单源', () => {
    it('INFINITE_GROUND_SIZE 固定为 2000', () => {
        expect(INFINITE_GROUND_SIZE).toBe(2000);
    });

    it('effectiveGroundSize：无限开启时返回固定大尺寸', () => {
        expect(effectiveGroundSize(100, true)).toBe(INFINITE_GROUND_SIZE);
    });

    it('effectiveGroundSize：无限关闭时返回传入 groundSize', () => {
        expect(effectiveGroundSize(150, false)).toBe(150);
    });
});

describe('env-context — resolveStaticAsset（Android 安全解析）', () => {
    it('http/https/data 绝对 URL 原样透传', () => {
        const http = 'http://example.com/a.png';
        const https = 'https://example.com/a.png';
        const data = 'data:image/png;base64,AAAA';
        expect(resolveStaticAsset(http)).toBe(http);
        expect(resolveStaticAsset(https)).toBe(https);
        expect(resolveStaticAsset(data)).toBe(data);
    });

    it('相对路径基于 window.location.origin 解析为绝对 URL', () => {
        const out = resolveStaticAsset('textures/sky.png');
        expect(out).toMatch(/^https?:\/\//);
        expect(out.endsWith('/textures/sky.png')).toBe(true);
    });
});
