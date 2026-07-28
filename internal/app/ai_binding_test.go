package app

import "testing"

// TestAiSetLLMConfig_KeyNotClearedByEmptyUpdate 守护回归：
// 不带 aiKey 的局部更新（如改模型、切 provider）不得清空已存的 AIKey。
// 曾因 AiSetLLMConfig 无条件 `c.LLMConfig.AIKey = cfg.AIKey` 导致后续空 key
// 更新覆盖已存 key，testConnection 报 401 Authorization Not Found。
func TestAiSetLLMConfig_KeyNotClearedByEmptyUpdate(t *testing.T) {
	a := NewApp("test", "", "")

	// 1. 首次写入完整配置（含 key）
	if err := a.AiSetLLMConfig(LLMConfig{
		BaseURL: "https://token.sensenova.cn/v1/chat/completions",
		Model:   "sensenova-6.7-flash-lite",
		AIKey:   "sk-secret-key",
	}); err != nil {
		t.Fatalf("initial AiSetLLMConfig failed: %v", err)
	}

	// 2. 模拟"仅改模型"的局部更新：不带 aiKey
	if err := a.AiSetLLMConfig(LLMConfig{
		BaseURL: "https://token.sensenova.cn/v1/chat/completions",
		Model:   "sensenova-6.7-pro",
	}); err != nil {
		t.Fatalf("model-only AiSetLLMConfig failed: %v", err)
	}

	// 3. 已存的 key 必须保留（读内部 Config；getLLMConfig 会剥离 key 不能用于断言）
	full, err := a.GetConfig()
	if err != nil || full.LLMConfig == nil {
		t.Fatalf("GetConfig failed: err=%v cfg=%v", err, full)
	}
	if full.LLMConfig.AIKey != "sk-secret-key" {
		t.Errorf("AIKey was cleared by empty update: got %q, want %q", full.LLMConfig.AIKey, "sk-secret-key")
	}
	if full.LLMConfig.Model != "sensenova-6.7-pro" {
		t.Errorf("Model not updated: got %q, want %q", full.LLMConfig.Model, "sensenova-6.7-pro")
	}
}

// TestAiSetLLMConfig_KeyUpdatable 确认非空 key 仍可正常更新（守卫不能矫枉过正）。
func TestAiSetLLMConfig_KeyUpdatable(t *testing.T) {
	a := NewApp("test", "", "")

	if err := a.AiSetLLMConfig(LLMConfig{BaseURL: "https://x/v1", Model: "m", AIKey: "old"}); err != nil {
		t.Fatalf("first set failed: %v", err)
	}
	if err := a.AiSetLLMConfig(LLMConfig{AIKey: "new"}); err != nil {
		t.Fatalf("key update failed: %v", err)
	}
	if got := a.mustLLMKey(t); got != "new" {
		t.Errorf("AIKey not updated: got %q, want %q", got, "new")
	}
}

// mustLLMKey 读内部 Config 的 AIKey（getLLMConfig 会剥离 key，不能用于测试断言）。
func (a *App) mustLLMKey(t *testing.T) string {
	t.Helper()
	cfg, err := a.GetConfig()
	if err != nil || cfg.LLMConfig == nil {
		t.Fatalf("GetConfig failed: err=%v cfg=%v", err, cfg)
	}
	return cfg.LLMConfig.AIKey
}
