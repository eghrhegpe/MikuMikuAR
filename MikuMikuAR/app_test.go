package main

import (
	"errors"
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
	want := `{"library_root":"/fake/root","external_paths":null,"blender_path":"C:/blender.exe","display_name_priority":"","download_watch_dir":"","download_auto_import":false,"favorites":null,"render_presets":null,"mmd_path":"","tags":null,"dance_sets":null}`
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
	if got := string(data); got != `{"library_root":"/new","external_paths":null,"blender_path":"C:/blender.exe","display_name_priority":"","download_watch_dir":"","download_auto_import":false,"favorites":null,"render_presets":null,"mmd_path":"","tags":null,"dance_sets":null}` {
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
