package app

import (
	"bytes"
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
)

func TestValidatePresetName(t *testing.T) {
	tests := []struct {
		input    string
		expected bool
	}{
		{"valid_name", true},
		{"another-valid", true},
		{"", false},
		{"name/with/slash", false},
		{"name\\with\\backslash", false},
		{"name..with..dots", false},
		{"normal name", true},
		{"name:with:colon", false},
		{"name*with*star", false},
		{"name?with?qmark", false},
		{"name\"with\"quote", false},
		{"name<with>angle", false},
		{"name|with|pipe", false},
		{" name ", true},
	}

	for _, tc := range tests {
		result := validatePresetName(tc.input)
		gotValid := result != ""
		if gotValid != tc.expected {
			t.Errorf("validatePresetName(%q) = %q (valid=%v), want valid=%v", tc.input, result, gotValid, tc.expected)
		}
	}
}

func TestScenePresetDir(t *testing.T) {
	a := &App{}
	dir, err := a.scenePresetDir()
	if err != nil {
		t.Fatalf("scenePresetDir() error: %v", err)
	}
	if dir == "" {
		t.Fatal("scenePresetDir() returned empty string")
	}
	info, err := os.Stat(dir)
	if err != nil {
		t.Fatalf("scenePresetDir() path does not exist: %v", err)
	}
	if !info.IsDir() {
		t.Fatal("scenePresetDir() path is not a directory")
	}
}

// testConfigDir overrides userConfigDir for isolated tests.
func testConfigDir(t *testing.T) string {
	t.Helper()
	dir := t.TempDir()
	old := userConfigDir
	userConfigDir = func() (string, error) { return dir, nil }
	t.Cleanup(func() { userConfigDir = old })
	return dir
}

func TestBestDecode_ShiftJIS(t *testing.T) {
	// Japanese filename "初音ミク.pmx" encoded in Shift-JIS
	got := bestDecode("\x8f\x89\x89\xb9\x83\x7e\x83\x4e.pmx")
	want := "初音ミク.pmx"
	if got != want {
		t.Errorf("bestDecode(Shift-JIS) = %q, want %q", got, want)
	}
}

func TestBestDecode_GBK(t *testing.T) {
	// Chinese filename "模型.pmx" encoded in GBK
	got := bestDecode("\xc4\xa3\xd0\xcd.pmx")
	want := "模型.pmx"
	if got != want {
		t.Errorf("bestDecode(GBK) = %q, want %q", got, want)
	}
}

func TestDecodeZipName_UTF8(t *testing.T) {
	got := decodeZipName("model.pmx", false)
	want := "model.pmx"
	if got != want {
		t.Errorf("decodeZipName(false, UTF-8) = %q, want %q", got, want)
	}
}

func TestDecodeZipName_ShiftJIS(t *testing.T) {
	got := decodeZipName("\x8f\x89\x89\xb9\x83\x7e\x83\x4e.pmx", true)
	want := "初音ミク.pmx"
	if got != want {
		t.Errorf("decodeZipName(true, Shift-JIS) = %q, want %q", got, want)
	}
}

func TestZipCacheName(t *testing.T) {
	// zipCacheName now returns SHA-256 hex (64 chars), not path-escaped string.
	// Same input must always produce same hash; different inputs must differ.
	a := zipCacheName("C:/Users/test/model.zip")
	b := zipCacheName("C:/Users/test/model.zip")
	c := zipCacheName("/home/user/model.zip")

	if a == "" {
		t.Fatal("zipCacheName returned empty string")
	}
	if len(a) != 64 {
		t.Errorf("zipCacheName len = %d, want 64 (SHA-256 hex)", len(a))
	}
	if a != b {
		t.Errorf("zipCacheName not deterministic: %q vs %q", a, b)
	}
	if a == c {
		t.Errorf("zipCacheName collision: different paths produced same hash")
	}
}

func TestExtractCacheVersion(t *testing.T) {
	if extractCacheVersion != 8 {
		t.Errorf("extractCacheVersion = %d, want 8", extractCacheVersion)
	}
}

