package main

import (
	"errors"
	"os"
	"path/filepath"
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
	want := `{"library_root":"/fake/root","external_paths":null,"blender_path":"C:/blender.exe","display_name_priority":"","download_watch_dir":"","download_auto_import":false}`
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
	if got := string(data); got != `{"library_root":"/new","external_paths":null,"blender_path":"C:/blender.exe","display_name_priority":"","download_watch_dir":"","download_auto_import":false}` {
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
