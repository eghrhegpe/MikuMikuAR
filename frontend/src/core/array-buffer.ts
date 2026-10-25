// array-buffer.ts — 零依赖 core 叶：Uint8Array 视图安全取 ArrayBuffer。
// 用途：zip-entry / DataView 视图的底层 buffer 可能带 byteOffset/部分长度，
// 裸传 .buffer 会静默把整个底层 buffer 传下去（非对齐读）。
// 本叶：对齐且全长 → 返回同一 buffer（零拷贝）；否则 → slice 拷贝后返回新 buffer。
// [audit:fix 2026-10] ADR-191 禁桶导入（@/core/utils 等 barrel），本叶必须具体叶导入：
//   import { toArrayBuffer } from '@/core/array-buffer';
// 行为兼容：对齐全长视图新旧返回同一 buffer（零语义变化）；带 offset 视图旧裸强转=错位隐患、
// 新=正确拷贝——是修复而非行为回退。
export function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
    if (bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength) {
        return bytes.buffer as ArrayBuffer;
    }
    return bytes.slice().buffer as ArrayBuffer;
}
