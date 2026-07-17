/**
 * MikuMikuAR — Web Loader 原型
 * 纯浏览器端 PMX 加载器，零后端依赖。
 *
 * 用法：npm run dev → 打开 http://127.0.0.1:5173/web-loader.html
 * 拖拽 .pmx 或 .zip 文件即可加载。
 */

// ======== Babylon.js 核心 ========
import { Engine } from '@babylonjs/core/Engines/engine';
import { Scene } from '@babylonjs/core/scene';
import { ArcRotateCamera } from '@babylonjs/core/Cameras/arcRotateCamera';
import { HemisphericLight } from '@babylonjs/core/Lights/hemisphericLight';
import { DirectionalLight } from '@babylonjs/core/Lights/directionalLight';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { Color3, Color4 } from '@babylonjs/core/Maths/math.color';
import { ImportMeshAsync } from '@babylonjs/core/Loading/sceneLoader';
import { CreateGround } from '@babylonjs/core/Meshes/Builders/groundBuilder';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import type { AbstractMesh } from '@babylonjs/core/Meshes/abstractMesh';
import '@babylonjs/core/Loading/loadingScreen';

// ======== 注册 babylon-mmd PMX 加载器 + 默认材质构建器 ========
import 'babylon-mmd/esm/Loader/pmxLoader';
import 'babylon-mmd/esm/Loader/mmdModelLoader.default';

// ======== 劫持 PmLoader.loadFile 直接看 referenceFiles 是否传进去了 ========
import { PmxLoader } from 'babylon-mmd/esm/Loader/pmxLoader';
const _origLoadFile = (PmxLoader.prototype as any).loadFile;
(PmxLoader.prototype as any).loadFile = function (scene: any, fileOrUrl: any, rootUrl: string, onSuccess: any, onProgress: any, useArrayBuffer: boolean, onError: any, name: string) {
    console.log('[PmLoader.loadFile] this.referenceFiles count:', this.referenceFiles?.length ?? 0);
    if (this.referenceFiles?.length > 0) {
        console.log('[PmLoader.loadFile]  textures:', this.referenceFiles.map((f: any) => f.relativePath ?? f.name));
    }
    return _origLoadFile.call(this, scene, fileOrUrl, rootUrl, onSuccess, onProgress, useArrayBuffer, onError, name);
};

// ======== 劫持 ReferenceFileResolver 构造函数 ========
import { ReferenceFileResolver } from 'babylon-mmd/esm/Loader/referenceFileResolver';
const OrigRefResolver = ReferenceFileResolver as any;
const OrigRefResolverCons = OrigRefResolver.prototype.constructor;
OrigRefResolver.prototype.constructor = function (this: any, files: any[], rootUrl: string, fileRootId: string) {
    console.log('[RefResolver]  constructor files:', files.length, 'rootUrl:', JSON.stringify(rootUrl), 'fileRootId:', JSON.stringify(fileRootId));
    console.log('[RefResolver]  file paths:', files.map((f: any) => f.relativePath ?? f.name ?? '(no name)'));
    const instance = new OrigRefResolverCons(files, rootUrl, fileRootId);
    // 保留 _fileMap 引用以便后续查
    console.log('[RefResolver]  _fileMap keys:', Array.from(instance._fileMap?.keys?.() ?? []));
    return instance;
};
// 但 constructor 不能直接 return 覆盖，改用 Proxy
// 实际改回 prototype 方式，换更可靠的方法
{
    const origResolve = ReferenceFileResolver.prototype.resolve;
    const origCreateFullPath = ReferenceFileResolver.prototype.createFullPath;
    ReferenceFileResolver.prototype.resolve = function (this: any, path: string) {
        const result = origResolve.call(this, path);
        console.log(`[RefResolver.resolve] "${path}" → ${result ? '✅ ' + (result.relativePath ?? result.name) : '❌ MISS'}`);
        if (!result) {
            console.log(`[RefResolver.resolve]  _fileMap keys:`, Array.from(this._fileMap?.keys?.() ?? []));
        }
        return result;
    };
    ReferenceFileResolver.prototype.createFullPath = function (this: any, relativePath: string) {
        const result = origCreateFullPath.call(this, relativePath);
        console.log(`[RefResolver.createFullPath] "${relativePath}" → "${result}"`);
        return result;
    };
}

// ======== JSZip（浏览器端 zip 解压） ========
import * as JSZip from 'jszip';

