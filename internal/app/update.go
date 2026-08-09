package app

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"time"
)

// githubRepo is the owner/name used for update checks.
// Replace with your distribution repo if it differs from the source repo.
const githubRepo = "eghrhegpe/MikuMikuAR"

// UpdateCheckResult holds the outcome of a version check.
type UpdateCheckResult struct {
	Current   string `json:"current"`
	Latest    string `json:"latest"`
	Available bool   `json:"available"`
	URL       string `json:"url"`
	CheckedAt int64  `json:"checkedAt"`
	// [doc:adr-179] Asset direct-link for download-and-install flow.
	// Empty when no platform-matching asset was found; the UI falls back to URL.
	DownloadURL string `json:"downloadUrl"`
	AssetName   string `json:"assetName"` // e.g. MikuMikuAR.apk
	Size        int64  `json:"size"`      // bytes, for progress display
	// Error carries network/parse failures. A non-empty Error means the check
	// could not be completed; the UI degrades gracefully rather than treating
	// this as a hard failure.
	Error string `json:"error,omitempty"`
}

// InstallResult is returned by DownloadApk / DownloadAndRunInstaller.
type InstallResult struct {
	LocalPath string `json:"localPath"` // downloaded file path
	Success   bool   `json:"success"`
	Error     string `json:"error,omitempty"`
}

// CheckForUpdate queries the GitHub latest release and reports whether a newer
// version is available. Network/parse failures are reported via Error (and the
// returned result is non-nil) so callers never need to branch on a hard error.
func (a *App) CheckForUpdate() (*UpdateCheckResult, error) {
	res := &UpdateCheckResult{
		Current:   a.appVersion,
		CheckedAt: time.Now().Unix(),
	}
	latest, url, assets, err := latestGitHubRelease(githubRepo)
	if err != nil {
		res.Error = err.Error()
		return res, nil
	}
	res.Latest = latest
	res.URL = url
	res.Available = isNewer(latest, a.appVersion)
	// [doc:adr-179] Match a platform-specific asset for download-and-install.
	if dlURL, name, size := matchPlatformAsset(assets); dlURL != "" {
		res.DownloadURL = dlURL
		res.AssetName = name
		res.Size = size
	}
	return res, nil
}

// DownloadAndRunInstaller downloads the latest desktop installer to a temp
// directory and launches it (never silent-installs). The user must interact
// with the OS-level installer wizard (UAC on Windows, Finder on macOS, etc.).
// Desktop-only; returns an error result on Android or failure.
func (a *App) DownloadAndRunInstaller() (*InstallResult, error) {
	if isAndroid {
		return &InstallResult{Error: "DownloadAndRunInstaller is only supported on desktop"}, nil
	}
	_, _, assets, err := latestGitHubRelease(githubRepo)
	if err != nil {
		return &InstallResult{Error: err.Error()}, nil
	}
	dlURL, name, size := matchDesktopAsset(assets)
	if dlURL == "" {
		return &InstallResult{Error: "no desktop installer found in latest release"}, nil
	}
	dest := filepath.Join(os.TempDir(), name)

	// Progress callback emitting Wails events
	onProgress := func(read, total int64, percent float64) {
		if a.wailsApp != nil {
			a.wailsApp.Event.Emit("update:downloadProgress", map[string]any{
				"read":    read,
				"total":   total,
				"percent": percent,
			})
		}
	}

	if dlErr := downloadFile(dlURL, dest, size, onProgress); dlErr != nil {
		return &InstallResult{Error: fmt.Sprintf("download: %v", dlErr)}, nil
	}
	// Launch the downloaded installer (never silent-install).
	// The OS-level dialog (UAC / Gatekeeper / polkit) handles elevation.
	var cmd *exec.Cmd
	switch runtime.GOOS {
	case "windows":
		cmd = exec.Command(dest)
	case "darwin":
		cmd = exec.Command("open", dest)
	case "linux":
		cmd = exec.Command("xdg-open", dest)
	default:
		return &InstallResult{LocalPath: dest, Error: fmt.Sprintf("unsupported desktop OS: %s", runtime.GOOS)}, nil
	}
	if startErr := cmd.Start(); startErr != nil {
		return &InstallResult{LocalPath: dest, Error: fmt.Sprintf("launch: %v", startErr)}, nil
	}
	return &InstallResult{LocalPath: dest, Success: true}, nil
}

