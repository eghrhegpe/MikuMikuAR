// [doc:adr-153] A11y system bridge — stub implementations (non-Windows)
// 非 Windows 平台返回默认值，前端通过 prefers-color-scheme 媒体查询兜底。

//go:build !windows

package app

// detectDarkMode 非 Windows 平台默认 false（前端媒体查询兜底）
func detectDarkMode() bool {
	return false
}

// detectHighContrast 非 Windows 平台默认 false
func detectHighContrast() bool {
	return false
}
