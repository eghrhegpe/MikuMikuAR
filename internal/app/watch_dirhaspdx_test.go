package app

import (
	"os"
	"path/filepath"
	"testing"
)

// [audit:fix 2026-10] dirHasPmx 回归测试（watch.go）：
// importRarToLibrary 用它判定「目录已完整解压」（有 .pmx 才跳过，半截目录重解压）。
func TestDirHasPmx(t *testing.T) {
	// 1. 空目录 → false
	empty := t.TempDir()
	if dirHasPmx(empty) {
		t.Errorf("empty dir: got true, want false")
	}

	// 2. 根目录 .pmx → true
	withRoot := t.TempDir()
	if err := os.WriteFile(filepath.Join(withRoot, "model.pmx"), []byte("x"), 0o644); err != nil {
		t.Fatalf("write root pmx: %v", err)
	}
	if !dirHasPmx(withRoot) {
		t.Errorf("root .pmx: got false, want true")
	}

	// 3. 嵌套子目录 .PMX（大写 + 深度不限）→ true
	nested := t.TempDir()
	deep := filepath.Join(nested, "sub", "deeper")
	if err := os.MkdirAll(deep, 0o755); err != nil {
		t.Fatalf("mkdir deep: %v", err)
	}
	if err := os.WriteFile(filepath.Join(deep, "chara.PMX"), []byte("x"), 0o644); err != nil {
		t.Fatalf("write nested pmx: %v", err)
	}
	if !dirHasPmx(nested) {
		t.Errorf("nested .PMX: got false, want true")
	}

	// 4. 仅 .pmx.bak（后缀不匹配）→ false
	bakOnly := t.TempDir()
	if err := os.WriteFile(filepath.Join(bakOnly, "model.pmx.bak"), []byte("x"), 0o644); err != nil {
		t.Fatalf("write bak: %v", err)
	}
	if dirHasPmx(bakOnly) {
		t.Errorf(".pmx.bak: got true, want false")
	}

	// 5. 不存在的目录（Walk 根错误）→ false
	if dirHasPmx(filepath.Join(empty, "does-not-exist")) {
		t.Errorf("nonexistent dir: got true, want false")
	}
}
