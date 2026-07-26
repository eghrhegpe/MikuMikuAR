package app

import (
	"runtime"
	"testing"
)

// ======== matchAndroidAsset ========

func TestMatchAndroidAsset_FindsApk(t *testing.T) {
	assets := []releaseAsset{
		{Name: "MikuMikuAR-v1.6.3.apk", BrowserDownloadURL: "https://example.com/app.apk", Size: 50_000_000},
		{Name: "MikuMikuAR-setup.exe", BrowserDownloadURL: "https://example.com/setup.exe", Size: 30_000_000},
	}
	url, name, size := matchAndroidAsset(assets)
	if url == "" {
		t.Fatal("expected apk url, got empty")
	}
	if name != "MikuMikuAR-v1.6.3.apk" {
		t.Fatalf("expected apk name, got %q", name)
	}
	if size != 50_000_000 {
		t.Fatalf("expected size 50_000_000, got %d", size)
	}
}

func TestMatchAndroidAsset_NoApk(t *testing.T) {
	assets := []releaseAsset{
		{Name: "setup.exe", BrowserDownloadURL: "https://example.com/setup.exe", Size: 30_000_000},
		{Name: "app.dmg", BrowserDownloadURL: "https://example.com/app.dmg", Size: 40_000_000},
	}
	url, name, size := matchAndroidAsset(assets)
	if url != "" {
		t.Fatalf("expected empty, got %q", url)
	}
	if name != "" {
		t.Fatalf("expected empty name, got %q", name)
	}
	if size != 0 {
		t.Fatalf("expected 0 size, got %d", size)
	}
}

func TestMatchAndroidAsset_CaseInsensitive(t *testing.T) {
	assets := []releaseAsset{
		{Name: "App.APK", BrowserDownloadURL: "https://example.com/app.APK", Size: 100},
	}
	url, _, _ := matchAndroidAsset(assets)
	if url == "" {
		t.Fatal("expected match for uppercase .APK")
	}
}

func TestMatchAndroidAsset_EmptyAssets(t *testing.T) {
	url, name, size := matchAndroidAsset(nil)
	if url != "" || name != "" || size != 0 {
		t.Fatal("expected all empty for nil assets")
	}
}

// ======== matchDesktopAsset (Windows only — current GOOS) ========

func TestMatchDesktopAsset_WindowsExe(t *testing.T) {
	if runtime.GOOS != "windows" {
		t.Skip("desktop match tests are platform-specific")
	}
	assets := []releaseAsset{
		{Name: "MikuMikuAR-setup.exe", BrowserDownloadURL: "https://example.com/setup.exe", Size: 30_000_000},
		{Name: "MikuMikuAR-v1.6.3.apk", BrowserDownloadURL: "https://example.com/app.apk", Size: 50_000_000},
	}
	url, name, size := matchDesktopAsset(assets)
	if url == "" {
		t.Fatal("expected .exe match on Windows")
	}
	if name != "MikuMikuAR-setup.exe" {
		t.Fatalf("expected setup.exe, got %q", name)
	}
	if size != 30_000_000 {
		t.Fatalf("expected size 30_000_000, got %d", size)
	}
}

func TestMatchDesktopAsset_NoMatch(t *testing.T) {
	assets := []releaseAsset{
		{Name: "app.apk", BrowserDownloadURL: "https://example.com/app.apk", Size: 100},
		{Name: "app.dmg", BrowserDownloadURL: "https://example.com/app.dmg", Size: 200},
		{Name: "app.AppImage", BrowserDownloadURL: "https://example.com/app.AppImage", Size: 300},
	}
	url, name, size := matchDesktopAsset(assets)
	// On Windows, none of these should match
	if runtime.GOOS == "windows" {
		if url != "" {
			t.Fatalf("expected no match on Windows, got %q", url)
		}
		if name != "" {
			t.Fatalf("expected empty name, got %q", name)
		}
		if size != 0 {
			t.Fatalf("expected 0 size, got %d", size)
		}
	}
}

func TestMatchDesktopAsset_EmptyAssets(t *testing.T) {
	url, name, size := matchDesktopAsset(nil)
	if url != "" || name != "" || size != 0 {
		t.Fatal("expected all empty for nil assets")
	}
}

// ======== matchPlatformAsset (routing) ========

func TestMatchPlatformAsset_RoutesToAndroid(t *testing.T) {
	// isAndroid is a package-level var; this test verifies the routing
	// decision is correct. On desktop (non-android), matchPlatformAsset
	// should call matchDesktopAsset.
	assets := []releaseAsset{
		{Name: "app.apk", BrowserDownloadURL: "https://example.com/app.apk", Size: 100},
	}
	url, _, _ := matchPlatformAsset(assets)
	if isAndroid {
		// On Android, should match .apk
		if url == "" {
			t.Fatal("expected apk match on android")
		}
	} else {
		// On desktop, apk should NOT be matched
		if url != "" {
			t.Fatal("expected no apk match on desktop")
		}
	}
}

// ======== isNewer ========

func TestIsNewer_NewerDetected(t *testing.T) {
	if !isNewer("v1.7.0", "v1.6.3") {
		t.Fatal("1.7.0 should be newer than 1.6.3")
	}
	if !isNewer("2.0.0", "1.9.9") {
		t.Fatal("2.0.0 should be newer than 1.9.9")
	}
	if !isNewer("1.6.4", "1.6.3") {
		t.Fatal("1.6.4 should be newer than 1.6.3")
	}
}

func TestIsNewer_NotNewer(t *testing.T) {
	if isNewer("v1.6.3", "v1.6.3") {
		t.Fatal("same version should not be newer")
	}
	if isNewer("v1.6.2", "v1.6.3") {
		t.Fatal("older version should not be newer")
	}
}