// ======== 劫持 ReferenceFileResolver 日志 ========
// 在 pmxLoader 注册之后、首次加载之前，给 ReferenceFileResolver 挂上日志
import { ReferenceFileResolver } from 'babylon-mmd/esm/Loader/referenceFileResolver';
const _origResolverCons = (ReferenceFileResolver as any).constructor;
const _origResolve = ReferenceFileResolver.prototype.resolve;
const _origCreateFullPath = ReferenceFileResolver.prototype.createFullPath;
ReferenceFileResolver.prototype.resolve = function (this: any, path: string) {
    const result = _origResolve.call(this, path);
    console.log(`[TextureResolver] resolve("${path}") → ${result ? 'FOUND: ' + result.relativePath : '❌ NOT FOUND'}`);
    if (!result) {
        console.log(`[TextureResolver]  map keys:`, Array.from(this._fileMap.keys()));
    }
    return result;
};
ReferenceFileResolver.prototype.createFullPath = function (this: any, relativePath: string) {
    const result = _origCreateFullPath.call(this, relativePath);
    console.log(`[TextureResolver] createFullPath("${relativePath}") → "${result}"`);
    return result;
};

// ======== DOM 引用 ========
const canvas = document.getElementById('renderCanvas') as HTMLCanvasElement;
const dropZone = document.getElementById('dropZone') as HTMLDivElement;
const statusBar = document.getElementById('statusBar') as HTMLDivElement;
const modelNameEl = document.getElementById('modelName') as HTMLDivElement;
const modelStatsEl = document.getElementById('modelStats') as HTMLDivElement;
const fileInput = document.getElementById('fileInput') as HTMLInputElement;
const dropInner = document.getElementById('dropInner') as HTMLDivElement;

// ======== IArrayBufferFile 类型（babylon-mmd 内部接口，此处重复定义避免 import 歧义） ========
interface IArrayBufferFile {
    readonly relativePath: string;
    readonly mimeType: string | undefined;
    readonly data: ArrayBuffer;
}

// ======== 场景状态 ========
let engine: Engine;
let scene: Scene;
let _loadedMeshes: AbstractMesh[] = []; // 已加载的 mesh，用于清理

// ======== 初始化场景 ========
function initScene(): void {
    engine = new Engine(canvas, true, {
        preserveDrawingBuffer: true,
        stencil: true,
    });

    scene = new Scene(engine);
    scene.clearColor = new Color4(0.08, 0.08, 0.12, 1.0);

    // 摄像机
    const camera = new ArcRotateCamera('camera', -Math.PI / 2, Math.PI / 3, 8, Vector3.Zero(), scene);
    camera.lowerRadiusLimit = 1.5;
    camera.upperRadiusLimit = 50;
    camera.attachControl(canvas, true);

    // 灯光
    const hemi = new HemisphericLight('hemi', new Vector3(0, 1, 0), scene);
    hemi.intensity = 0.5;
    hemi.diffuse = new Color3(0.8, 0.85, 1.0);
    hemi.groundColor = new Color3(0.3, 0.3, 0.4);

    const dir = new DirectionalLight('dir', new Vector3(0.5, -1, 0.3), scene);
    dir.intensity = 0.9;
    dir.diffuse = new Color3(1, 0.98, 0.95);

    // 地面
    const ground = CreateGround('ground', { width: 20, height: 20, subdivisions: 2 }, scene);
    ground.position.y = 0;
    ground.isVisible = false; // 仅作参考，隐藏

    // 渲染循环
    engine.runRenderLoop(() => scene.render());
    window.addEventListener('resize', () => engine.resize());

    setStatus('就绪，拖拽文件开始');
}

// ======== 清理旧模型 ========
function clearScene(): void {
    for (const m of _loadedMeshes) {
        try {
            m.dispose(false, true);
        } catch {
            // ignore
        }
    }
    _loadedMeshes = [];
    modelNameEl.textContent = '—';
    modelStatsEl.textContent = '等待加载…';
}

// ======== 加载 PMX ========
async function loadModel(pmxBuffer: ArrayBuffer, textures: IArrayBufferFile[], modelName: string): Promise<void> {
    if (!scene) return;

    setStatus('正在加载模型…');
    clearScene();

    try {
        // 直接传 ArrayBufferView + referenceFiles 给 ImportMeshAsync
        // babylon-mmd 的 PmxLoader 会识别 ArrayBufferView，不走 HTTP 请求
        // 注意：必须是 ArrayBufferView（Uint8Array），裸 ArrayBuffer 不行
        const view = new Uint8Array(pmxBuffer);
        const result = await (ImportMeshAsync as any)(view, scene, {
            pluginExtension: '.pmx',
            pluginOptions: {
                mmdmodel: {
                    referenceFiles: textures as unknown as File[], // IArrayBufferFile[] 运行时兼容
                },
            },
        });

        const meshes = result.meshes.filter((m): m is Mesh => m instanceof Mesh);
        _loadedMeshes = meshes;

        if (meshes.length === 0) {
            setStatus('模型加载完成，但未生成网格');
            return;
        }

        // 找根 mesh（带 isMmdModel 元数据的）
        let rootMesh: Mesh | null = null;
        for (const m of meshes) {
            if ((m.metadata as any)?.isMmdModel) {
                rootMesh = m;
                break;
            }
        }
        if (!rootMesh) {
            rootMesh = meshes[0];
        }

        // 居中模型
        const bb = rootMesh.getHierarchyBoundingVectors(true);
        const size = bb.max.subtract(bb.min);
        const center = bb.max.add(bb.min).scale(0.5);

        // 把模型整体平移到地面 + 居中
        rootMesh.position.x = -center.x;
        rootMesh.position.z = -center.z;
        rootMesh.position.y = -bb.min.y;

        // 自动缩放：目标高度 ~12 单位
        const h = size.y;
        if (h > 0.01 && h < 50) {
            const targetHeight = 12;
            const scale = targetHeight / h;
            rootMesh.scaling = new Vector3(scale, scale, scale);
        }

        // 更新信息
        const displayName = modelName.replace(/\.pmx$/i, '');
        modelNameEl.textContent = displayName;
        modelStatsEl.textContent = `${meshes.length} 个网格 · ${textures.length} 个纹理`;

        setStatus(`✅ 加载完成：${displayName}`);
    } catch (err) {
        console.error('loadModel failed:', err);
        setStatus(`❌ 加载失败：${err instanceof Error ? err.message : String(err)}`);
    }
}

