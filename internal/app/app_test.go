package app

import (
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
	}

	for _, tc := range tests {
		result := validPresetName(tc.input)
		if result != tc.expected {
			t.Errorf("validPresetName(%q) = %v, want %v", tc.input, result, tc.expected)
		}
	}
}

func TestScenePresetDir(t *testing.T) {
	dir, err := scenePresetDir()
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

func TestCleanModelName_ShiftJIS(t *testing.T) {
	got := cleanModelName("\x8f\x89\x89\xb9\x83\x7e\x83\x4e")
	want := "初音ミク"
	if got != want {
		t.Errorf("cleanModelName(Shift-JIS) = %q, want %q", got, want)
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
	if extractCacheVersion != 6 {
		t.Errorf("extractCacheVersion = %d, want 6", extractCacheVersion)
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
	if m.Version != 5 {
		t.Errorf("manifest.Version = %d, want 5", m.Version)
	}
}

func contains(s, substr string) bool {
	return len(s) >= len(substr) && (s == substr || len(substr) == 0 ||
		(len(s) > 0 && len(substr) > 0 && s[:len(substr)] == substr) ||
		(len(s) > len(substr) && s[len(s)-len(substr):] == substr) ||
		(filepath.Base(s) == substr))
}
