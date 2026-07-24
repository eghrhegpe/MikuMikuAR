/**
 * MikuMikuAR — Web Loader 原型
 * 纯浏览器端 PMX 加载器，零后端依赖。
 *
 * 用法：npm run dev → 打开 http://127.0.0.1:5173/web-loader.html
 * 拖拽 .pmx 或 .zip 文件即可加载。
 */

// ======== ADR-176 Web 入口短路标记 ========
// 置于所有业务 import 之前：resolveBackend() 读到此标记直接选 browser-adapter，
// 跳过 awaitWailsBridge 的 3s 桥接注入等待（纯 Web 下 window.wails 永不注入）。
// __MMKU_BACKEND__ = 'browser' 为权威信号：即便本 bundle 被嵌进 Wails webview 也不走 Go。
(globalThis as { __MMKU_WEB__?: boolean; __MMKU_BACKEND__?: string }).__MMKU_BACKEND__ = 'browser';
(globalThis as { __MMKU_WEB__?: boolean }).__MMKU_WEB__ = true;

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

// ======== ADR-176 Phase 3：backend 选型 + 模型库持久化 ========
import { resolveBackend } from '../core/backend';
import {
    saveModel,
    listModels,
    loadModelBytes,
    getModelEntry,
    deleteModel,
    setLastModel,
    getLastModel,
    formatSize,
} from './library';

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
const libraryPanel = document.getElementById('libraryPanel') as HTMLDivElement;
const libraryList = document.getElementById('libraryList') as HTMLDivElement;
const libraryToggle = document.getElementById('libraryToggle') as HTMLButtonElement;
const capBadge = document.getElementById('capBadge') as HTMLDivElement;

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
): Promise<boolean> {
    if (!scene) {
        return false;
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
            return false;
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
        return true;
    } catch (err) {
        console.error('loadModel failed:', err);
        setStatus(`❌ 加载失败：${translateGoError(err)}`);
        return false;
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

/** 解析 zip 字节：提取 PMX + 纹理。未找到 PMX 返回 null。 */
async function parseZip(
    data: ArrayBuffer | Uint8Array
): Promise<{ pmxBuffer: ArrayBuffer; pmxName: string; textures: IArrayBufferFile[] } | null> {
    const zip = await JSZip.loadAsync(data);

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
        return null;
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

    return { pmxBuffer, pmxName, textures };
}

/** 加载成功后异步入库（失败不阻断展示，仅提示）。 */
async function persistToLibrary(
    fileName: string,
    bytes: Uint8Array,
    kind: 'pmx' | 'zip'
): Promise<void> {
    try {
        const entry = await saveModel(fileName, bytes, kind);
        await setLastModel(entry.name);
        await refreshLibraryPanel();
        setStatus(`✅ 已加载并存入模型库：${entry.name}（${formatSize(entry.size)}）`);
    } catch (err) {
        // IndexedDB 配额不足等场景：展示不受影响，仅提示未持久化
        console.warn('persistToLibrary failed:', err);
        setStatus(`✅ 加载完成（⚠️ 入库失败：${translateGoError(err)}）`);
    }
}

async function handleFile(file: File): Promise<void> {
    if (file.name.endsWith('.pmx')) {
        // 单 PMX 文件：纹理无法加载（无对应图片文件）
        const buffer = await file.arrayBuffer();
        const ok = await loadModel(buffer, [], file.name);
        if (ok) {
            await persistToLibrary(file.name, new Uint8Array(buffer), 'pmx');
        }
    } else if (file.name.endsWith('.zip')) {
        setStatus('正在解压 ZIP…');
        const buffer = await file.arrayBuffer();
        const parsed = await parseZip(buffer);
        if (!parsed) {
            setStatus('❌ ZIP 中未找到 .pmx 文件');
            return;
        }
        setStatus(`找到 ${parsed.pmxName}，${parsed.textures.length} 个纹理，加载中…`);
        const ok = await loadModel(parsed.pmxBuffer, parsed.textures, parsed.pmxName);
        if (ok) {
            await persistToLibrary(file.name, new Uint8Array(buffer), 'zip');
        }
    } else {
        setStatus('⚠️ 请拖拽 .pmx 或 .zip 文件');
    }
}

// ======== 模型库（ADR-176 Phase 3） ========

/** 从库中重载模型（zip 走 parseZip 还原纹理，pmx 直载）。 */
async function loadFromLibrary(name: string): Promise<void> {
    const entry = await getModelEntry(name);
    const bytes = await loadModelBytes(name);
    if (!entry || !bytes) {
        setStatus(`❌ 模型库中不存在：${name}`);
        await refreshLibraryPanel();
        return;
    }
    setStatus(`从模型库载入：${name}…`);
    let ok = false;
    if (entry.kind === 'zip') {
        const parsed = await parseZip(bytes);
        if (!parsed) {
            setStatus(`❌ 库内 zip 已损坏（未找到 .pmx）：${name}`);
            return;
        }
        ok = await loadModel(parsed.pmxBuffer, parsed.textures, parsed.pmxName);
    } else {
        // Uint8Array 可能是大 buffer 的视图，切出精确段
        const buf = bytes.buffer.slice(
            bytes.byteOffset,
            bytes.byteOffset + bytes.byteLength
        ) as ArrayBuffer;
        ok = await loadModel(buf, [], entry.fileName);
    }
    if (ok) {
        await setLastModel(name);
        showDropZone(false);
        setStatus(`✅ 已从模型库载入：${name}`);
    }
}

/** 渲染模型库面板列表（空状态给行动引导）。 */
async function refreshLibraryPanel(): Promise<void> {
    const models = await listModels();
    libraryList.replaceChildren();

    if (models.length === 0) {
        const empty = document.createElement('div');
        empty.className = 'lib-empty';
        empty.textContent = '模型库为空 — 拖拽 .pmx / .zip 加载后自动入库';
        libraryList.appendChild(empty);
        return;
    }

    for (const m of models) {
        const row = document.createElement('div');
        row.className = 'lib-row';

        const info = document.createElement('div');
        info.className = 'lib-info';
        const nameEl = document.createElement('div');
        nameEl.className = 'lib-name';
        nameEl.textContent = m.name;
        nameEl.title = `点击载入 ${m.fileName}`;
        const metaEl = document.createElement('div');
        metaEl.className = 'lib-meta';
        metaEl.textContent = `${m.kind.toUpperCase()} · ${formatSize(m.size)} · ${new Date(m.savedAt).toLocaleDateString()}`;
        info.appendChild(nameEl);
        info.appendChild(metaEl);
        info.addEventListener('click', () => void loadFromLibrary(m.name));

        const delBtn = document.createElement('button');
        delBtn.className = 'lib-del';
        delBtn.textContent = '✕';
        delBtn.title = `删除 ${m.name}`;
        delBtn.addEventListener('click', async (e) => {
            e.stopPropagation();
            // 破坏性操作防呆：二次确认
            if (
                !window.confirm(
                    `确定从模型库删除「${m.name}」？（${formatSize(m.size)}，不可撤销）`
                )
            ) {
                return;
            }
            await deleteModel(m.name);
            setStatus(`已删除：${m.name}`);
            await refreshLibraryPanel();
        });

        row.appendChild(info);
        row.appendChild(delBtn);
        libraryList.appendChild(row);
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

// ======== 模型库面板开关 ========
libraryToggle.addEventListener('click', () => {
    const willShow = libraryPanel.classList.contains('hidden');
    libraryPanel.classList.toggle('hidden', !willShow);
    if (willShow) {
        void refreshLibraryPanel();
    }
});

// ======== 启动（ADR-176 Phase 3：backend 选型 + 库恢复） ========
async function bootstrap(): Promise<void> {
    initScene();
    showDropZone(true);

    try {
        // __MMKU_WEB__ 已置位：resolveBackend 直选 browser-adapter，无 3s 桥接等待
        const backend = await resolveBackend();
        const caps = backend.capabilities();
        capBadge.textContent = `backend: ${backend.kind} · 存储: IndexedDB${caps.fsAccess ? ' · FSA ✓' : ''}`;

        await refreshLibraryPanel();

        // 「继续上次」引导：有 lastModel 时提示一键恢复
        const last = await getLastModel();
        if (last && (await getModelEntry(last))) {
            setStatus(`就绪 — 上次加载过「${last}」，打开📚模型库可一键恢复`);
        }
    } catch (err) {
        // backend 初始化失败不阻断拖拽主链路（隐私模式禁 IndexedDB 等场景）
        console.warn('backend bootstrap failed:', err);
        capBadge.textContent = 'backend: 不可用（仅拖拽加载）';
        setStatus('⚠️ 持久化不可用，拖拽加载仍可正常使用');
    }
}

void bootstrap();
