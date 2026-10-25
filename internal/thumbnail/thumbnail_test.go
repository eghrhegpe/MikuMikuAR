package thumbnail

import (
	"bytes"
	"encoding/base64"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"
)

// TestCacheKeyCaseNormalisation verifies [audit:fix 2026-10]: case variants of
// the same file must collapse to one cache key.
//
// The literal backslash pair encodes the Windows scenario ("C:\\M\\a.pmx" vs
// "c:\\m\\A.PMX"). On Linux the backslash is an ordinary character, so both
// sides miss their Rel and stat and the ToLower normalization still makes the
// keys equal — the assertion holds on both platforms (CI runs Go tests on
// ubuntu, see .github/workflows/ci.yml test-backend job).
func TestCacheKeyCaseNormalisation(t *testing.T) {
	if got, want := CacheKey("C:\\M\\a.pmx", "C:\\M"), CacheKey("c:\\m\\A.PMX", "c:\\m"); got != want {
		t.Fatalf("case variants of the same file must share a cache key:\n got %q\nwant %q", got, want)
	}

	// Real files exercise the stat-OK branch of the key.
	t.Run("real files share one key", func(t *testing.T) {
		root := t.TempDir()
		data := []byte("model")
		low := filepath.Join(root, "model.pmx")
		up := filepath.Join(root, "Model.PMX")
		// Same physical file on Windows; two files on Linux. Pin both mtimes
		// to one instant so the mtime component cannot split the keys.
		if err := os.WriteFile(low, data, 0644); err != nil {
			t.Fatalf("write %q: %v", low, err)
		}
		if err := os.WriteFile(up, data, 0644); err != nil {
			t.Fatalf("write %q: %v", up, err)
		}
		ts := time.Now()
		if err := os.Chtimes(low, ts, ts); err != nil {
			t.Fatalf("chtimes %q: %v", low, err)
		}
		if err := os.Chtimes(up, ts, ts); err != nil {
			t.Fatalf("chtimes %q: %v", up, err)
		}
		if got, want := CacheKey(up, root), CacheKey(low, root); got != want {
			t.Fatalf("case variants of the same file must share a key:\n got %q\nwant %q", got, want)
		}
	})
}

// TestGetLegacyFallback verifies the Get fallback chain added by
// [audit:fix 2026-10]: disk entries written under the legacy (un-normalized)
// keys must keep hitting, so old thumbnails survive the key-space rotation
// until the next Save overwrites them.
func TestGetLegacyFallback(t *testing.T) {
	root := t.TempDir()
	model := filepath.Join(root, "A.pmx") // uppercase component: new vs legacy keys provably differ
	thumbBytes := []byte{0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0x42, 0x43}
	if err := os.WriteFile(model, []byte("model"), 0644); err != nil {
		t.Fatalf("create model file: %v", err)
	}
	if newKey := CacheKey(model, root); newKey == legacyCacheKey(model, root) {
		t.Fatalf("test precondition: new and legacy root keys must differ for %q", model)
	}
	want := base64.StdEncoding.EncodeToString(thumbBytes)

	t.Run("legacy root key", func(t *testing.T) {
		thumbDir := t.TempDir()
		legacy := legacyCacheKey(model, root)
		if err := os.WriteFile(filepath.Join(thumbDir, legacy+".png"), thumbBytes, 0644); err != nil {
			t.Fatalf("pre-write legacy root-key thumbnail: %v", err)
		}
		got, err := Get(thumbDir, model, root)
		if err != nil {
			t.Fatalf("Get with legacy root-key entry: %v", err)
		}
		if got != want {
			t.Fatalf("legacy root-key hit returned %q, want %q", got, want)
		}
	})

	t.Run("legacy absolute key", func(t *testing.T) {
		// Pre-resource-root-fix entries were written with the absolute key;
		// with a non-empty root the new root key and the legacy root key both
		// miss, so only the legacy absolute-key step can serve this hit.
		thumbDir := t.TempDir()
		legacyAbs := legacyCacheKey(model, "")
		if err := os.WriteFile(filepath.Join(thumbDir, legacyAbs+".png"), thumbBytes, 0644); err != nil {
			t.Fatalf("pre-write legacy absolute-key thumbnail: %v", err)
		}
		got, err := Get(thumbDir, model, root)
		if err != nil {
			t.Fatalf("Get with legacy absolute-key entry: %v", err)
		}
		if got != want {
			t.Fatalf("legacy absolute-key hit returned %q, want %q", got, want)
		}
	})
}

