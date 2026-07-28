package app

import (
	"context"
	"os"
	"time"

	"mikumikuar/internal/app/llm"
)

const testConnTimeout = 10 * time.Second

type LLMConfig struct {
	BaseURL string `json:"baseUrl"`
	Model   string `json:"model"`
	AIKey   string `json:"aiKey,omitempty"` // 仅写入时接收；读取时不返回给前端
}

func (a *App) getLLMConfig() LLMConfig {
	cfg, err := a.GetConfig()
	if err != nil || cfg.LLMConfig == nil {
		return LLMConfig{
			BaseURL: "http://localhost:11434/v1/chat/completions",
			Model:   "llama3.2",
		}
	}
	return LLMConfig{
		BaseURL: cfg.LLMConfig.BaseURL,
		Model:   cfg.LLMConfig.Model,
	}
}

func (a *App) getLLMClient(req llm.ChatRequest) *llm.Client {
	cfg, err := a.GetConfig()
	if err != nil || cfg.LLMConfig == nil {
		return llm.NewClient(llm.Config{})
	}
	apiKey := cfg.LLMConfig.AIKey
	if envKey := os.Getenv("MIKUAI_API_KEY"); envKey != "" {
		apiKey = envKey
	}
	clientCfg := llm.Config{
		BaseURL: cfg.LLMConfig.BaseURL,
		Model:   cfg.LLMConfig.Model,
		ApiKey:  apiKey,
	}
	if req.Model != "" {
		clientCfg.Model = req.Model
	}
	return llm.NewClient(clientCfg)
}

func (a *App) AiStreamChat(req llm.ChatRequest) error {
	a.llmMu.Lock()
	if a.llmCancel != nil {
		a.llmCancel()
	}
	ctx, cancel := context.WithCancel(context.Background())
	a.llmCancel = cancel
	a.llmMu.Unlock()

	client := a.getLLMClient(req)

	go func() {
		defer cancel()
		client.StreamChat(ctx, req, func(ev llm.StreamEvent) {
			switch ev.Type {
			case "chunk":
				a.wailsApp.Event.Emit("ai:chunk", map[string]string{"delta": ev.Delta})
			case "done":
				a.wailsApp.Event.Emit("ai:done", map[string]string{})
			case "error":
				a.wailsApp.Event.Emit("ai:error", map[string]string{"error": ev.Error})
			case "tool_call":
				a.wailsApp.Event.Emit("ai:tool_call", map[string]string{
					"toolName": ev.ToolName,
					"toolArgs": ev.ToolArgs,
					"toolId":   ev.ToolId,
				})
			}
		})
	}()

	return nil
}

func (a *App) AiCancelStream() {
	a.llmMu.Lock()
	defer a.llmMu.Unlock()
	if a.llmCancel != nil {
		a.llmCancel()
		a.llmCancel = nil
	}
}

func (a *App) AiSetLLMConfig(cfg LLMConfig) error {
	return a.updateConfig(func(c *Config) {
		if c.LLMConfig == nil {
			c.LLMConfig = &LLMConfig{}
		}
		if cfg.BaseURL != "" {
			c.LLMConfig.BaseURL = cfg.BaseURL
		}
		if cfg.Model != "" {
			c.LLMConfig.Model = cfg.Model
		}
		c.LLMConfig.AIKey = cfg.AIKey
	}, false)
}

func (a *App) AiGetLLMConfig() LLMConfig {
	return a.getLLMConfig()
}

type LLMConnectionResult struct {
	OK      bool   `json:"ok"`
	Kind    string `json:"kind"`
	Message string `json:"message"`
}

func (a *App) AiTestLLMConnection() LLMConnectionResult {
	cfg := a.getLLMConfig()

	apiKey := cfg.AIKey
	if envKey := os.Getenv("MIKUAI_API_KEY"); envKey != "" {
		apiKey = envKey
	}

	clientCfg := llm.Config{
		BaseURL: cfg.BaseURL,
		Model:   cfg.Model,
		ApiKey:  apiKey,
	}

	ctx, cancel := context.WithTimeout(context.Background(), testConnTimeout)
	defer cancel()

	res := llm.TestConnection(ctx, clientCfg)
	return LLMConnectionResult{
		OK:      res.OK,
		Kind:    res.Kind,
		Message: res.Message,
	}
}
