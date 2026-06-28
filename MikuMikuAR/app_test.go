package main

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// ======== writeConfig / configDir ========

func TestWriteConfig(t *testing.T) {
	// Override config dir to a temp dir
	tmp := t.TempDir()
	orig := userConfigDir
	userConfigDir = func() (string, error) { return tmp, nil }
	defer func() { userConfigDir = orig }()

	a := &App{}
	cfg := &Config{LibraryRoot: "/fake/root", BlenderPath: "C:/blender.exe"}

	if err := a.writeConfig(cfg); err != nil {
		t.Fatalf("writeConfig: %v", err)
	}

	// Verify file exists and content is valid JSON
	cfgPath := filepath.Join(tmp, "MikuMikuAR", "config.json")
	data, err := os.ReadFile(cfgPath)
	if err != nil {
		t.Fatalf("read config.json: %v", err)
	}

	got := string(data)
		want := `{"ui_state":{"scale":0,"popupWidth":0,"accent":"","fontFamily":"","animations":false,"blurBg":false},"library_root":"/fake/root","external_paths":null,"blender_path":"C:/blender.exe","display_name_priority":"","download_watch_dir":"","download_auto_import":false,"favorites":null,"render_presets":null,"mmd_path":"","custom_software":null,"tags":null,"dance_sets":null,"recent_models":null}`
	if got != want {
		t.Errorf("config.json content = %q, want %q", got, want)
	}
}

func TestWriteConfig_CreatesDir(t *testing.T) {
	tmp := t.TempDir()
	orig := userConfigDir
	userConfigDir = func() (string, error) { return tmp, nil }
	defer func() { userConfigDir = orig }()

	// Dir doesn't exist yet — writeConfig should create it
	a := &App{}
	if err := a.writeConfig(&Config{LibraryRoot: "/r"}); err != nil {
		t.Fatalf("writeConfig on fresh dir: %v", err)
	}
	if _, err := os.Stat(filepath.Join(tmp, "MikuMikuAR", "config.json")); err != nil {
		t.Errorf("config.json missing after write: %v", err)
	}
}

func TestWriteConfig_OverwriteExisting(t *testing.T) {
	tmp := t.TempDir()
	orig := userConfigDir
	userConfigDir = func() (string, error) { return tmp, nil }
	defer func() { userConfigDir = orig }()

	a := &App{}
	cfgPath := filepath.Join(tmp, "MikuMikuAR", "config.json")

	// Write first config
	if err := a.writeConfig(&Config{LibraryRoot: "/old"}); err != nil {
		t.Fatal(err)
	}

	// Overwrite with different config
	if err := a.writeConfig(&Config{LibraryRoot: "/new", BlenderPath: "C:/blender.exe"}); err != nil {
		t.Fatal(err)
	}

	data, err := os.ReadFile(cfgPath)
	if err != nil {
		t.Fatal(err)
	}
	if got := string(data); got != `{"ui_state":{"scale":0,"popupWidth":0,"accent":"","fontFamily":"","animations":false,"blurBg":false},"library_root":"/new","external_paths":null,"blender_path":"C:/blender.exe","display_name_priority":"","download_watch_dir":"","download_auto_import":false,"favorites":null,"render_presets":null,"mmd_path":"","custom_software":null,"tags":null,"dance_sets":null,"recent_models":null}` {
		t.Errorf("after overwrite = %q, want new config", got)
	}
}

func TestWriteConfig_EmptyConfig(t *testing.T) {
	tmp := t.TempDir()
	orig := userConfigDir
	userConfigDir = func() (string, error) { return tmp, nil }
	defer func() { userConfigDir = orig }()

	a := &App{}
	if err := a.writeConfig(&Config{}); err != nil {
		t.Fatalf("writeConfig empty: %v", err)
	}
	data, err := os.ReadFile(filepath.Join(tmp, "MikuMikuAR", "config.json"))
	if err != nil {
		t.Fatal(err)
	}
	if len(data) == 0 {
		t.Error("empty config wrote empty file")
	}
}

func TestWriteConfig_UserConfigDirError(t *testing.T) {
	orig := userConfigDir
	userConfigDir = func() (string, error) { return "", os.ErrPermission }
	defer func() { userConfigDir = orig }()

	a := &App{}
	if err := a.writeConfig(&Config{LibraryRoot: "/r"}); err == nil {
		t.Error("expected error when userConfigDir fails, got nil")
	}
}

