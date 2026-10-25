package app

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// [audit:fix 2026-10] 回归测试：损坏的 config.json 不再静默消失（getConfigUnsafe 已加诊断日志），
// 但返回值语义必须保持不变——损坏 bootstrap → Phase 3 空默认；损坏 setting → 回退 bootstrap。
// 用全新 &App{} 保证 cachedCfg 为 nil，强制走磁盘读路径（避免缓存命中短路）。

// TestGetConfig_CorruptBootstrap：bootstrap config.json 为坏 JSON 时，
// GetConfig 返回非 nil 空 Config 且无 error（语义不变），且不得产生任何备份副产物。
func TestGetConfig_CorruptBootstrap(t *testing.T) {
	dir := testConfigDir(t)
	bootstrapDir := filepath.Join(dir, "MikuMikuAR")
	if err := os.MkdirAll(bootstrapDir, 0755); err != nil {
		t.Fatalf("create bootstrap dir: %v", err)
	}
	if err := os.WriteFile(filepath.Join(bootstrapDir, "config.json"), []byte("{not-valid-json"), 0644); err != nil {
		t.Fatalf("write corrupt bootstrap config.json: %v", err)
	}

	a := &App{} // 全新实例：cachedCfg == nil，走磁盘读路径
	cfg, err := a.GetConfig()
	if err != nil {
		t.Fatalf("GetConfig() error = %v, want nil (corrupt bootstrap must not surface error)", err)
	}
	if cfg == nil {
		t.Fatal("GetConfig() returned nil Config, want non-nil empty default")
	}
	// Phase 3 空默认未经 finaliseConfig：版本未盖章、根目录未解析。
	if cfg.ConfigVersion != 0 {
		t.Errorf("ConfigVersion = %d, want 0 (unfinalised empty default)", cfg.ConfigVersion)
	}
	if cfg.ResourceRoot != "" {
		t.Errorf("ResourceRoot = %q, want empty for corrupt bootstrap", cfg.ResourceRoot)
	}
	// 不得自动备份损坏文件（开放点 (a) 当前裁决：不备份）。
	entries, rErr := os.ReadDir(bootstrapDir)
	if rErr != nil {
		t.Fatalf("ReadDir(%s): %v", bootstrapDir, rErr)
	}
	for _, e := range entries {
		if strings.Contains(e.Name(), "corrupt") {
			t.Errorf("unexpected backup side-effect %q in bootstrap dir; semantics must be log-only", e.Name())
		}
	}
}

// TestGetConfig_CorruptSettingFallsBackBootstrap：bootstrap 有效（ResourceRoot 指向 temp）但
// setting/config.json 为坏 JSON 时，GetConfig 返回 bootstrap 的值（回退语义不变）。
func TestGetConfig_CorruptSettingFallsBackBootstrap(t *testing.T) {
	dir := testConfigDir(t)
	resRoot := t.TempDir()

	// 有效 bootstrap：带唯一 marker 字段，用于证明返回值确实来自 bootstrap。
	bootstrap := Config{
		ResourceRoot:        resRoot,
		DisplayNamePriority: "filename",
	}
	blob, err := json.Marshal(&bootstrap)
	if err != nil {
		t.Fatalf("marshal bootstrap: %v", err)
	}
	bootstrapDir := filepath.Join(dir, "MikuMikuAR")
	if err := os.MkdirAll(bootstrapDir, 0755); err != nil {
		t.Fatalf("create bootstrap dir: %v", err)
	}
	if err := os.WriteFile(filepath.Join(bootstrapDir, "config.json"), blob, 0644); err != nil {
		t.Fatalf("write bootstrap config.json: %v", err)
	}

	// 损坏的 setting 层 config.json。
	settingDirPath := filepath.Join(resRoot, "setting")
	if err := os.MkdirAll(settingDirPath, 0755); err != nil {
		t.Fatalf("create setting dir: %v", err)
	}
	if err := os.WriteFile(filepath.Join(settingDirPath, "config.json"), []byte("{broken-json"), 0644); err != nil {
		t.Fatalf("write corrupt setting config.json: %v", err)
	}

	a := &App{} // 全新实例：cachedCfg == nil，走磁盘读路径
	cfg, err := a.GetConfig()
	if err != nil {
		t.Fatalf("GetConfig() error = %v, want nil", err)
	}
	if cfg == nil {
		t.Fatal("GetConfig() returned nil Config, want bootstrap fallback")
	}
	// 回退语义：损坏的 setting 层不得胜出，返回 bootstrap 的值。
	if cfg.DisplayNamePriority != "filename" {
		t.Errorf("DisplayNamePriority = %q, want %q (bootstrap marker must survive fallback)", cfg.DisplayNamePriority, "filename")
	}
	if cfg.ResourceRoot != resRoot {
		t.Errorf("ResourceRoot = %q, want %q", cfg.ResourceRoot, resRoot)
	}
	// bootstrap 路径经过 finaliseConfig：版本盖章为当前版本。
	if cfg.ConfigVersion != currentConfigVersion {
		t.Errorf("ConfigVersion = %d, want %d (finalised bootstrap)", cfg.ConfigVersion, currentConfigVersion)
	}
}
