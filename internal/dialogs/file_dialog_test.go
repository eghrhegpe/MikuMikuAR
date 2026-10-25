package dialogs

import (
	"testing"
)

// [audit:fix 2026-10] buglog:2026-07-17 半修收口配套测试：
// validStartDir 是 OpenFile/SaveFile/SelectDir 三处 SetDirectory 前的统一判定，
// 失效起始目录必须被拒（对话框落系统默认，避免 GetFileAttributesEx 失败打不开对话框）。
func TestValidStartDir(t *testing.T) {
	// 空串 → false：空 startDir 必须视为无效，不得裸 SetDirectory
	if validStartDir("") {
		t.Error(`validStartDir("") = true, want false`)
	}
	// 存在的临时目录 → true
	if !validStartDir(t.TempDir()) {
		t.Error("validStartDir(existing temp dir) = false, want true")
	}
	// 不存在的 Windows 路径 → false（反引号 raw string：单个反斜杠原样保留）
	if validStartDir(`C:\mmar-nonexistent-xyz`) {
		t.Error("validStartDir(nonexistent C:\\mmar-nonexistent-xyz) = true, want false")
	}
}
