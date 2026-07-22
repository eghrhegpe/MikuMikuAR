// [doc:adr-153] A11y system bridge — Windows implementation
// 检测系统高对比度/暗色模式（Windows 注册表 + SystemParametersInfoW）

//go:build windows

package app

import (
	"syscall"
	"unsafe"
)

// detectDarkMode 检测系统暗色模式。
// 读取注册表 AppsUseLightTheme
func detectDarkMode() bool {
	key, err := openRegistryKey(`Software\Microsoft\Windows\CurrentVersion\Themes\Personalize`)
	if err != nil {
		return false
	}
	defer closeRegistryKey(key)
	val, err := getRegistryDWORD(key, "AppsUseLightTheme")
	if err != nil {
		return false
	}
	return val == 0
}

// detectHighContrast 检测系统高对比度模式。
func detectHighContrast() bool {
	const SPI_GETHIGHCONTRAST = 0x0042
	type highContrast struct {
		cbSize            uint32
		dwFlags           uint32
		lpszDefaultScheme uintptr
	}
	var hc highContrast
	hc.cbSize = uint32(unsafe.Sizeof(hc))
	ret, _, _ := syscall.NewLazyDLL("user32.dll").NewProc("SystemParametersInfoW").Call(
		uintptr(SPI_GETHIGHCONTRAST),
		uintptr(hc.cbSize),
		uintptr(unsafe.Pointer(&hc)),
		0,
	)
	if ret == 0 {
		return false
	}
	const HCF_HIGHCONTRASTON = 0x00000001
	return (hc.dwFlags & HCF_HIGHCONTRASTON) != 0
}

// ======== Registry helpers (Windows only) ========

var (
	modadvapi32        = syscall.NewLazyDLL("advapi32.dll")
	procRegOpenKeyExW  = modadvapi32.NewProc("RegOpenKeyExW")
	procRegQueryValueExW = modadvapi32.NewProc("RegQueryValueExW")
	procRegCloseKey    = modadvapi32.NewProc("RegCloseKey")
)

const (
	HKEY_CURRENT_USER = 0x80000001
	KEY_READ          = 0x20019
	REG_DWORD         = 4
)

func openRegistryKey(subKey string) (syscall.Handle, error) {
	var key syscall.Handle
	subKeyPtr, err := syscall.UTF16PtrFromString(subKey)
	if err != nil {
		return 0, err
	}
	r, _, err := procRegOpenKeyExW.Call(
		uintptr(HKEY_CURRENT_USER),
		uintptr(unsafe.Pointer(subKeyPtr)),
		0,
		uintptr(KEY_READ),
		uintptr(unsafe.Pointer(&key)),
	)
	if r != 0 {
		return 0, err
	}
	return key, nil
}

func closeRegistryKey(key syscall.Handle) {
	procRegCloseKey.Call(uintptr(key))
}

func getRegistryDWORD(key syscall.Handle, valueName string) (uint32, error) {
	var valType uint32
	var data uint32
	dataSize := uint32(unsafe.Sizeof(data))
	valueNamePtr, err := syscall.UTF16PtrFromString(valueName)
	if err != nil {
		return 0, err
	}
	r, _, err := procRegQueryValueExW.Call(
		uintptr(key),
		uintptr(unsafe.Pointer(valueNamePtr)),
		0,
		uintptr(unsafe.Pointer(&valType)),
		uintptr(unsafe.Pointer(&data)),
		uintptr(unsafe.Pointer(&dataSize)),
	)
	if r != 0 || valType != REG_DWORD {
		return 0, err
	}
	return data, nil
}
