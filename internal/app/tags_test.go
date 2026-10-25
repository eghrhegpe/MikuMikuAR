package app

import (
	"slices"
	"testing"
)

// TestGetAllTags_DeterministicSorted 守护 audit 修复：
// cfg.Tags 是 map，迭代顺序不定；修复前 GetAllTags 连调可能得到不同顺序。
// 要求：多键 + 重叠 tag（去重）→ 连调 3 次结果相等，且已排序（期望值 want 本身按字典序）。
func TestGetAllTags_DeterministicSorted(t *testing.T) {
	testConfigDir(t)
	a := NewApp("test", "", "")

	// 2+ 键，且 "shared" 同时出现在两个 ref 中（验证去重）
	if err := a.updateConfig(func(cfg *Config) {
		cfg.Tags = map[string][]string{
			"ref-b": {"tag2", "shared"},
			"ref-a": {"tag1", "shared"},
		}
	}, false); err != nil {
		t.Fatalf("updateConfig failed: %v", err)
	}

	want := []string{"shared", "tag1", "tag2"} // 排序 + 去重后的期望
	first := a.GetAllTags()
	if !slices.Equal(first, want) {
		t.Fatalf("GetAllTags() = %v, want %v", first, want)
	}
	// 连调 3 次：结果必须稳定（确定性）
	for i := 0; i < 3; i++ {
		got := a.GetAllTags()
		if !slices.Equal(got, want) {
			t.Fatalf("GetAllTags() call #%d = %v, want stable %v", i+1, got, want)
		}
	}
}