// ======== 处理文件 ========
async function handleFile(file: File): Promise<void> {
    if (file.name.endsWith('.pmx')) {
        setStatus('正在读取 PMX…');
        const buffer = await file.arrayBuffer();
        console.log('[WebLoader] 单 PMX 文件，无纹理');
        await loadModel(buffer, [], file.name);
    } else if (file.name.endsWith('.zip')) {
        setStatus('正在解压 ZIP…');
        const zip = await JSZip.loadAsync(file);

        let pmxBuffer: ArrayBuffer | null = null;
        let pmxName = '';
        const textures: IArrayBufferFile[] = [];

        const files = zip.files as Record<string, { dir: boolean; async: (t: 'arraybuffer') => Promise<ArrayBuffer> }>;
        const allNames = Object.keys(files);
        console.log('[WebLoader] ZIP 内容列表:', allNames);

        // 优先找 .pmx
        for (const name of allNames) {
            const entry = files[name];
            if (entry.dir) continue;
            if (/\.pmx$/i.test(name)) {
                pmxBuffer = await entry.async('arraybuffer');
                pmxName = name;
                console.log('[WebLoader] 找到 PMX:', name, `(${pmxBuffer.byteLength} bytes)`);
                break;
            }
        }
        if (!pmxBuffer) {
            setStatus('❌ ZIP 中未找到 .pmx 文件');
            return;
        }

        // 收集纹理
        for (const name of allNames) {
            const entry = files[name];
            if (entry.dir) continue;
            if (/\.(png|jpg|jpeg|bmp|tga|dds|tif|tiff)$/i.test(name)) {
                const buf = await entry.async('arraybuffer');
                textures.push({
                    relativePath: name,
                    mimeType: getMimeType(name),
                    data: buf,
                });
            }
        }
        console.log('[WebLoader] 纹理列表:', textures.map(t => `${t.relativePath} (${t.data.byteLength}B)`));

        setStatus(`找到 ${pmxName}，${textures.length} 个纹理，加载中…`);
        await loadModel(pmxBuffer, textures, pmxName);
    } else {
        setStatus('⚠️ 请拖拽 .pmx 或 .zip 文件');
    }
}

function getMimeType(name: string): string {
    const ext = name.split('.').pop()?.toLowerCase();
    const map: Record<string, string | undefined> = {
        png: 'image/png',
        jpg: 'image/jpeg',
        jpeg: 'image/jpeg',
        bmp: 'image/bmp',
        tga: 'image/x-tga',
        dds: 'image/vnd-ms.dds',
        tif: 'image/tiff',
        tiff: 'image/tiff',
    };
    return map[ext ?? ''] ?? 'application/octet-stream';
}

// ======== UI 状态 ========
function setStatus(msg: string): void {
    statusBar.textContent = `[${new Date().toLocaleTimeString()}] ${msg}`;
}

function showDropZone(show: boolean): void {
    dropZone.classList.toggle('hidden', !show);
}

// ======== 拖拽事件 ========
dropZone.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropZone.classList.add('dragover');
});
dropZone.addEventListener('dragleave', () => {
    dropZone.classList.remove('dragover');
});
dropZone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropZone.classList.remove('dragover');
    const file = e.dataTransfer?.files?.[0];
    if (file) {
        void handleFile(file);
        showDropZone(false);
    }
});

// 点击选择文件
dropZone.addEventListener('click', () => {
    fileInput.click();
});
fileInput.addEventListener('change', () => {
    const file = fileInput.files?.[0];
    if (file) {
        void handleFile(file);
        showDropZone(false);
    }
    fileInput.value = ''; // 允许重复选同一文件
});

// 加载后点击 canvas 可重新显示拖拽区
canvas.addEventListener('dblclick', () => {
    showDropZone(true);
    setStatus('就绪，拖拽或选择文件');
});

// ======== 启动 ========
initScene();
showDropZone(true);