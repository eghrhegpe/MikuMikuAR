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
import type { ISceneLoaderAsyncResult } from '@babylonjs/core/Loading/sceneLoader';
import { CreateGround } from '@babylonjs/core/Meshes/Builders/groundBuilder';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import type { AbstractMesh } from '@babylonjs/core/Meshes/abstractMesh';
import '@babylonjs/core/Loading/loadingScreen';

// ======== 注册 babylon-mmd PMX 加载器 + 默认材质构建器 ========
// 注意：必须先设 SharedMaterialBuilder，再创建全局 PmxLoader
import 'babylon-mmd/esm/Loader/mmdModelLoader.default';
import 'babylon-mmd/esm/Loader/pmxLoader';

// ======== ADR-117 多语言错误翻译（translateGoError） ========
import { translateGoError } from '../core/i18n/goerr';

// ======== JSZip（浏览器端 zip 解压） ========
import * as JSZip from 'jszip';

/** babylon-mmd 扩展 ImportMeshAsync 接受 Uint8Array，原类型签名不支持，需手动断言 */
const importMeshFromBytes = ImportMeshAsync as unknown as (
    data: Uint8Array,
    scene: Scene,
    options: Record<string, unknown>
) => Promise<ISceneLoaderAsyncResult>;

// ======== DOM 引用 ========
const canvas = document.getElementById('renderCanvas') as HTMLCanvasElement;
const dropZone = document.getElementById('dropZone') as HTMLDivElement;
const statusBar = document.getElementById('statusBar') as HTMLDivElement;
const modelNameEl = document.getElementById('modelName') as HTMLDivElement;
const modelStatsEl = document.getElementById('modelStats') as HTMLDivElement;
const fileInput = document.getElementById('fileInput') as HTMLInputElement;

// ======== IArrayBufferFile 类型（babylon-mmd 内部接口，此处重复定义避免 import 歧义） ========
interface IArrayBufferFile {
    readonly relativePath: string;
    readonly mimeType: string | undefined;
    readonly data: ArrayBuffer;
}

// ======== 场景状态 ========
let engine: Engine;
let scene: Scene;
let _loadedMeshes: AbstractMesh[] = [];