// ======== configDir ========

func TestConfigDir_NormalPath(t *testing.T) {
	tmp := t.TempDir()
	orig := userConfigDir
	userConfigDir = func() (string, error) { return tmp, nil }
	defer func() { userConfigDir = orig }()

	got, err := configDir()
	if err != nil {
		t.Fatalf("configDir: %v", err)
	}
	want := filepath.Join(tmp, "MikuMikuAR")
	if got != want {
		t.Errorf("configDir = %q, want %q", got, want)
	}
	if _, err := os.Stat(want); err != nil {
		t.Errorf("MikuMikuAR dir not created: %v", err)
	}
}

func TestConfigDir_AlreadyExists(t *testing.T) {
	tmp := t.TempDir()
	existing := filepath.Join(tmp, "MikuMikuAR")
	if err := os.MkdirAll(existing, 0755); err != nil {
		t.Fatal(err)
	}

	orig := userConfigDir
	userConfigDir = func() (string, error) { return tmp, nil }
	defer func() { userConfigDir = orig }()

	got, err := configDir()
	if err != nil {
		t.Fatalf("configDir on existing dir: %v", err)
	}
	if got != existing {
		t.Errorf("configDir = %q, want %q", got, existing)
	}
}

func TestConfigDir_UserConfigDirError(t *testing.T) {
	orig := userConfigDir
	userConfigDir = func() (string, error) { return "", os.ErrPermission }
	defer func() { userConfigDir = orig }()

	_, err := configDir()
	if err == nil {
		t.Error("expected error when userConfigDir fails, got nil")
	}
}

func TestConfigDir_MkdirAllError(t *testing.T) {
	// Use a path that cannot be created: a file in a read-only parent.
	// On most systems, creating under a non-writable dir works.
	// Instead, force the test by making userConfigDir return a path
	// where the parent is a file (can't mkdir under a file).
	tmp := t.TempDir()
	// Create a file, then try to mkdir under it
	block := filepath.Join(tmp, "block")
	if err := os.WriteFile(block, []byte{}, 0644); err != nil {
		t.Fatal(err)
	}

	orig := userConfigDir
	userConfigDir = func() (string, error) { return block, nil }
	defer func() { userConfigDir = orig }()

	_, err := configDir()
	if err == nil {
		t.Error("expected error when parent is a file, got nil")
	}
}

// ======== detectBlenderAt ========

func TestDetectBlenderAt_LookPathHit(t *testing.T) {
	hit := "/usr/local/bin/blender"
	got := detectBlenderAt(func(name string) (string, error) {
		if name == "blender" {
			return hit, nil
		}
		return "", errors.New("not found")
	}, nil)
	if got != hit {
		t.Errorf("detectBlenderAt = %q, want %q", got, hit)
	}
}

func TestDetectBlenderAt_LookPathMiss_ThenCandidateHit(t *testing.T) {
	tmp := t.TempDir()
	blenderExe := filepath.Join(tmp, "blender.exe")
	if err := os.WriteFile(blenderExe, []byte{}, 0644); err != nil {
		t.Fatal(err)
	}

	got := detectBlenderAt(func(name string) (string, error) {
		return "", errors.New("not found")
	}, []string{blenderExe})
	if got != blenderExe {
		t.Errorf("detectBlenderAt = %q, want %q", got, blenderExe)
	}
}

func TestDetectBlenderAt_AllMiss(t *testing.T) {
	got := detectBlenderAt(func(name string) (string, error) {
		return "", errors.New("not found")
	}, []string{"C:/nonexistent/blender.exe", "D:/missing/blender.exe"})
	if got != "" {
		t.Errorf("expected empty, got %q", got)
	}
}

func TestDetectMMDAt_LookPathHit(t *testing.T) {
	hit := "C:/mmd/mmd.exe"
	got := detectMMDAt(func(name string) (string, error) {
		if name == "mmd" {
			return hit, nil
		}
		return "", errors.New("not found")
	}, nil, nil)
	if got != hit {
		t.Errorf("detectMMDAt = %q, want %q", got, hit)
	}
}

