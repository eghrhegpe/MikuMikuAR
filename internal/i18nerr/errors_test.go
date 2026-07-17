package i18nerr

import "testing"

// [doc:adr-117] UserError 契约：Error() 内嵌信封必须可被 ParseEnvelope 还原。
func TestUserErrorRoundTrip(t *testing.T) {
	e := New("software.notFound", "未找到 Blender，请在设置中配置路径", map[string]string{"name": "Blender"})
	text := e.Error()
	if text == "" {
		t.Fatal("Error() returned empty string")
	}
	parsed, ok := ParseEnvelope(text)
	if !ok {
		t.Fatalf("ParseEnvelope failed for: %q", text)
	}
	if parsed.Code != "software.notFound" {
		t.Errorf("code = %q, want software.notFound", parsed.Code)
	}
	if parsed.Params["name"] != "Blender" {
		t.Errorf("params[name] = %q, want Blender", parsed.Params["name"])
	}
	if parsed.msg != "未找到 Blender，请在设置中配置路径" {
		t.Errorf("msg = %q", parsed.msg)
	}
}

// 无参错误：params 应为空对象而非 null，信封仍可解析。
func TestUserErrorNoParams(t *testing.T) {
	e := New("config.readFailed", "读取配置失败")
	parsed, ok := ParseEnvelope(e.Error())
	if !ok {
		t.Fatal("ParseEnvelope failed for no-params error")
	}
	if len(parsed.Params) != 0 {
		t.Errorf("params should be empty, got %v", parsed.Params)
	}
}

func TestParseEnvelopeInvalid(t *testing.T) {
	if _, ok := ParseEnvelope("plain text without marker"); ok {
		t.Error("expected false for text without marker")
	}
	if _, ok := ParseEnvelope("has marker but bad json @@GOERR@@{not json"); ok {
		t.Error("expected false for malformed envelope")
	}
}