// ======== 初始化场景 ========
function initScene(): void {
    engine = new Engine(canvas, true, {
        preserveDrawingBuffer: true,
        stencil: true,
    });

    scene = new Scene(engine);
    scene.clearColor = new Color4(0.08, 0.08, 0.12, 1.0);

    // 摄像机
    const camera = new ArcRotateCamera(
        'camera',
        -Math.PI / 2,
        Math.PI / 3,
        8,
        Vector3.Zero(),
        scene
    );
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

    // 地面（不可见，仅作参考系）
    const ground = CreateGround('ground', { width: 20, height: 20, subdivisions: 2 }, scene);
    ground.position.y = 0;
    ground.isVisible = false;

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
async function loadModel(
    pmxBuffer: ArrayBuffer,
    textures: IArrayBufferFile[],
    modelName: string
): Promise<void> {
    if (!scene) {
        return;
    }

    setStatus('正在加载模型…');
    clearScene();

    try {
        // 直接传 ArrayBufferView + referenceFiles 给 ImportMeshAsync
        // babylon-mmd 的 PmxLoader 识别 ArrayBufferView 后不走 HTTP 请求
        const view = new Uint8Array(pmxBuffer);
        const result = await importMeshFromBytes(view, scene, {
            pluginExtension: '.pmx',
            pluginOptions: {
                mmdmodel: {
                    referenceFiles: textures as unknown as File[],
                },
            },
        });

        const meshes = result.meshes.filter((m): m is Mesh => m instanceof Mesh);
        _loadedMeshes = meshes;

        if (meshes.length === 0) {
            setStatus('模型加载完成，但未生成网格');
            return;
        }

        // 找根 mesh
        let rootMesh: Mesh | null = null;
        for (const m of meshes) {
            if ((m.metadata as Record<string, unknown> | null)?.isMmdModel) {
                rootMesh = m;
                break;
            }
        }
        if (!rootMesh) {
            rootMesh = meshes[0];
        }

        // 居中 + 贴地
        const bb = rootMesh.getHierarchyBoundingVectors(true);
        const size = bb.max.subtract(bb.min);
        const center = bb.max.add(bb.min).scale(0.5);

        rootMesh.position.x = -center.x;
        rootMesh.position.z = -center.z;
        rootMesh.position.y = -bb.min.y;

        // 自动缩放：目标高度 12 单位
        const h = size.y;
        if (h > 0.01 && h < 50) {
            rootMesh.scaling = new Vector3(12 / h, 12 / h, 12 / h);
        }

        // 更新信息
        const displayName = modelName.replace(/\.pmx$/i, '');
        modelNameEl.textContent = displayName;
        modelStatsEl.textContent = `${meshes.length} 个网格 · ${textures.length} 个纹理`;

        setStatus(`✅ 加载完成：${displayName}`);
    } catch (err) {
        console.error('loadModel failed:', err);
        setStatus(`❌ 加载失败：${translateGoError(err)}`);
    }
}

// ======== 处理文件 ========

/** 从 FileSystemDirectoryEntry 递归读取所有文件 */
async function readDirRecursive(entry: FileSystemDirectoryEntry, pathPrefix = ''): Promise<File[]> {
    const reader = entry.createReader();
    const files: File[] = [];
    // readEntries 需多次调用直到返回空数组
    let entries: FileSystemEntry[];
    do {
        entries = await new Promise((resolve, reject) => reader.readEntries(resolve, reject));
        for (const e of entries) {
            if (e.isFile) {
                const fe = e as FileSystemFileEntry;
                const file = await new Promise<File>((resolve, reject) => fe.file(resolve, reject));
                // 用相对路径重写文件名，供 ReferenceFileResolver 匹配
                const relativeName = pathPrefix + e.name;
                // 注：File 构造器不支持改 webkitRelativePath，我们用 IArrayBufferFile 传递路径
                // 但这里保留 File 对象便于类型兼容，后续 handleRawFiles 会用实际路径
                Object.defineProperty(file, 'webkitRelativePath', { value: relativeName });
                files.push(file);
            } else if (e.isDirectory) {
                const subFiles = await readDirRecursive(
                    e as FileSystemDirectoryEntry,
                    pathPrefix + e.name + '/'
                );
                files.push(...subFiles);
            }
        }
    } while (entries.length > 0);
    return files;
}

/** 从 File 或 File[] 中提取 PMX + 纹理，调用 loadModel */
async function handleRawFiles(rawFiles: File[]): Promise<void> {
    let pmxBuffer: ArrayBuffer | null = null;
    let pmxName = '';
    const textures: IArrayBufferFile[] = [];

    // 先找 .pmx，再收集纹理——都用 webkitRelativePath 或 name 作为相对路径
    for (const file of rawFiles) {
        const relPath = file.webkitRelativePath || file.name;
        if (/\.pmx$/i.test(relPath)) {
            pmxBuffer = await file.arrayBuffer();
            pmxName = relPath;
            break;
        }
    }
    if (!pmxBuffer) {
        setStatus('❌ 未找到 .pmx 文件');
        return;
    }

    for (const file of rawFiles) {
        const relPath = file.webkitRelativePath || file.name;
        if (/\.(png|jpg|jpeg|bmp|tga|dds|tif|tiff)$/i.test(relPath)) {
            textures.push({
                relativePath: relPath,
                mimeType: getMimeType(relPath),
                data: await file.arrayBuffer(),
            });
        }
    }

    setStatus(`找到 ${pmxName}，${textures.length} 个纹理，加载中…`);
    await loadModel(pmxBuffer, textures, pmxName);
}

async function handleFile(file: File): Promise<void> {
    if (file.name.endsWith('.pmx')) {
        // 单 PMX 文件：纹理无法加载（无对应图片文件）
        const buffer = await file.arrayBuffer();
        await loadModel(buffer, [], file.name);
    } else if (file.name.endsWith('.zip')) {
        setStatus('正在解压 ZIP…');
        const zip = await JSZip.loadAsync(file);

        let pmxBuffer: ArrayBuffer | null = null;
        let pmxName = '';
        const textures: IArrayBufferFile[] = [];

        const files = zip.files as Record<
            string,
            { dir: boolean; async: (t: 'arraybuffer') => Promise<ArrayBuffer> }
        >;
        const allNames = Object.keys(files);

        // 优先找 .pmx
        for (const name of allNames) {
            const entry = files[name];
            if (entry.dir) {
                continue;
            }
            if (/\.pmx$/i.test(name)) {
                pmxBuffer = await entry.async('arraybuffer');
                pmxName = name;
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
            if (entry.dir) {
                continue;
            }
            if (/\.(png|jpg|jpeg|bmp|tga|dds|tif|tiff)$/i.test(name)) {
                textures.push({
                    relativePath: name,
                    mimeType: getMimeType(name),
                    data: await entry.async('arraybuffer'),
                });
            }
        }

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
dropZone.addEventListener('drop', async (e) => {
    e.preventDefault();
    dropZone.classList.remove('dragover');

    const items = e.dataTransfer?.items;
    const files = e.dataTransfer?.files;

    // 优先用 items API 检测文件夹
    if (items?.length) {
        const item = items[0];
        const entry = item.webkitGetAsEntry?.();
        if (entry?.isDirectory) {
            setStatus('正在读取文件夹…');
            const rawFiles = await readDirRecursive(entry as FileSystemDirectoryEntry);
            if (rawFiles.length > 0) {
                await handleRawFiles(rawFiles);
                showDropZone(false);
            }
            return;
        }
    }

    // 普通文件
    const file = files?.[0];
    if (file) {
        void handleFile(file);
        showDropZone(false);
    }
});

// 点击选择文件（仅文件，不支持文件夹）
dropZone.addEventListener('click', () => {
    fileInput.click();
});
fileInput.addEventListener('change', () => {
    const file = fileInput.files?.[0];
    if (file) {
        void handleFile(file);
        showDropZone(false);
    }
    fileInput.value = '';
});

// 双击 canvas 重新显示拖拽区
canvas.addEventListener('dblclick', () => {
    showDropZone(true);
    setStatus('就绪，拖拽或选择文件');
});

// ======== 启动 ========
initScene();
showDropZone(true);