func TestDetectMMDAt_LookPathMiss_ThenCandidateHit(t *testing.T) {
	tmp := t.TempDir()
	mmdExe := filepath.Join(tmp, "mmd.exe")
	if err := os.WriteFile(mmdExe, []byte{}, 0644); err != nil {
		t.Fatal(err)
	}

	got := detectMMDAt(func(name string) (string, error) {
		return "", errors.New("not found")
	}, os.Stat, []string{mmdExe})
	if got != mmdExe {
		t.Errorf("detectMMDAt = %q, want %q", got, mmdExe)
	}
}

func TestDetectMMDAt_AllMiss(t *testing.T) {
	got := detectMMDAt(func(name string) (string, error) {
		return "", errors.New("not found")
	}, os.Stat, []string{"C:/nonexistent/mmd.exe", "D:/missing/mmd.exe"})
	if got != "" {
		t.Errorf("expected empty, got %q", got)
	}
}

// ======== Software Management Tests ========

func TestSoftwareDir(t *testing.T) {
	tmp := t.TempDir()
	orig := userConfigDir
	userConfigDir = func() (string, error) { return tmp, nil }
	defer func() { userConfigDir = orig }()

	dir, err := softwareDir()
	if err != nil {
		t.Fatalf("softwareDir: %v", err)
	}
	want := filepath.Join(tmp, "MikuMikuAR", "software")
	if dir != want {
		t.Errorf("softwareDir = %q, want %q", dir, want)
	}
	// Verify directory was created
	if _, err := os.Stat(dir); os.IsNotExist(err) {
		t.Errorf("software dir was not created")
	}
}

func TestScanSoftwareDir_Empty(t *testing.T) {
	tmp := t.TempDir()
	orig := userConfigDir
	userConfigDir = func() (string, error) { return tmp, nil }
	defer func() { userConfigDir = orig }()

	a := &App{}
	entries, err := a.ScanSoftwareDir()
	if err != nil {
		t.Fatalf("ScanSoftwareDir: %v", err)
	}
	if len(entries) != 0 {
		t.Errorf("expected empty, got %d entries", len(entries))
	}
}

func TestScanSoftwareDir_WithExes(t *testing.T) {
	tmp := t.TempDir()
	orig := userConfigDir
	userConfigDir = func() (string, error) { return tmp, nil }
	defer func() { userConfigDir = orig }()

	// Create software dir with some .exe files
	softDir := filepath.Join(tmp, "MikuMikuAR", "software")
	if err := os.MkdirAll(softDir, 0755); err != nil {
		t.Fatal(err)
	}
	// Create fake .exe files
	for _, name := range []string{"test_app.exe", "another_tool.exe"} {
		if err := os.WriteFile(filepath.Join(softDir, name), []byte("fake exe"), 0644); err != nil {
			t.Fatal(err)
		}
	}
	// Create a non-exe file that should be ignored
	if err := os.WriteFile(filepath.Join(softDir, "readme.txt"), []byte("hello"), 0644); err != nil {
		t.Fatal(err)
	}

	a := &App{}
	entries, err := a.ScanSoftwareDir()
	if err != nil {
		t.Fatalf("ScanSoftwareDir: %v", err)
	}
	if len(entries) != 2 {
		t.Fatalf("expected 2 entries, got %d: %+v", len(entries), entries)
	}
	// Check entry details (order-independent)
	entryMap := make(map[string]SoftwareEntry)
	for _, e := range entries {
		entryMap[e.Name] = e
	}
	if e, ok := entryMap["test_app"]; !ok {
		t.Errorf("missing entry: test_app")
	} else if !strings.HasSuffix(e.Path, ".exe") {
		t.Errorf("test_app path doesn't end with .exe: %s", e.Path)
	}
	if e, ok := entryMap["another_tool"]; !ok {
		t.Errorf("missing entry: another_tool")
	} else if !strings.HasSuffix(e.Path, ".exe") {
		t.Errorf("another_tool path doesn't end with .exe: %s", e.Path)
	}
}

// ======== Download Watch Tests ========

func TestCheckMagicNumber_Zip(t *testing.T) {
	tmp := t.TempDir()
	f := filepath.Join(tmp, "test.zip")
	if err := os.WriteFile(f, []byte{0x50, 0x4B, 0x03, 0x04, 0x00, 0x00}, 0644); err != nil {
		t.Fatal(err)
	}
	if !checkMagicNumber(f) {
		t.Error("checkMagicNumber should return true for ZIP signature")
	}
}

