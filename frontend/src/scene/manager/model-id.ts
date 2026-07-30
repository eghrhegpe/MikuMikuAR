// [doc:stable-identity] 模型运行时 id 解析 —— 独立模块，零 Babylon 依赖，便于单测。
import { generateUuid } from '@/core/uuid';

/**
 * 解析模型运行时 id：优先复用存档 uuid（preferredId，由恢复路径传入），
 * 否则生成稳定 uuid。替代旧实现 `model_${Date.now()}_${Math.random()}`，
 * 避免 id 每次加载重生导致材质/outfit/个人灯等状态按 id 落盘后孤儿化、跨会话丢失。
 */
export function resolveModelId(preferredId?: string): string {
    return preferredId && preferredId.length > 0 ? preferredId : generateUuid();
}
