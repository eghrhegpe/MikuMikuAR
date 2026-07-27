package llm

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
)

type ChatMessage struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}

type ChatRequest struct {
	Model       string         `json:"model"`
	Messages    []ChatMessage  `json:"messages"`
	Temperature float64        `json:"temperature"`
	MaxTokens   int            `json:"max_tokens"`
}

type Config struct {
	BaseURL string `json:"baseUrl"`
	Model   string `json:"model"`
	ApiKey  string `json:"apiKey"`
}

type StreamEvent struct {
	Type  string // "chunk" | "done" | "error"
	Delta string // for "chunk"
	Error string // for "error"
}

type Client struct {
	config Config
	http   *http.Client
}

func NewClient(cfg Config) *Client {
	return &Client{
		config: cfg,
		http:   &http.Client{},
	}
}

func (c *Client) Config() Config {
	return c.config
}

func (c *Client) WithConfig(cfg Config) *Client {
	return NewClient(cfg)
}

func (c *Client) StreamChat(ctx context.Context, req ChatRequest, emit func(StreamEvent)) {
	if c.config.BaseURL == "" {
		emit(StreamEvent{Type: "error", Error: "LLM 端点未配置"})
		return
	}

	body := map[string]interface{}{
		"model":       req.Model,
		"messages":    req.Messages,
		"temperature": req.Temperature,
		"max_tokens":  req.MaxTokens,
		"stream":      true,
	}

	bodyJSON, err := json.Marshal(body)
	if err != nil {
		emit(StreamEvent{Type: "error", Error: fmt.Sprintf("序列化请求失败: %v", err)})
		return
	}

	httpReq, err := http.NewRequestWithContext(ctx, "POST", c.config.BaseURL, bytes.NewReader(bodyJSON))
	if err != nil {
		emit(StreamEvent{Type: "error", Error: fmt.Sprintf("创建请求失败: %v", err)})
		return
	}

	httpReq.Header.Set("Content-Type", "application/json")
	httpReq.Header.Set("Accept", "text/event-stream")
	httpReq.Header.Set("Cache-Control", "no-cache")
	httpReq.Header.Set("Connection", "keep-alive")
	if c.config.ApiKey != "" {
		httpReq.Header.Set("Authorization", "Bearer "+c.config.ApiKey)
	}

	resp, err := c.http.Do(httpReq)
	if err != nil {
		emit(StreamEvent{Type: "error", Error: fmt.Sprintf("HTTP 请求失败: %v", err)})
		return
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		respBody, _ := io.ReadAll(io.LimitReader(resp.Body, 4096))
		msg := strings.TrimSpace(string(respBody))
		if msg == "" {
			msg = resp.Status
		}
		emit(StreamEvent{Type: "error", Error: fmt.Sprintf("HTTP %d: %s", resp.StatusCode, msg)})
		return
	}

	scanner := bufio.NewScanner(resp.Body)
	scanner.Buffer(make([]byte, 0, 64*1024), 1024*1024)

	for scanner.Scan() {
		line := scanner.Text()
		if !strings.HasPrefix(line, "data:") {
			continue
		}
		data := strings.TrimSpace(line[5:])
		if data == "" || data == "[DONE]" {
			emit(StreamEvent{Type: "done"})
			return
		}

		var chunk struct {
			Choices []struct {
				Delta struct {
					Content string `json:"content"`
				} `json:"delta"`
				FinishReason *string `json:"finish_reason"`
			} `json:"choices"`
		}
		if err := json.Unmarshal([]byte(data), &chunk); err != nil {
			continue
		}
		if len(chunk.Choices) > 0 {
			if chunk.Choices[0].FinishReason != nil {
				emit(StreamEvent{Type: "done"})
				return
			}
			content := chunk.Choices[0].Delta.Content
			if content != "" {
				emit(StreamEvent{Type: "chunk", Delta: content})
			}
		}
	}

	if err := scanner.Err(); err != nil {
		emit(StreamEvent{Type: "error", Error: fmt.Sprintf("流读取错误: %v", err)})
		return
	}

	emit(StreamEvent{Type: "done"})
}

func TestConnection(ctx context.Context, cfg Config) (bool, string) {
	if cfg.BaseURL == "" {
		return false, "端点为空"
	}

	body := map[string]interface{}{
		"model":    cfg.Model,
		"messages": []ChatMessage{{Role: "user", Content: "ping"}},
		"max_tokens": 1,
		"stream":   false,
	}
	bodyJSON, err := json.Marshal(body)
	if err != nil {
		return false, fmt.Sprintf("序列化失败: %v", err)
	}

	httpReq, err := http.NewRequestWithContext(ctx, "POST", cfg.BaseURL, bytes.NewReader(bodyJSON))
	if err != nil {
		return false, fmt.Sprintf("创建请求失败: %v", err)
	}

	httpReq.Header.Set("Content-Type", "application/json")
	if cfg.ApiKey != "" {
		httpReq.Header.Set("Authorization", "Bearer "+cfg.ApiKey)
	}

	client := &http.Client{}
	resp, err := client.Do(httpReq)
	if err != nil {
		return false, fmt.Sprintf("连接失败: %v", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		respBody, _ := io.ReadAll(io.LimitReader(resp.Body, 1024))
		return false, fmt.Sprintf("HTTP %d: %s", resp.StatusCode, strings.TrimSpace(string(respBody)))
	}

	return true, ""
}