func TestCheckMagicNumber_Rar(t *testing.T) {
	tmp := t.TempDir()
	f := filepath.Join(tmp, "test.rar")
	if err := os.WriteFile(f, []byte{0x52, 0x61, 0x72, 0x21, 0x1A, 0x07, 0x00}, 0644); err != nil {
		t.Fatal(err)
	}
	if !checkMagicNumber(f) {
		t.Error("checkMagicNumber should return true for RAR signature")
	}
}

func TestCheckMagicNumber_Invalid(t *testing.T) {
	tmp := t.TempDir()
	f := filepath.Join(tmp, "test.txt")
	if err := os.WriteFile(f, []byte("not a zip file"), 0644); err != nil {
		t.Fatal(err)
	}
	if checkMagicNumber(f) {
		t.Error("checkMagicNumber should return false for plain text")
	}
}

func TestCheckMagicNumber_Empty(t *testing.T) {
	tmp := t.TempDir()
	f := filepath.Join(tmp, "empty.zip")
	if err := os.WriteFile(f, []byte{}, 0644); err != nil {
		t.Fatal(err)
	}
	if checkMagicNumber(f) {
		t.Error("checkMagicNumber should return false for empty file")
	}
}

func TestImportLocalFile_Unsupported(t *testing.T) {
	a := &App{}
	_, err := a.ImportLocalFile("test.txt")
	if err == nil {
		t.Error("ImportLocalFile should error for unsupported extension")
	}
}

func TestImportLocalFile_PMX(t *testing.T) {
	a := &App{}
	result, err := a.ImportLocalFile("/path/to/model.pmx")
	if err != nil {
		t.Fatalf("ImportLocalFile(.pmx): %v", err)
	}
	if result.FilePath != "/path/to/model.pmx" {
		t.Errorf("expected FilePath /path/to/model.pmx, got %q", result.FilePath)
	}
}

func TestImportLocalFile_VMD(t *testing.T) {
	a := &App{}
	result, err := a.ImportLocalFile("/path/to/motion.vmd")
	if err != nil {
		t.Fatalf("ImportLocalFile(.vmd): %v", err)
	}
	if result.FilePath != "/path/to/motion.vmd" {
		t.Errorf("expected FilePath /path/to/motion.vmd, got %q", result.FilePath)
	}
}

func TestSetDownloadAutoImport_Persist(t *testing.T) {
	tmp := t.TempDir()
	orig := userConfigDir
	userConfigDir = func() (string, error) { return tmp, nil }
	defer func() { userConfigDir = orig }()

	a := &App{}
	if err := a.SetDownloadAutoImport(true); err != nil {
		t.Fatalf("SetDownloadAutoImport: %v", err)
	}
	cfg, err := a.GetConfig()
	if err != nil {
		t.Fatal(err)
	}
	if !cfg.DownloadAutoImport {
		t.Error("DownloadAutoImport should be true after SetDownloadAutoImport(true)")
	}
	// Flip back
	if err := a.SetDownloadAutoImport(false); err != nil {
		t.Fatalf("SetDownloadAutoImport(false): %v", err)
	}
	cfg, _ = a.GetConfig()
	if cfg.DownloadAutoImport {
		t.Error("DownloadAutoImport should be false after SetDownloadAutoImport(false)")
	}
}

func TestSetDownloadWatchDir_Persist(t *testing.T) {
	tmp := t.TempDir()
	orig := userConfigDir
	userConfigDir = func() (string, error) { return tmp, nil }
	defer func() { userConfigDir = orig }()

	a := &App{}
	watchDir := filepath.Join(tmp, "watch")
	if err := os.MkdirAll(watchDir, 0755); err != nil {
		t.Fatal(err)
	}

	// Set watch dir (will try to start watcher, which may fail in CI — that's ok,
	// we just verify config persistence)
	_ = a.SetDownloadWatchDir(watchDir)
	cfg, err := a.GetConfig()
	if err != nil {
		t.Fatal(err)
	}
	if cfg.DownloadWatchDir != watchDir {
		t.Errorf("DownloadWatchDir = %q, want %q", cfg.DownloadWatchDir, watchDir)
	}

	// Clear watch dir
	_ = a.SetDownloadWatchDir("")
	cfg, _ = a.GetConfig()
	if cfg.DownloadWatchDir != "" {
		t.Errorf("DownloadWatchDir should be empty after clear, got %q", cfg.DownloadWatchDir)
	}
}