// DownloadApk downloads the latest APK to the app cache directory (Android only).
// Returns the local file path for the caller to trigger installation.
func (a *App) DownloadApk() (*InstallResult, error) {
	if !isAndroid {
		return &InstallResult{Error: "DownloadApk is only supported on Android"}, nil
	}
	_, _, assets, err := latestGitHubRelease(githubRepo)
	if err != nil {
		return &InstallResult{Error: err.Error()}, nil
	}
	dlURL, name, size := matchAndroidAsset(assets)
	if dlURL == "" {
		return &InstallResult{Error: "no APK asset found in latest release"}, nil
	}
	cacheDir, err := platformPathMgr.CacheRoot()
	if err != nil {
		return &InstallResult{Error: fmt.Sprintf("cache dir: %v", err)}, nil
	}
	destDir := filepath.Join(cacheDir, "MikuMikuAR", "updates")
	if mkErr := os.MkdirAll(destDir, 0o755); mkErr != nil {
		return &InstallResult{Error: fmt.Sprintf("mkdir: %v", mkErr)}, nil
	}
	dest := filepath.Join(destDir, name)

	// Progress callback emitting Wails events
	onProgress := func(read, total int64, percent float64) {
		if a.wailsApp != nil {
			a.wailsApp.Event.Emit("update:downloadProgress", map[string]any{
				"read":    read,
				"total":   total,
				"percent": percent,
			})
		}
	}

	if dlErr := downloadFile(dlURL, dest, size, onProgress); dlErr != nil {
		return &InstallResult{Error: fmt.Sprintf("download: %v", dlErr)}, nil
	}
	return &InstallResult{LocalPath: dest, Success: true}, nil
}

// releaseAsset represents a single asset from the GitHub release API.
type releaseAsset struct {
	Name               string `json:"name"`
	BrowserDownloadURL string `json:"browser_download_url"`
	Size               int64  `json:"size"`
}

