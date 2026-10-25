package app

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// TestFindToktxNotFound [audit:fix 2026-10]
// 未找到 toktx 时 findToktx 必须返回非 nil 错误，且错误文案含三个查找位置
// 提示（app 目录、bin/ 子目录、PATH）——旧实现返回 ("", nil)，调用方
// ktx2Encode 的 err != nil 分支不可达，最终 exec.Command("") 报
// "exec: no command" 用户无解。
func TestFindToktxNotFound(t *testing.T) {
	// 隔离 PATH：指向不存在的空目录，保证 exec.LookPath 必失败 —— 结果
	// 与本机是否装过 toktx 无关（避免环境相关 flaky）。策略 1 查的是
	// os.Executable() 所在目录（测试二进制构建于 GOCACHE 临时目录），
	// 不会命中用户机器上安装的 toktx。
	emptyDir := filepath.Join(t.TempDir(), "no_toktx_here")
	t.Setenv("PATH", emptyDir)

	_, err := findToktx()
	if err == nil {
		t.Fatal("findToktx: 期望未找到时返回错误，实际返回 nil")
	}
	for _, want := range []string{"应用目录", "bin/ 子目录", "PATH"} {
		if !strings.Contains(err.Error(), want) {
			t.Errorf("findToktx 错误文案缺少查找位置提示 %q，实际：%s", want, err)
		}
	}
}

// TestVerifyKtx2Magic [audit:fix 2026-10]
// 魔数校验只读 12 字节前缀（不再整文件读入）：≥12 字节且首 4 字节为
// 0xAB 0x4B 0x54 0x58 通过；<12 字节（含 <4 字节）与魔数不符均报错
// —— 与旧 len<12 / 魔数校验语义一致。
func TestVerifyKtx2Magic(t *testing.T) {
	dir := t.TempDir()

	write := func(name string, data []byte) string {
		p := filepath.Join(dir, name)
		if err := os.WriteFile(p, data, 0o644); err != nil {
			t.Fatalf("写测试文件 %s 失败: %v", name, err)
		}
		return p
	}

	// KTX2 魔数首 4 字节：0xAB 0x4B 0x54 0x58
	magic := []byte{0xAB, 0x4B, 0x54, 0x58}
	pad := func(n int) []byte {
		out := make([]byte, 0, 4+n)
		out = append(out, magic...)
		return append(out, make([]byte, n)...)
	}

	good := write("good.ktx2", pad(8))    // 魔数4B + 填充8B = 12B（KTX2 最小头长）
	short := write("short.ktx2", pad(4))  // 魔数4B + 填充4B = 8B < 12B
	tiny := write("tiny.ktx2", magic[:2]) // 2B < 4B
	badMagic := write("badmagic.ktx2", append([]byte{0x00, 0x4B, 0x54, 0x58}, make([]byte, 8)...))

	if err := verifyKtx2Magic(good); err != nil {
		t.Errorf("good(12B, 魔数正确): 期望通过，实际 %v", err)
	}
	if err := verifyKtx2Magic(short); err == nil {
		t.Error("short(8B < 12B): 期望报错，实际通过")
	}
	if err := verifyKtx2Magic(tiny); err == nil {
		t.Error("tiny(2B < 4B): 期望报错，实际通过")
	}
	if err := verifyKtx2Magic(badMagic); err == nil {
		t.Error("badmagic(魔数不符): 期望报错，实际通过")
	}
	if err := verifyKtx2Magic(filepath.Join(dir, "missing.ktx2")); err == nil {
		t.Error("不存在的文件: 期望报错，实际通过")
	}
}
