// encoding-japanese 的 ambient 声明（ADR-274 Stage 1）
//
// 该包是纯 JS（node_modules/encoding-japanese/src/index.js），无随包 .d.ts，
// 也未安装 @types/encoding-japanese —— 开启 noImplicitAny 后三处 import 触发 TS7016。
// 这里刻意使用 shorthand 声明（整模块按显式 any 处理），理由见 ADR-274「备选方案」：
// 仓库只用到 convert/detect 两个入口，且返回类型随 options.type（'string' | 'array'）
// 变化；在没有测试保护的解析热路径上写一份「看起来精确」的手搓签名，
// 风险高于收益（签名一旦失真，tsc 会放行错误用法或炸出无关错误）。
// Stage 3（可选）：装 @types/encoding-japanese 后删除本文件，让真类型接管。
//
// 使用面备忘（勿 expands，仅供 Stage 3 对照）：
//   Encoding.convert(str, { to: 'SJIS', type: 'array' })  -> number[]      vmd-writer.ts
//   Encoding.convert(bytes, { to: 'UNICODE', type: 'string' }) -> string   vmd-layers.ts / vpd-parser.ts
//   Encoding.detect(u8)                                    -> string | false  vpd-parser.ts
declare module 'encoding-japanese';