func TestGetDownloadWatchStatus_Default(t *testing.T) {
	a := &App{}
	status := a.GetDownloadWatchStatus()
	if status != "" {
		t.Errorf("default watch status should be empty, got %q", status)
	}
}

// ======== Model Preset Library ========

func setupModelPresetTest(t *testing.T) (*App, string) {
	tmp := t.TempDir()
	orig := userConfigDir
	userConfigDir = func() (string, error) { return tmp, nil }
	t.Cleanup(func() { userConfigDir = orig })
	presetDir := filepath.Join(tmp, "MikuMikuAR", "models")
	return &App{}, presetDir
}

func writeTestPreset(t *testing.T, presetDir, name, presetName, modelName, modelRef string) {
	t.Helper()
	writeTestPresetWithAutoApply(t, presetDir, name, presetName, modelName, modelRef, false)
}

func writeTestPresetWithAutoApply(t *testing.T, presetDir, name, presetName, modelName, modelRef string, autoApply bool) {
	t.Helper()
	jsonStr := `{"version":1,"model":{"name":"` + modelName + `","libraryRef":"` + modelRef + `","filePath":"/dummy.pmx","kind":"actor"}`
	if presetName != "" {
		jsonStr += `,"presetName":"` + presetName + `"`
	}
	jsonStr += fmt.Sprintf(`,"autoApply":%t}`, autoApply)
	path := filepath.Join(presetDir, name+".mcupreset.json")
	if err := os.WriteFile(path, []byte(jsonStr), 0644); err != nil {
		t.Fatal(err)
	}
}

func TestModelPresetDir_CreatesDir(t *testing.T) {
	tmp := t.TempDir()
	orig := userConfigDir
	userConfigDir = func() (string, error) { return tmp, nil }
	defer func() { userConfigDir = orig }()

	got, err := modelPresetDir()
	if err != nil {
		t.Fatalf("modelPresetDir: %v", err)
	}
	want := filepath.Join(tmp, "MikuMikuAR", "models")
	if got != want {
		t.Errorf("modelPresetDir = %q, want %q", got, want)
	}
	if _, err := os.Stat(want); err != nil {
		t.Errorf("models dir not created: %v", err)
	}
}

func TestModelPresetDir_UserConfigDirError(t *testing.T) {
	orig := userConfigDir
	userConfigDir = func() (string, error) { return "", os.ErrPermission }
	defer func() { userConfigDir = orig }()

	_, err := modelPresetDir()
	if err == nil {
		t.Error("expected error when userConfigDir fails, got nil")
	}
}

func TestGetModelPresets_Empty(t *testing.T) {
	a, _ := setupModelPresetTest(t)
	got := a.GetModelPresets()
	if len(got) != 0 {
		t.Errorf("expected empty list, got %d entries", len(got))
	}
}

func TestGetModelPresets_WithEntries(t *testing.T) {
	a, presetDir := setupModelPresetTest(t)
	// Ensure dir exists
	os.MkdirAll(presetDir, 0755)

	writeTestPreset(t, presetDir, "off_preset", "默认关闭", "a.pmx", "a.pmx")
	writeTestPresetWithAutoApply(t, presetDir, "on_preset", "开启", "b.pmx", "b.pmx", true)

	got := a.GetModelPresets()
	if len(got) != 2 {
		t.Fatalf("expected 2 entries, got %d", len(got))
	}

	// Verify entries (order not guaranteed)
	m := make(map[string]ModelPresetEntry)
	for _, e := range got {
		m[e.Name] = e
	}

	if e, ok := m["off_preset"]; !ok {
		t.Error("missing off_preset entry")
	} else {
		if e.PresetName != "默认关闭" {
			t.Errorf("off_preset PresetName = %q, want %q", e.PresetName, "默认关闭")
		}
		if e.AutoApply {
			t.Error("off_preset AutoApply should be false")
		}
	}

	if e, ok := m["on_preset"]; !ok {
		t.Error("missing on_preset entry")
	} else {
		if e.PresetName != "开启" {
			t.Errorf("on_preset PresetName = %q, want %q", e.PresetName, "开启")
		}
		if !e.AutoApply {
			t.Error("on_preset AutoApply should be true")
		}
	}
}

