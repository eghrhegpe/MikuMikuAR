package i18nerr

import (
	"encoding/json"
	"strings"
)

// EnvelopeMarker 是 UserError 在 .Error() 文本中嵌入结构化数据的哨兵。
//
// [doc:adr-117] 契约验证结论：Wails v3 在跨桥时会把 Go error stringify 成纯文本
// （messageprocessor_call.go 用 errs.WrapBindingCallFailedErrorf 包裹 →
// transport_http.go 对非 *CallError 返回 text/plain = err.Error() →
// 前端 runtime.js throw new Error(await response.text())）。
// 因此 *UserError 的 MarshalJSON 永远不会以顶层类型被序列化，结构化
// code/params 无法透传。唯一可靠的通道是把数据编码进 .Error() 字符串，
// 前端按此哨兵提取 JSON 信封再翻译。
const EnvelopeMarker = "@@GOERR@@"

// UserError 是面向用户的错误，携带 i18n code 与占位符参数。
// 前端通过信封内的 code + params，用 t('goerr.<code>', params) 翻译。
//
// [doc:adr-117] Go 端用户可见错误的 i18n 化 — UserError 契约
type UserError struct {
	Code   string            `json:"code"`   // 形如 "software.notFound"，对应前端 t('goerr.software.notFound')
	Params map[string]string `json:"params"` // 占位符，如 {"name": "Blender"}
	msg    string            `json:"-"`      // 开发期 fallback 文本（中文，供 Go 侧日志/调试）
}

// Error 实现 error 接口。
// 文本 = 可读中文 msg + 换行 + 哨兵 + JSON 信封（code/params/msg）。
// 前半段供 Go 日志直接阅读；后半段信封供前端提取翻译，二者互不干扰。
func (e *UserError) Error() string {
	env, err := json.Marshal(struct {
		Code   string            `json:"code"`
		Params map[string]string `json:"params"`
		Msg    string            `json:"msg"`
	}{e.Code, e.Params, e.msg})
	if err != nil {
		// 理论不可达：字段均为基础类型；退化回纯中文，保证不丢失可读信息
		return e.msg
	}
	return e.msg + "\n" + EnvelopeMarker + string(env)
}

// New 构造一个 UserError。
// code: i18n key（形如 "software.notFound"）
// fallbackMsg: 中文兜底文本（Go 侧日志/调试用，亦作为信封内 msg）
// params: 可选占位符参数
func New(code, fallbackMsg string, params ...map[string]string) *UserError {
	p := map[string]string{}
	if len(params) > 0 {
		p = params[0]
	}
	return &UserError{Code: code, Params: p, msg: fallbackMsg}
}

// ParseEnvelope 从 error 文本中提取 UserError 信封。
// 供测试与前端逻辑对齐；当文本不含有效信封时返回 (nil, false)。
func ParseEnvelope(text string) (*UserError, bool) {
	idx := strings.LastIndex(text, EnvelopeMarker)
	if idx < 0 {
		return nil, false
	}
	payload := text[idx+len(EnvelopeMarker):]
	var env struct {
		Code   string            `json:"code"`
		Params map[string]string `json:"params"`
		Msg    string            `json:"msg"`
	}
	if err := json.Unmarshal([]byte(payload), &env); err != nil {
		return nil, false
	}
	if env.Code == "" {
		return nil, false
	}
	return &UserError{Code: env.Code, Params: env.Params, msg: env.Msg}, true
}
