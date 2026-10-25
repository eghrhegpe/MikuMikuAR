package app

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// TestSaveSceneFile_BadPathWrapError：保存路径所在目录不存在 → err != nil，
// 且错误 message 含 "SaveSceneFile" 操作前缀（util.WrapError 信封，audit 修复）。
func TestSaveSceneFile_BadPathWrapError(t *testing.T) {
	a := &App{}
	bad := filepath.Join(t.TempDir(), "no-such-dir", "scene.json")
	err := a.SaveSceneFile("payload", bad) // [audit:fix 2026-10] payload 内容不参与断言（坏目录先于内容失败），用裸串避开 JSON 转义
	if err == nil {
		t.Fatalf("SaveSceneFile(%q) err = nil, want non-nil", bad)
	}
	if !strings.Contains(err.Error(), "SaveSceneFile") {
		t.Errorf("SaveSceneFile error missing op prefix: %v", err)
	}
}

// TestLoadSceneFile_BadPathWrapError：读取不存在的文件 → err != nil 且 message 含 "LoadSceneFile" 前缀。
func TestLoadSceneFile_BadPathWrapError(t *testing.T) {
	a := &App{}
	bad := filepath.Join(t.TempDir(), "missing.json")
	if _, err := a.LoadSceneFile(bad); err == nil {
		t.Fatalf("LoadSceneFile(%q) err = nil, want non-nil", bad)
	} else if !strings.Contains(err.Error(), "LoadSceneFile") {
		t.Errorf("LoadSceneFile error missing op prefix: %v", err)
	}
}

// TestSaveSceneFile_SuccessNoWrap：成功路径 err 必须为 nil（util.WrapError(nil) 返回 nil），
// 防止包裹逻辑矫枉过正。
func TestSaveSceneFile_SuccessNoWrap(t *testing.T) {
	a := &App{}
	dir := t.TempDir()
	p := filepath.Join(dir, "scene.json")
	want := "scene-data" // [audit:fix 2026-10] payload 内容不参与断言（SaveSceneFile 裸透传、LoadSceneFile 只比回读），用无引号串避开转义损坏
	if err := a.SaveSceneFile(want, p); err != nil {
		t.Fatalf("SaveSceneFile success case failed: %v", err)
	}
	data, err := os.ReadFile(p)
	if err != nil {
		t.Fatalf("read back failed: %v", err)
	}
	if string(data) != want {
		t.Errorf("content = %q, want %q", data, want)
	}
	if got, err := a.LoadSceneFile(p); err != nil || got != want {
		t.Errorf("LoadSceneFile = (%q, %v), want (%q, nil)", got, err, want)
	}
}

// TestBundleScene_SuccessPath：成功路径走一遍新的 defer f.Close() 日志闭包
//（Close 出错才会 safeLogWarning；成功时闭包静默返回，不影响 err 判定）。
func TestBundleScene_SuccessPath(t *testing.T) {
	testConfigDir(t)
	a := NewApp("test", "", "")
	target := filepath.Join(t.TempDir(), "bundle.zip")
	if err := a.BundleScene(target, "scene-data", nil); err != nil { // [audit:fix 2026-10] BundleScene 不解析 payload（scene.go 零 json. 调用），裸串安全
		t.Fatalf("BundleScene failed: %v", err)
	}
	if _, err := os.Stat(target); err != nil {
		t.Fatalf("bundle file missing: %v", err)
	}
}