func TestGetModelPresets_IgnoresNonPresetFiles(t *testing.T) {
	a, presetDir := setupModelPresetTest(t)
	os.MkdirAll(presetDir, 0755)

	// Valid preset
	writeTestPreset(t, presetDir, "valid", "Valid", "miku.pmx", "miku.pmx")
	// Invalid files
	os.WriteFile(filepath.Join(presetDir, "readme.txt"), []byte("hello"), 0644)
	os.Mkdir(filepath.Join(presetDir, "subdir"), 0755)

	got := a.GetModelPresets()
	if len(got) != 1 {
		t.Errorf("expected 1 entry, got %d", len(got))
	}
}

func TestGetModelPresets_MalformedJSON(t *testing.T) {
	a, presetDir := setupModelPresetTest(t)
	os.MkdirAll(presetDir, 0755)

	// Write valid preset
	writeTestPreset(t, presetDir, "good", "Good", "a.pmx", "a.pmx")
	// Write malformed JSON
	os.WriteFile(filepath.Join(presetDir, "bad.mcupreset.json"), []byte("{invalid}"), 0644)

	got := a.GetModelPresets()
	if len(got) != 2 {
		t.Fatalf("expected 2 entries (bad included with defaults), got %d", len(got))
	}
	for _, e := range got {
		if e.Name == "bad" {
			// Malformed should have empty PresetName/ModelName/ModelRef but still appear
			if e.PresetName != "" || e.ModelName != "" || e.ModelRef != "" {
				t.Errorf("bad entry should have empty fields, got PresetName=%q ModelName=%q ModelRef=%q",
					e.PresetName, e.ModelName, e.ModelRef)
			}
		}
	}
}

func TestLoadModelPresetFromLib(t *testing.T) {
	a, presetDir := setupModelPresetTest(t)
	os.MkdirAll(presetDir, 0755)
	jsonStr := `{"version":1,"model":{"name":"miku.pmx","libraryRef":"models/miku.pmx","filePath":"/dummy.pmx","kind":"actor"},"presetName":"我的初音"}`
	if err := a.SaveModelPresetToLib("miku_test", jsonStr); err != nil {
		t.Fatalf("SaveModelPresetToLib: %v", err)
	}

	got, err := a.LoadModelPresetFromLib("miku_test")
	if err != nil {
		t.Fatalf("LoadModelPresetFromLib: %v", err)
	}
	if got != jsonStr {
		t.Errorf("LoadModelPresetFromLib content mismatch:\ngot:  %s\nwant: %s", got, jsonStr)
	}
}

func TestLoadModelPresetFromLib_NotFound(t *testing.T) {
	a, _ := setupModelPresetTest(t)
	_, err := a.LoadModelPresetFromLib("nonexistent")
	if err == nil {
		t.Error("expected error for non-existent preset, got nil")
	}
}

func TestSaveModelPresetToLib(t *testing.T) {
	a, presetDir := setupModelPresetTest(t)
	jsonStr := `{"version":1,"model":{"name":"miku.pmx","libraryRef":"models/miku.pmx","filePath":"/dummy.pmx","kind":"actor"},"presetName":"我的初音"}`

	if err := a.SaveModelPresetToLib("my_miku", jsonStr); err != nil {
		t.Fatalf("SaveModelPresetToLib: %v", err)
	}

	// Verify file exists
	path := filepath.Join(presetDir, "my_miku.mcupreset.json")
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("file not created: %v", err)
	}
	if string(data) != jsonStr {
		t.Errorf("file content mismatch:\ngot:  %s\nwant: %s", string(data), jsonStr)
	}
}

func TestSaveModelPresetToLib_Overwrite(t *testing.T) {
	a, presetDir := setupModelPresetTest(t)
	os.MkdirAll(presetDir, 0755)

	// Write initial
	initial := `{"version":1,"model":{"name":"old","libraryRef":"old.pmx","filePath":"/old.pmx","kind":"actor"},"presetName":"Old"}`
	if err := a.SaveModelPresetToLib("overwrite_test", initial); err != nil {
		t.Fatalf("initial save: %v", err)
	}

	// Overwrite
	updated := `{"version":1,"model":{"name":"new","libraryRef":"new.pmx","filePath":"/new.pmx","kind":"actor"},"presetName":"New"}`
	if err := a.SaveModelPresetToLib("overwrite_test", updated); err != nil {
		t.Fatalf("overwrite save: %v", err)
	}

	// Verify content is updated
	data, _ := os.ReadFile(filepath.Join(presetDir, "overwrite_test.mcupreset.json"))
	if string(data) != updated {
		t.Errorf("overwrite failed: got %s, want %s", string(data), updated)
	}
}