// TestSaveAtomic verifies [audit:fix 2026-10] atomic Save semantics:
// invalid base64 -> error with no .png and no tmp residue;
// successful Save -> .png under the new key, its unique tmp renamed away.
func TestSaveAtomic(t *testing.T) {
	thumbDir := t.TempDir()
	root := t.TempDir()
	model := filepath.Join(root, "m.pmx") // intentionally absent: deterministic key (no mtime component)
	h := CacheKey(model, root)
	pngPath := filepath.Join(thumbDir, h+".png")
	if err := Save(thumbDir, model, root, "!!!not-base64!!!"); err == nil {
		t.Fatal("Save accepted invalid base64, want error")
	}
	if _, err := os.Stat(pngPath); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf(".png exists after failed Save: %v", err)
	}
	if names := tmpFiles(t, thumbDir, h); len(names) != 0 {
		t.Fatalf(".tmp residue after failed Save: %v", names)
	}

	payload := []byte{0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0x01, 0x02}
	if err := Save(thumbDir, model, root, base64.StdEncoding.EncodeToString(payload)); err != nil {
		t.Fatalf("Save: %v", err)
	}
	got, err := os.ReadFile(pngPath)
	if err != nil {
		t.Fatalf("read %s: %v", pngPath, err)
	}
	if !bytes.Equal(got, payload) {
		t.Fatalf("saved thumbnail bytes mismatch: %x", got)
	}
	if names := tmpFiles(t, thumbDir, h); len(names) != 0 {
		t.Fatalf(".tmp residue after successful Save: %v", names)
	}
	// Primary-hit path: Get must serve the just-saved entry from the new key.
	b64, err := Get(thumbDir, model, root)
	if err != nil {
		t.Fatalf("Get after Save: %v", err)
	}
	if b64 != base64.StdEncoding.EncodeToString(payload) {
		t.Fatalf("Get returned %q, want %q", b64, base64.StdEncoding.EncodeToString(payload))
	}
}

// TestSaveConcurrentSameKey: two goroutines save different PNG payloads under
// the same key. No panic; the final file must be byte-identical to one of the
// two payloads ([audit:fix 2026-10] each Save renames its own unique tmp
// file, so a torn .png can never be cached; a transient destination-rename
// error is tolerated, see below).
func TestSaveConcurrentSameKey(t *testing.T) {
	thumbDir := t.TempDir()
	root := t.TempDir()
	model := filepath.Join(root, "c.pmx") // intentionally absent: deterministic key
	payloadA := []byte("png-payload-A")
	payloadB := []byte("png-payload-B-longer")
	h := CacheKey(model, root)
	pngPath := filepath.Join(thumbDir, h+".png")
	errCh := make(chan error, 2)
	var wg sync.WaitGroup
	for _, payload := range [][]byte{payloadA, payloadB} {
		wg.Add(1)
		go func(payload []byte) {
			defer wg.Done()
			if err := Save(thumbDir, model, root, base64.StdEncoding.EncodeToString(payload)); err != nil {
				errCh <- err
			}
		}(payload)
	}
	wg.Wait()
	close(errCh)
	errs := make([]error, 0, 2)
	for err := range errCh {
		errs = append(errs, err)
	}
	// [audit:fix 2026-10] A unique tmp file per Save call eliminates the
	// shared-handle contention of a fixed ".tmp" name; on Windows a
	// destination rename may still transiently lose to its sibling
	// ("file in use"). The acceptance is no-panic + a complete final file,
	// not two clean returns: one transient error is tolerated (logged),
	// both failing is a real defect.
	if len(errs) == 2 {
		t.Fatalf("both concurrent Saves failed: %v", errs)
	}
	for _, err := range errs {
		t.Logf("transient concurrent Save error (tolerated): %v", err)
	}

	got, err := os.ReadFile(pngPath)
	if err != nil {
		t.Fatalf("read final thumbnail: %v", err)
	}
	if !bytes.Equal(got, payloadA) && !bytes.Equal(got, payloadB) {
		t.Fatalf("final thumbnail (%d bytes) matches neither concurrent payload — torn write leaked past rename", len(got))
	}
	if names := tmpFiles(t, thumbDir, h); len(names) != 0 {
		t.Fatalf(".tmp residue after concurrent Save: %v", names)
	}
}

// tmpFiles lists unique-tmp files (os.CreateTemp pattern hash+".png.tmp.*")
// left behind by Save writes; the tests assert none survive.
func tmpFiles(t *testing.T, thumbDir, hash string) []string {
	t.Helper()
	entries, err := os.ReadDir(thumbDir)
	if err != nil {
		t.Fatalf("list %s: %v", thumbDir, err)
	}
	var names []string
	prefix := hash + ".png.tmp."
	for _, e := range entries {
		if strings.HasPrefix(e.Name(), prefix) {
			names = append(names, e.Name())
		}
	}
	return names
}
// shotTmpFiles lists the ".tmp." files left behind by SaveScreenshot writes
// for a given basename; the tests assert none survive.
func shotTmpFiles(t *testing.T, dir, filename string) []string {
	t.Helper()
	entries, err := os.ReadDir(dir)
	if err != nil {
		t.Fatalf("list %s: %v", dir, err)
	}
	var names []string
	prefix := filepath.Base(filename) + ".tmp."
	for _, e := range entries {
		if strings.HasPrefix(e.Name(), prefix) {
			names = append(names, e.Name())
		}
	}
	return names
}

