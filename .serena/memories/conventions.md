# 项目编码约定
- 回复和项目说明使用简体中文；代码、标识符、路径、命令保持原文。
- TypeScript 生产代码避免新增 `as any`、`@ts-ignore`；复用已有函数和统一状态入口。
- Babylon/WebAudio/Observable 等资源创建必须在同层级或统一 dispose 链路释放；异步操作需处理竞态、失败和取消。
- i18n 文本放 `frontend/src/core/i18n`，不要在 UI 逻辑中硬编码用户可见文案。
- 大文件先用 grep/Serena 符号定位，再读取局部；结构化重构优先使用 Serena 符号工具。