// latestGitHubRelease fetches tag_name, html_url, and assets of the latest release.
func latestGitHubRelease(repo string) (tag, url string, assets []releaseAsset, err error) {
	ctx, cancel := context.WithTimeout(context.Background(), 6*time.Second)
	defer cancel()

	req, err := http.NewRequestWithContext(ctx, http.MethodGet,
		"https://api.github.com/repos/"+repo+"/releases/latest", nil)
	if err != nil {
		return "", "", nil, err
	}
	req.Header.Set("Accept", "application/vnd.github+json")
	req.Header.Set("User-Agent", "MikuMikuAR-update-check")

	client := &http.Client{}
	resp, err := client.Do(req)
	if err != nil {
		return "", "", nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return "", "", nil, fmt.Errorf("github api status %d", resp.StatusCode)
	}

	var data struct {
		TagName string         `json:"tag_name"`
		HTMLURL string         `json:"html_url"`
		Assets  []releaseAsset `json:"assets"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&data); err != nil {
		return "", "", nil, err
	}
	if data.TagName == "" {
		return "", "", nil, fmt.Errorf("empty tag_name in response")
	}
	return data.TagName, data.HTMLURL, data.Assets, nil
}

// matchPlatformAsset selects the best download asset for the current platform.
// Returns (downloadURL, assetName, size). Empty URL means no match.
func matchPlatformAsset(assets []releaseAsset) (string, string, int64) {
	if isAndroid {
		return matchAndroidAsset(assets)
	}
	return matchDesktopAsset(assets)
}

// matchAndroidAsset finds the first .apk asset.
func matchAndroidAsset(assets []releaseAsset) (string, string, int64) {
	for _, a := range assets {
		if strings.HasSuffix(strings.ToLower(a.Name), ".apk") {
			return a.BrowserDownloadURL, a.Name, a.Size
		}
	}
	return "", "", 0
}

// matchDesktopAsset finds the installer for the current desktop OS/arch.
func matchDesktopAsset(assets []releaseAsset) (string, string, int64) {
	goos := runtime.GOOS
	goarch := runtime.GOARCH
	for _, a := range assets {
		lower := strings.ToLower(a.Name)
		switch {
		case goos == "windows" && strings.HasSuffix(lower, ".exe"):
			return a.BrowserDownloadURL, a.Name, a.Size
		case goos == "darwin" && strings.HasSuffix(lower, ".dmg"):
			// Prefer arch-specific naming if present (e.g. -arm64.dmg)
			if goarch == "arm64" && !strings.Contains(lower, "arm64") {
				continue
			}
			if goarch == "amd64" && strings.Contains(lower, "arm64") {
				continue
			}
			return a.BrowserDownloadURL, a.Name, a.Size
		case goos == "linux" && (strings.HasSuffix(lower, ".appimage") || strings.HasSuffix(lower, ".tar.gz")):
			return a.BrowserDownloadURL, a.Name, a.Size
		}
	}
	return "", "", 0
}

// ProgressCallback is called periodically during download with bytes read and total size.
// percent is 0-100; total may be 0 if Content-Length is unknown.
type ProgressCallback func(read, total int64, percent float64)

// downloadFile fetches url and writes the body to destPath.
// expectedSize is the size declared by the release API asset metadata (bytes).
// When non-zero, the written file size is verified against it; a mismatch
// means a truncated or corrupted download and the incomplete file is removed.
// onProgress is called periodically with download progress (may be nil).
func downloadFile(url, destPath string, expectedSize int64, onProgress ProgressCallback) error {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Minute)
	defer cancel()

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return err
	}
	req.Header.Set("User-Agent", "MikuMikuAR-updater")

	client := &http.Client{}
	resp, err := client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("download status %d", resp.StatusCode)
	}

	f, err := os.Create(destPath)
	if err != nil {
		return err
	}
	defer func() {
		f.Close()
		// [doc:adr-179] On failure, remove the incomplete file to avoid
		// wasting cache space. A stale partial download is useless and
		// the next attempt will re-create the file anyway.
		if err != nil {
			os.Remove(destPath)
		}
	}()

	// Wrap reader with progress reporting if callback provided
	total := expectedSize
	if resp.ContentLength > 0 {
		total = resp.ContentLength
	}

	var reader io.Reader = resp.Body
	if onProgress != nil {
		reader = &updateProgressReader{
			r:          resp.Body,
			total:      total,
			onProgress: onProgress,
		}
	}

	written, err := io.Copy(f, reader)
	if err != nil {
		return err
	}

	// [doc:adr-179] Integrity check: compare written bytes against the
	// asset metadata size (primary) and the HTTP Content-Length header
	// (secondary, when available). Either mismatch means the download is
	// incomplete or corrupted.
	if expectedSize > 0 && written != expectedSize {
		err = fmt.Errorf("size mismatch: wrote %d bytes, expected %d", written, expectedSize)
		return err
	}
	if resp.ContentLength > 0 && written != resp.ContentLength {
		err = fmt.Errorf("size mismatch: wrote %d bytes, Content-Length %d", written, resp.ContentLength)
		return err
	}

	// Emit 100% completion
	if onProgress != nil {
		onProgress(written, written, 100)
	}
	return nil
}

// updateProgressReader wraps an io.Reader and reports progress via callback.
// Used for update downloads (separate from proxy progressReader which has session awareness).
type updateProgressReader struct {
	r          io.Reader
	total      int64
	read       int64
	lastEmit   time.Time
	onProgress ProgressCallback
}

func (pr *updateProgressReader) Read(p []byte) (int, error) {
	n, err := pr.r.Read(p)
	pr.read += int64(n)

	if pr.onProgress != nil && time.Since(pr.lastEmit) > 200*time.Millisecond {
		var percent float64
		if pr.total > 0 {
			percent = float64(pr.read) / float64(pr.total) * 100
		}
		pr.onProgress(pr.read, pr.total, percent)
		pr.lastEmit = time.Now()
	}

	return n, err
}

// isNewer reports whether the remote tag is a newer semantic version than current.
// Both may carry a leading "v"/"V". Development versions (e.g. "dev", non-numeric)
// are treated as not newer to avoid false positives.
func isNewer(latest, current string) bool {
	lv := normalizeVersion(latest)
	cv := normalizeVersion(current)
	if lv == "" || cv == "" {
		return false
	}
	return compareVersion(lv, cv) > 0
}

func normalizeVersion(v string) string {
	v = strings.TrimSpace(v)
	v = strings.TrimPrefix(v, "v")
	v = strings.TrimPrefix(v, "V")
	return v
}

// compareVersion compares two "major[.minor[.patch]]" strings numerically.
// Returns >0 if a>b, <0 if a<b, 0 if equal. Missing segments are treated as 0.
func compareVersion(a, b string) int {
	as := splitVersion(a)
	bs := splitVersion(b)
	for i := 0; i < 3; i++ {
		if as[i] != bs[i] {
			return as[i] - bs[i]
		}
	}
	return 0
}

func splitVersion(v string) [3]int {
	parts := strings.SplitN(v, ".", 3)
	var out [3]int
	for i := 0; i < 3; i++ {
		if i < len(parts) {
			if n, err := strconv.Atoi(strings.TrimSpace(parts[i])); err == nil {
				out[i] = n
			}
		}
	}
	return out
}
