package app

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
)

// [audit:fix 2026-10] round74 P2 修复配套测试：
// SaveRenderPreset 坏 JSON 拒绝 / RenameMotionPreset 前置检查。

func TestSaveRenderPreset_InvalidJSONRejected(t *testing.T) {
	testConfigDir(t) // 隔离：updateConfig 会落真实配置目录
	a := &App{}

	bare, _ := json.Marshal("a bare string") // JSON 裸字符串 → Unmarshal 到 map 必须失败
	for _, bad := range []string{"{not json", string(bare), "[1,2"} {
		if err := a.SaveRenderPreset("broken", bad); err == nil {
			t.Errorf("SaveRenderPreset(%.10q) = nil error, want JSON validation error", bad)
		}
	}
	// 拒绝后不得留下条目
	if presets := a.GetRenderPresets(); len(presets) != 0 {
		t.Errorf("after invalid JSON, GetRenderPresets() = %d entries, want 0", len(presets))
	}
}

func TestSaveRenderPreset_ValidJSON(t *testing.T) {
	testConfigDir(t)
	a := &App{}

	p1, _ := json.Marshal(map[string]any{"exposure": 0.5})
	if err := a.SaveRenderPreset("toon", string(p1)); err != nil {
		t.Fatalf("SaveRenderPreset valid: %v", err)
	}
	presets := a.GetRenderPresets()
	if len(presets) != 1 || presets[0].Name != "toon" {
		t.Fatalf("after save: %d presets, want 1 named toon", len(presets))
	}

	// 同名更新：新 params 完整写入，不产生第二条
	p2, _ := json.Marshal(map[string]any{"exposure": 0.7})
	if err := a.SaveRenderPreset("toon", string(p2)); err != nil {
		t.Fatalf("update valid: %v", err)
	}
	if n := len(a.GetRenderPresets()); n != 1 {
		t.Fatalf("after update: %d presets, want 1", n)
	}
	// null 视为空对象，可保存
	if err := a.SaveRenderPreset("empty", "null"); err != nil {
		t.Fatalf("SaveRenderPreset(null): %v", err)
	}
	if n := len(a.GetRenderPresets()); n != 2 {
		t.Fatalf("after null save: %d presets, want 2", n)
	}
}

func writeMotionPreset(t *testing.T, a *App, name string) {
	t.Helper()
	dir, err := a.motionPresetDir()
	if err != nil {
		t.Fatalf("motionPresetDir: %v", err)
	}
	if err := os.WriteFile(filepath.Join(dir, name+".mcpreset.json"), []byte("{}"), 0o644); err != nil {
		t.Fatalf("write preset %q: %v", name, err)
	}
}

func TestRenameMotionPreset_PreChecks(t *testing.T) {
	testConfigDir(t)
	a := &App{}

	// 源不存在 → 清晰错误（非裸 os error）
	if err := a.RenameMotionPreset("ghost", "target"); err == nil {
		t.Fatal("rename missing source: nil error, want not-found error")
	}

	// 目标已存在 → 清晰错误（Windows 上裸 os.Rename 会直接失败）
	writeMotionPreset(t, a, "a")
	writeMotionPreset(t, a, "b")
	if err := a.RenameMotionPreset("a", "b"); err == nil {
		t.Fatal("rename onto existing target: nil error, want already-exists error")
	}

	// 正常路径仍可改名
	if err := a.RenameMotionPreset("a", "c"); err != nil {
		t.Fatalf("valid rename: %v", err)
	}
	dir, _ := a.motionPresetDir()
	if _, err := os.Stat(filepath.Join(dir, "a.mcpreset.json")); !os.IsNotExist(err) {
		t.Error("source file still present after rename")
	}
	if _, err := os.Stat(filepath.Join(dir, "c.mcpreset.json")); err != nil {
		t.Error("target file missing after rename")
	}
}