func TestManifestJSON(t *testing.T) {
	m := manifest{
		Source:  "/path/to/test.zip",
		Mtime:   1234567890,
		Size:    1024,
		Version: extractCacheVersion,
	}

	if m.Source != "/path/to/test.zip" {
		t.Errorf("manifest.Source = %q, want %q", m.Source, "/path/to/test.zip")
	}
	if m.Version != extractCacheVersion {
		t.Errorf("manifest.Version = %d, want %d", m.Version, extractCacheVersion)
	}
}

func TestMergeEnvStateMirrorGeometryFields(t *testing.T) {
	// 回归：镜面几何参数持久化缺失（buglog 2026-08-02-mirror-geometry-persist-gap）
	// mergeEnvState 走 JSON round-trip，Go 端 EnvState 结构体必须保留 4 个几何字段，
	// 否则 config.json 静默丢弃，启动恢复回默认值。
	pos := [3]float64{2.5, 1.0, 9.5}
	src := EnvState{
		SkyMode:        "day",
		MirrorEnabled:  true,
		MirrorWidth:    24,
		MirrorHeight:   12,
		MirrorPosition: &pos,
		MirrorRotationY: 0.785,
	}
	var dst *EnvState
	mergeEnvState(&dst, src)
	if dst == nil {
		t.Fatal("mergeEnvState left dst nil")
	}
	if !dst.MirrorEnabled {
		t.Error("MirrorEnabled lost after round-trip")
	}
	if dst.MirrorWidth != 24 {
		t.Errorf("MirrorWidth = %v, want 24", dst.MirrorWidth)
	}
	if dst.MirrorHeight != 12 {
		t.Errorf("MirrorHeight = %v, want 12", dst.MirrorHeight)
	}
	if dst.MirrorPosition == nil || *dst.MirrorPosition != pos {
		t.Errorf("MirrorPosition = %v, want %v", dst.MirrorPosition, pos)
	}
	if dst.MirrorRotationY != 0.785 {
		t.Errorf("MirrorRotationY = %v, want 0.785", dst.MirrorRotationY)
	}

	// 旧配置缺失字段场景：dst 已存在（旧 config.json），src 只带部分字段，
	// round-trip 后 dst 的镜面几何应保留而非被零值覆盖。
	oldPos := [3]float64{0, 1.5, 8}
	dst = &EnvState{MirrorPosition: &oldPos}
	partial := EnvState{SkyMode: "day"}
	mergeEnvState(&dst, partial)
	if dst.MirrorPosition == nil || *dst.MirrorPosition != oldPos {
		t.Errorf("existing MirrorPosition clobbered: %v", dst.MirrorPosition)
	}
}

func TestEnvStateMirrorPositionOmitEmpty(t *testing.T) {
	// 指针 + omitempty：未设置时 JSON 中省略该字段（前端读到 undefined → 兜底默认值），
	// 避免与用户真设置 [0,0,0] 混淆。
	empty := EnvState{}
	data, err := json.Marshal(empty)
	if err != nil {
		t.Fatalf("Marshal error: %v", err)
	}
	if bytes.Contains(data, []byte("mirrorPosition")) {
		t.Errorf("nil MirrorPosition should be omitted with omitempty, got: %s", data)
	}

	zero := [3]float64{0, 0, 0}
	atOrigin := EnvState{MirrorPosition: &zero}
	data, err = json.Marshal(atOrigin)
	if err != nil {
		t.Fatalf("Marshal error: %v", err)
	}
	if !bytes.Contains(data, []byte("mirrorPosition")) {
		t.Errorf("explicit [0,0,0] MirrorPosition must be serialized, got: %s", data)
	}
}

func contains(s, substr string) bool {
	return len(s) >= len(substr) && (s == substr || len(substr) == 0 ||
		(len(s) > 0 && len(substr) > 0 && s[:len(substr)] == substr) ||
		(len(s) > len(substr) && s[len(s)-len(substr):] == substr) ||
		(filepath.Base(s) == substr))
}