func TestDeleteModelPreset(t *testing.T) {
	a, presetDir := setupModelPresetTest(t)
	os.MkdirAll(presetDir, 0755)
	writeTestPreset(t, presetDir, "delete_me", "ToDelete", "d.pmx", "d.pmx")

	if err := a.DeleteModelPreset("delete_me"); err != nil {
		t.Fatalf("DeleteModelPreset: %v", err)
	}
	if _, err := os.Stat(filepath.Join(presetDir, "delete_me.mcupreset.json")); !os.IsNotExist(err) {
		t.Error("file still exists after delete")
	}
}

func TestDeleteModelPreset_NotFound(t *testing.T) {
	a, _ := setupModelPresetTest(t)
	if err := a.DeleteModelPreset("nonexistent"); err == nil {
		t.Error("expected error when deleting non-existent preset, got nil")
	}
}

func TestRenameModelPreset(t *testing.T) {
	a, presetDir := setupModelPresetTest(t)
	os.MkdirAll(presetDir, 0755)
	writeTestPreset(t, presetDir, "old_name", "Old", "miku.pmx", "miku.pmx")

	if err := a.RenameModelPreset("old_name", "new_name"); err != nil {
		t.Fatalf("RenameModelPreset: %v", err)
	}

	// Old file should not exist
	if _, err := os.Stat(filepath.Join(presetDir, "old_name.mcupreset.json")); !os.IsNotExist(err) {
		t.Error("old file still exists after rename")
	}
	// New file should exist
	if _, err := os.Stat(filepath.Join(presetDir, "new_name.mcupreset.json")); err != nil {
		t.Error("new file not found after rename")
	}
}

func TestRenameModelPreset_NotFound(t *testing.T) {
	a, _ := setupModelPresetTest(t)
	if err := a.RenameModelPreset("nonexistent", "newname"); err == nil {
		t.Error("expected error when renaming non-existent preset, got nil")
	}
}

func TestValidPresetName_Empty(t *testing.T) {
	if validPresetName("") {
		t.Error("empty name should be invalid")
	}
}

func TestValidPresetName_PathTraversal(t *testing.T) {
	if validPresetName("../evil") {
		t.Error("name with .. should be invalid")
	}
	if validPresetName("foo/bar") {
		t.Error("name with / should be invalid")
	}
	if validPresetName("foo\\bar") {
		t.Error("name with \\ should be invalid")
	}
}

func TestValidPresetName_Valid(t *testing.T) {
	if !validPresetName("miku_dance") {
		t.Error("miku_dance should be valid")
	}
	if !validPresetName("初音未来") {
		t.Error("Unicode should be valid")
	}
	if !validPresetName("a-b_c.d") {
		t.Error("hyphen/dot/underscore should be valid")
	}
}

func TestSaveModelPresetToLib_InvalidName(t *testing.T) {
	a, _ := setupModelPresetTest(t)
	if err := a.SaveModelPresetToLib("../escape", "{}"); err == nil {
		t.Error("expected error for path traversal name")
	}
}

func TestLoadModelPresetFromLib_InvalidName(t *testing.T) {
	a, _ := setupModelPresetTest(t)
	if _, err := a.LoadModelPresetFromLib("../escape"); err == nil {
		t.Error("expected error for path traversal name")
	}
}

func TestDeleteModelPreset_InvalidName(t *testing.T) {
	a, _ := setupModelPresetTest(t)
	if err := a.DeleteModelPreset("../escape"); err == nil {
		t.Error("expected error for path traversal name")
	}
}

func TestRenameModelPreset_InvalidName(t *testing.T) {
	a, _ := setupModelPresetTest(t)
	if err := a.RenameModelPreset("../a", "b"); err == nil {
		t.Error("expected error for path traversal oldName")
	}
	if err := a.RenameModelPreset("a", "../b"); err == nil {
		t.Error("expected error for path traversal newName")
	}
}
