package app

import (
	"testing"
)

// [audit:fix 2026-10] 「收藏」字面量收敛（favoriteTag）配套测试：
// ToggleFavorite 行为保持纯重构 —— tag 增删往返 + Favorites 遗留迁移分支。
// 先例：testConfigDir(t) + 最小 &App{} 构造（preset_fix_test.go / config_corrupt_test.go）。

// containsTag 是本测试文件的局部 helper（包内无既有同名函数，已 grep 确认）。
func containsTag(tags []string, tag string) bool {
	for _, s := range tags {
		if s == tag {
			return true
		}
	}
	return false
}

// TestToggleFavorite_TagRoundTrip：toggle 加 → 再 toggle 删，favoriteTag 在 config 中往返。
func TestToggleFavorite_TagRoundTrip(t *testing.T) {
	testConfigDir(t) // 隔离：updateConfig 会落真实配置目录
	a := &App{}

	// 造基线配置（Tags 空）
	if err := a.updateConfig(func(cfg *Config) {}, false); err != nil {
		t.Fatalf("bootstrap config: %v", err)
	}

	// toggle 一次 → 写入 favoriteTag
	if err := a.ToggleFavorite("lib/a.pmx"); err != nil {
		t.Fatalf("ToggleFavorite add: %v", err)
	}
	cfg, err := a.GetConfig()
	if err != nil {
		t.Fatalf("GetConfig after add: %v", err)
	}
	if !containsTag(cfg.Tags["lib/a.pmx"], favoriteTag) {
		t.Fatalf("after add: Tags[lib/a.pmx] = %v, want contains %q", cfg.Tags["lib/a.pmx"], favoriteTag)
	}

	// 再 toggle 一次 → 移除
	if err := a.ToggleFavorite("lib/a.pmx"); err != nil {
		t.Fatalf("ToggleFavorite remove: %v", err)
	}
	cfg, err = a.GetConfig()
	if err != nil {
		t.Fatalf("GetConfig after remove: %v", err)
	}
	if containsTag(cfg.Tags["lib/a.pmx"], favoriteTag) {
		t.Fatalf("after remove: Tags[lib/a.pmx] = %v, want no %q", cfg.Tags["lib/a.pmx"], favoriteTag)
	}
}

// TestToggleFavorite_MigratesLegacyFavorites：旧 cfg.Favorites 数组 → Tags 迁移分支。
//
// 说明：任务书原设想（Favorites=["lib/b.pmx"] + 单次 ToggleFavorite("lib/b.pmx")
// 后断言 Tags 含 favoriteTag）与源码行为矛盾——迁移分支先给 b 写入收藏，
// 同一 ref 的 toggle 语义是「found → 移除」，终态 Tags 条目为空、不含 favoriteTag。
// 故保持任务书 setup（Favorites=["lib/b.pmx"]、Tags nil、toggle "lib/b.pmx"），
// 拆成两次 toggle：第一次跑迁移分支（Favorites 清空），第二次把 favoriteTag 加回，
// 两个断言同时成立。
func TestToggleFavorite_MigratesLegacyFavorites(t *testing.T) {
	testConfigDir(t) // 隔离：updateConfig 会落真实配置目录
	a := &App{}

	// setup：Favorites 遗留数组 + Tags nil
	if err := a.updateConfig(func(cfg *Config) {
		cfg.Favorites = []string{"lib/b.pmx"}
	}, false); err != nil {
		t.Fatalf("seed legacy Favorites: %v", err)
	}

	// 第一次 toggle "lib/b.pmx"：迁移分支把 Favorites 并入 Tags，随后该 ref 被 toggle 掉
	if err := a.ToggleFavorite("lib/b.pmx"); err != nil {
		t.Fatalf("ToggleFavorite (migrate): %v", err)
	}
	cfg, err := a.GetConfig()
	if err != nil {
		t.Fatalf("GetConfig after migrate: %v", err)
	}
	if len(cfg.Favorites) != 0 {
		t.Fatalf("after migration: Favorites = %v, want empty", cfg.Favorites)
	}

	// 第二次 toggle "lib/b.pmx"：favoriteTag 重新写入，且 Favorites 保持清空
	if err := a.ToggleFavorite("lib/b.pmx"); err != nil {
		t.Fatalf("ToggleFavorite (re-add): %v", err)
	}
	cfg, err = a.GetConfig()
	if err != nil {
		t.Fatalf("GetConfig after re-add: %v", err)
	}
	if !containsTag(cfg.Tags["lib/b.pmx"], favoriteTag) {
		t.Fatalf("Tags[lib/b.pmx] = %v, want contains %q", cfg.Tags["lib/b.pmx"], favoriteTag)
	}
	if len(cfg.Favorites) != 0 {
		t.Fatalf("Favorites = %v, want empty", cfg.Favorites)
	}
}
