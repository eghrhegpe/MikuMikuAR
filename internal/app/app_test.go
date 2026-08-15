package app

import (
	"bytes"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"
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

// TestUpdateConfigRescanConcurrent 并发触发多个 rescan=true 的配置写入（SetOverridePath），
// 验证 writeIndexAfterScan 的 indexMu + 重读最新配置机制：最终落盘的 index.json 应
// 与最终 config.json 一致（模型条目都位于最终 override 目录下），且无死锁。
// 注：index/config 一致性为 best-effort（二次校验尽力收敛，见 writeIndexAfterScan 注释）。
func TestUpdateConfigRescanConcurrent(t *testing.T) {
	testConfigDir(t)
	root := t.TempDir()
	dirA := filepath.Join(root, "libA")
	dirB := filepath.Join(root, "libB")
	for _, d := range []string{dirA, dirB} {
		if err := os.MkdirAll(d, 0o755); err != nil {
			t.Fatalf("MkdirAll(%s): %v", d, err)
		}
		if err := os.WriteFile(filepath.Join(d, "model.pmx"), []byte("fake-pmx"), 0o644); err != nil {
			t.Fatalf("WriteFile(%s): %v", d, err)
		}
	}

	a := NewApp("test", "", "")
	if err := a.updateConfig(func(c *Config) { c.ResourceRoot = root }, false); err != nil {
		t.Fatalf("init config: %v", err)
	}

	done := make(chan struct{})
	go func() {
		var wg sync.WaitGroup
		for i := 0; i < 8; i++ {
			wg.Add(2)
			go func() { defer wg.Done(); _ = a.SetOverridePath("pmx", dirA) }()
			go func() { defer wg.Done(); _ = a.SetOverridePath("pmx", dirB) }()
		}
		wg.Wait()
		close(done)
	}()

	select {
	case <-done:
	case <-time.After(30 * time.Second):
		t.Fatal("updateConfig 并发 rescan 死锁：30s 未完成")
	}

	cfg, err := a.GetConfig()
	if err != nil {
		t.Fatalf("GetConfig: %v", err)
	}
	finalOverride := cfg.OverridePaths.PMX
	if finalOverride != dirA && finalOverride != dirB {
		t.Fatalf("final override = %q, want %q or %q", finalOverride, dirA, dirB)
	}

	idx, err := a.GetLibraryIndex()
	if err != nil {
		t.Fatalf("GetLibraryIndex: %v", err)
	}
	for _, m := range idx {
		if !strings.HasPrefix(filepath.ToSlash(m.PMXPath), filepath.ToSlash(finalOverride)) {
			t.Errorf("index entry %q not under final override %q — stale index.json", m.PMXPath, finalOverride)
		}
	}
}

// —— mergeUIState presence mask（ADR-253 partial 更新语义）——

// TestMergeUIStatePresenceMaskZeroValues verifies legal zero values are persisted
// when the field is explicitly present in the JSON payload (FpsLimit=0, Volume=0,
// AudioOffset=0 were previously dropped by the != 0 guard).
func TestMergeUIStatePresenceMaskZeroValues(t *testing.T) {
	var src UIState
	if err := json.Unmarshal([]byte(`{"fpsLimit":0,"volume":0,"audioOffset":0,"screenOrientation":"portrait"}`), &src); err != nil {
		t.Fatalf("Unmarshal: %v", err)
	}
	dst := UIState{FpsLimit: 120, Volume: 0.5, AudioOffset: 1.5, ScreenOrientation: "auto"}
	mergeUIState(&dst, src)

	if dst.FpsLimit != 0 {
		t.Errorf("FpsLimit = %d, want 0 (explicit zero must persist)", dst.FpsLimit)
	}
	if dst.Volume != 0 {
		t.Errorf("Volume = %v, want 0 (explicit zero must persist)", dst.Volume)
	}
	if dst.AudioOffset != 0 {
		t.Errorf("AudioOffset = %v, want 0 (explicit zero must persist)", dst.AudioOffset)
	}
	if dst.ScreenOrientation != "portrait" {
		t.Errorf("ScreenOrientation = %q, want portrait", dst.ScreenOrientation)
	}
}

// TestMergeUIStatePresenceMaskPartialNoWipe verifies a partial payload does NOT
// clobber bool fields that were not provided (old code overwrote them with false).
func TestMergeUIStatePresenceMaskPartialNoWipe(t *testing.T) {
	var src UIState
	if err := json.Unmarshal([]byte(`{"scale":1.3}`), &src); err != nil {
		t.Fatalf("Unmarshal: %v", err)
	}
	dst := UIState{Animations: true, BlurBg: true, AutoCameraEnabled: true, Scale: 1.0}
	mergeUIState(&dst, src)

	if dst.Scale != 1.3 {
		t.Errorf("Scale = %v, want 1.3", dst.Scale)
	}
	if !dst.Animations {
		t.Error("Animations must survive a partial {scale} update")
	}
	if !dst.BlurBg {
		t.Error("BlurBg must survive a partial {scale} update")
	}
	if !dst.AutoCameraEnabled {
		t.Error("AutoCameraEnabled must survive a partial {scale} update")
	}
}

// TestMergeUIStatePresenceMaskExplicitBoolFalse verifies an explicitly provided
// false bool is persisted (mask distinguishes "absent" from "false").
func TestMergeUIStatePresenceMaskExplicitBoolFalse(t *testing.T) {
	var src UIState
	if err := json.Unmarshal([]byte(`{"animations":false,"blurBg":false}`), &src); err != nil {
		t.Fatalf("Unmarshal: %v", err)
	}
	dst := UIState{Animations: true, BlurBg: true}
	mergeUIState(&dst, src)

	if dst.Animations {
		t.Error("Animations must be false after explicit false update")
	}
	if dst.BlurBg {
		t.Error("BlurBg must be false after explicit false update")
	}
}

// TestMergeUIStatePresenceMaskFullPayload verifies a full payload updates every
// field (browser-adapter sends {...cur, field: v} which contains all keys).
func TestMergeUIStatePresenceMaskFullPayload(t *testing.T) {
	var src UIState
	raw := `{"scale":1.2,"animations":false,"fpsLimit":0,"volume":0.7}`
	if err := json.Unmarshal([]byte(raw), &src); err != nil {
		t.Fatalf("Unmarshal: %v", err)
	}
	dst := UIState{Scale: 1.0, Animations: true, FpsLimit: 60, Volume: 0.3}
	mergeUIState(&dst, src)

	if dst.Scale != 1.2 || dst.Animations || dst.FpsLimit != 0 || dst.Volume != 0.7 {
		t.Errorf("full payload merge mismatch: %+v", dst)
	}
}

// TestMergeUIStateNoPresentLegacy verifies that when UIState is constructed
// directly in Go (present == nil, no JSON round-trip), the legacy semantics are
// preserved so existing internal callers behave identically: non-zero scalars are
// copied, zero scalars do NOT overwrite, and bool fields are unconditionally
// overwritten (the pre-mask behavior).
func TestMergeUIStateNoPresentLegacy(t *testing.T) {
	dst := UIState{Scale: 1.0, FpsLimit: 60, Animations: true}
	mergeUIState(&dst, UIState{Scale: 1.3, FpsLimit: 0, Animations: false})

	if dst.Scale != 1.3 {
		t.Errorf("Scale = %v, want 1.3 (non-zero legacy copy)", dst.Scale)
	}
	if dst.FpsLimit != 60 {
		t.Errorf("FpsLimit = %d, want 60 (zero legacy value must NOT overwrite)", dst.FpsLimit)
	}
	if dst.Animations {
		t.Error("Animations must be overwritten by legacy unconditional bool copy")
	}
}
