package llm

// ToolSchema 表示一个 LLM 函数调用工具（OpenAI function_calling 格式）。
type ToolSchema struct {
	Type     string       `json:"type"`
	Function ToolFunction `json:"function"`
}

type ToolFunction struct {
	Name        string      `json:"name"`
	Description string      `json:"description"`
	Parameters  interface{} `json:"parameters"`
}