func TestIsNewer_DevVersion(t *testing.T) {
	// dev / non-numeric versions normalize to 0.0.0, so a numeric version
	// is always "newer" than dev, but "dev" is never newer than a real version.
	if !isNewer("v1.7.0", "dev") {
		t.Fatal("v1.7.0 should be newer than dev (dev → 0.0.0)")
	}
	if isNewer("dev", "v1.6.3") {
		t.Fatal("dev (0.0.0) should not be newer than v1.6.3")
	}
}

func TestIsNewer_NoPrefix(t *testing.T) {
	if !isNewer("1.7.0", "1.6.3") {
		t.Fatal("1.7.0 (no v) should be newer than 1.6.3")
	}
}

func TestIsNewer_CapitalV(t *testing.T) {
	if !isNewer("V1.7.0", "v1.6.3") {
		t.Fatal("V1.7.0 should be newer than v1.6.3")
	}
}

func TestIsNewer_EmptyVersions(t *testing.T) {
	if isNewer("", "v1.6.3") {
		t.Fatal("empty latest should not be newer")
	}
	if isNewer("v1.7.0", "") {
		t.Fatal("empty current should not report newer")
	}
}

// ======== compareVersion ========

func TestCompareVersion_Greater(t *testing.T) {
	if compareVersion("2.0.0", "1.0.0") <= 0 {
		t.Fatal("2.0.0 > 1.0.0")
	}
	if compareVersion("1.1.0", "1.0.0") <= 0 {
		t.Fatal("1.1.0 > 1.0.0")
	}
	if compareVersion("1.0.1", "1.0.0") <= 0 {
		t.Fatal("1.0.1 > 1.0.0")
	}
}

func TestCompareVersion_Equal(t *testing.T) {
	if compareVersion("1.0.0", "1.0.0") != 0 {
		t.Fatal("1.0.0 == 1.0.0")
	}
}

func TestCompareVersion_Less(t *testing.T) {
	if compareVersion("1.0.0", "2.0.0") >= 0 {
		t.Fatal("1.0.0 < 2.0.0")
	}
}

func TestCompareVersion_MissingSegments(t *testing.T) {
	// "1" should be treated as "1.0.0"
	if compareVersion("1", "0.9.9") <= 0 {
		t.Fatal("\"1\" > \"0.9.9\"")
	}
	if compareVersion("1.2", "1.2.0") != 0 {
		t.Fatal("\"1.2\" == \"1.2.0\"")
	}
}

func TestCompareVersion_LeadingZero(t *testing.T) {
	// Atoi handles "01" → 1
	if compareVersion("01.02.03", "1.2.3") != 0 {
		t.Fatal("\"01.02.03\" == \"1.2.3\"")
	}
}

// ======== splitVersion ========

func TestSplitVersion_Full(t *testing.T) {
	v := splitVersion("1.2.3")
	if v != [3]int{1, 2, 3} {
		t.Fatalf("expected [1 2 3], got %v", v)
	}
}

func TestSplitVersion_MajorOnly(t *testing.T) {
	v := splitVersion("5")
	if v != [3]int{5, 0, 0} {
		t.Fatalf("expected [5 0 0], got %v", v)
	}
}

func TestSplitVersion_TwoSegments(t *testing.T) {
	v := splitVersion("3.14")
	if v != [3]int{3, 14, 0} {
		t.Fatalf("expected [3 14 0], got %v", v)
	}
}

func TestSplitVersion_ExtraSegments(t *testing.T) {
	// strings.SplitN with n=3 yields ["1","2","3.4"]; Atoi("3.4") = 0
	v := splitVersion("1.2.3.4")
	if v != [3]int{1, 2, 0} {
		t.Fatalf("expected [1 2 0] (extra segment → non-numeric → 0), got %v", v)
	}
}

func TestSplitVersion_NonNumeric(t *testing.T) {
	v := splitVersion("1.x.3")
	if v != [3]int{1, 0, 3} {
		t.Fatalf("expected [1 0 3] (non-numeric = 0), got %v", v)
	}
}

func TestSplitVersion_EmptyString(t *testing.T) {
	v := splitVersion("")
	if v != [3]int{0, 0, 0} {
		t.Fatalf("expected [0 0 0], got %v", v)
	}
}

func TestSplitVersion_Spaces(t *testing.T) {
	v := splitVersion(" 1 . 2 . 3 ")
	// strings.TrimSpace in Atoi handles spaces within each part
	if v != [3]int{1, 2, 3} {
		t.Fatalf("expected [1 2 3], got %v", v)
	}
}

// ======== normalizeVersion ========

func TestNormalizeVersion_VPrefix(t *testing.T) {
	if normalizeVersion("v1.0.0") != "1.0.0" {
		t.Fatal("expected v prefix stripped")
	}
}

func TestNormalizeVersion_CapitalVPrefix(t *testing.T) {
	if normalizeVersion("V1.0.0") != "1.0.0" {
		t.Fatal("expected capital V prefix stripped")
	}
}

func TestNormalizeVersion_NoPrefix(t *testing.T) {
	if normalizeVersion("1.0.0") != "1.0.0" {
		t.Fatal("expected no-op for version without prefix")
	}
}

func TestNormalizeVersion_Whitespace(t *testing.T) {
	if normalizeVersion("  v1.0.0  ") != "1.0.0" {
		t.Fatal("expected whitespace trimmed and v stripped")
	}
}

func TestNormalizeVersion_Empty(t *testing.T) {
	if normalizeVersion("") != "" {
		t.Fatal("expected empty string unchanged")
	}
}