// TestSaveScreenshotAtomic verifies [audit:fix 2026-10] SaveScreenshot atomic
// write semantics: invalid base64 -> error with no file and no tmp residue;
// valid base64 -> byte-exact file under its basename, its unique tmp renamed
// away (mirrors Save's atomic pattern).
func TestSaveScreenshotAtomic(t *testing.T) {
	dir := t.TempDir()
	name := "shot.png"
	// Invalid base64: error and nothing written (no file, no tmp residue).
	if err := SaveScreenshot(dir, name, "!!!not-base64!!!"); err == nil {
		t.Fatal("SaveScreenshot accepted invalid base64, want error")
	}
	if _, err := os.Stat(filepath.Join(dir, name)); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("file exists after failed SaveScreenshot: %v", err)
	}
	if names := shotTmpFiles(t, dir, name); len(names) != 0 {
		t.Fatalf(".tmp residue after failed SaveScreenshot: %v", names)
	}

	// Valid base64: byte-exact file under its basename.
	payload := []byte{0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0x01, 0x02, 0x03}
	if err := SaveScreenshot(dir, name, base64.StdEncoding.EncodeToString(payload)); err != nil {
		t.Fatalf("SaveScreenshot: %v", err)
	}
	got, err := os.ReadFile(filepath.Join(dir, name))
	if err != nil {
		t.Fatalf("read %s: %v", filepath.Join(dir, name), err)
	}
	if !bytes.Equal(got, payload) {
		t.Fatalf("saved screenshot bytes mismatch: %x", got)
	}
	if names := shotTmpFiles(t, dir, name); len(names) != 0 {
		t.Fatalf(".tmp residue after successful SaveScreenshot: %v", names)
	}
}

// TestSaveScreenshotConcurrentSameKey: four goroutines write different PNG
// payloads to the same dir+filename. No panic, no deterministic EPERM
// regression; the final file must be byte-identical to one of the four
// payloads ([audit:fix 2026-10] each SaveScreenshot renames its own unique
// tmp file, so a torn screenshot can never be cached). Precedent:
// TestSaveConcurrentSameKey. Run with -race.
func TestSaveScreenshotConcurrentSameKey(t *testing.T) {
	dir := t.TempDir()
	name := "shot.png"
	payloads := [][]byte{
		[]byte("png-payload-A"),
		[]byte("png-payload-B-longer"),
		[]byte("png-payload-C"),
		[]byte("png-payload-D"),
	}
	const writers = 4
	errCh := make(chan error, writers)
	var wg sync.WaitGroup
	for _, payload := range payloads {
		wg.Add(1)
		go func(payload []byte) {
			defer wg.Done()
			if err := SaveScreenshot(dir, name, base64.StdEncoding.EncodeToString(payload)); err != nil {
				errCh <- err
			}
		}(payload)
	}
	wg.Wait()
	close(errCh)
	errs := make([]error, 0, writers)
	for err := range errCh {
		errs = append(errs, err)
	}
	// [audit:fix 2026-10] A unique tmp file per call eliminates the
	// shared-handle contention of a fixed ".tmp" name (the EPERM the old
	// code produced under concurrent same-key writes). On Windows a
	// destination rename may still transiently lose to a sibling ("file in
	// use"), which the precedent tolerates. Acceptance: no-panic + a
	// complete final file; all four failing is a real defect.
	if len(errs) == writers {
		t.Fatalf("all %d concurrent SaveScreenshot writes failed: %v", writers, errs)
	}
	for _, err := range errs {
		t.Logf("transient concurrent SaveScreenshot error (tolerated): %v", err)
	}
	got, err := os.ReadFile(filepath.Join(dir, name))
	if err != nil {
		t.Fatalf("read final screenshot: %v", err)
	}
	matched := false
	for _, payload := range payloads {
		if bytes.Equal(got, payload) {
			matched = true
			break
		}
	}
	if !matched {
		t.Fatalf("final screenshot (%d bytes) matches none of the concurrent payloads — torn write leaked past rename", len(got))
	}
	if names := shotTmpFiles(t, dir, name); len(names) != 0 {
		t.Fatalf(".tmp residue after concurrent SaveScreenshot: %v", names)
	}
}
