// wails-bindings.ts — Wails 生成绑定的手维护聚合层
// 生成器产出的函数通过 re-export 透传；需要包装的函数在此处添加。

export * from '@bindings/mikumikuar/internal/app/app';
export { Events } from '@wailsio/runtime';
export type {
    Config,
    EnvPresetEntry,
    EnvState,
    ExtractResult,
    FileInfo,
    ModelEntry,
    ModelMeta,
    ModelPresetEntry,
    RenderPreset,
    SoftwareEntry,
    UIState,
    UpdateCheckResult,
} from '@bindings/mikumikuar/internal/app/models';

// ======== Wails v3 base64 透明解码 ========
// Go []byte → JSON base64 string（Wails 绑定生成器显式映射，见 type.go:56）。
// 消费者无需关心 base64，直接拿 Uint8Array。
import { ReadFileBytes as _ReadFileBytes } from '@bindings/mikumikuar/internal/app/app';

function _decodeBase64(b64: string): Uint8Array {
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return bytes;
}

/** 读取文件为 Uint8Array（自动解码 Wails v3 的 base64 序列化）。 */
export async function readFileBytes(path: string): Promise<Uint8Array | null> {
    const b64 = await _ReadFileBytes(path);
    return b64 ? _decodeBase64(b64) : null;
}
