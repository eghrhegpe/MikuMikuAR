package app

import (
	"testing"
	"unicode/utf8"

	"golang.org/x/text/encoding/japanese"
	"golang.org/x/text/transform"
)

// encodeShiftJIS converts a UTF-8 string to Shift-JIS bytes for test data construction.
func encodeShiftJIS(s string) (string, error) {
	result, _, err := transform.String(japanese.ShiftJIS.NewEncoder(), s)
	return result, err
}

// mustShiftJIS panics on error — for test helpers only.
func mustShiftJIS(t *testing.T, s string) string {
	t.Helper()
	b, err := encodeShiftJIS(s)
	if err != nil {
		t.Fatalf("encodeShiftJIS(%q) failed: %v", s, err)
	}
	return b
}

func TestDecodeZipName_NonUTF8_ValidShiftJIS(t *testing.T) {
	// Japanese filename "初音ミク.pmx" encoded in Shift-JIS
	sjis := mustShiftJIS(t, "初音ミク.pmx")
	got := decodeZipName(sjis, true)
	if got != "初音ミク.pmx" {
		t.Errorf("decodeZipName(true) = %q, want %q", got, "初音ミク.pmx")
	}
}

func TestDecodeZipName_NonUTF8_LatinText(t *testing.T) {
	// ASCII text is valid Shift-JIS (since SJIS is a superset of ASCII)
	sjis := mustShiftJIS(t, "model.pmx")
	got := decodeZipName(sjis, true)
	if got != "model.pmx" {
		t.Errorf("decodeZipName(true) = %q, want %q", got, "model.pmx")
	}
}

func TestDecodeZipName_NonUTF8_InvalidBytes(t *testing.T) {
	// Invalid Shift-JIS bytes — should not panic, returns whatever decoder produces
	invalid := "\x80\x81\x82"
	got := decodeZipName(invalid, true)
	// Should not contain RuneError
	for _, r := range got {
		if r == utf8.RuneError {
			t.Errorf("decodeZipName(true) returned RuneError for invalid SJIS")
		}
	}
}

func TestDecodeZipName_UTF8Flag_ValidUTF8(t *testing.T) {
	got := decodeZipName("モデル.pmx", false)
	if got != "モデル.pmx" {
		t.Errorf("decodeZipName(false, valid UTF-8) = %q, want %q", got, "モデル.pmx")
	}
}

func TestDecodeZipName_UTF8Flag_PlainASCII(t *testing.T) {
	got := decodeZipName("model.pmx", false)
	if got != "model.pmx" {
		t.Errorf("decodeZipName(false, ASCII) = %q, want %q", got, "model.pmx")
	}
}

func TestDecodeZipName_UTF8Flag_ActuallyShiftJIS(t *testing.T) {
	// Flag says UTF-8=false but content is actually Shift-JIS (common broken zip)
	sjis := mustShiftJIS(t, "ボーン.pmx")
	got := decodeZipName(sjis, false)
	// Should auto-detect as non-UTF8 and fall back to Shift-JIS
	if got != "ボーン.pmx" {
		t.Errorf("decodeZipName(false, SJIS bytes) = %q, want %q", got, "ボーン.pmx")
	}
}

func TestDecodeZipName_ControlCharCleanup(t *testing.T) {
	// Null byte + tab (kept) + newline (kept) + escape (removed)
	input := "\x00hello\x09world\x0Atest\x1Bend"
	got := decodeZipName(input, false)
	want := "hello\tworld\ntestend" // null removed, tab/CR kept, escape removed
	if got != want {
		t.Errorf("decodeZipName = %q, want %q", got, want)
	}
}

func TestDecodeZipName_ControlChars79F(t *testing.T) {
	// U+007F (DEL), U+0080, U+0099 are in the C1 control chars range and should be removed.
	// These are valid UTF-8 codepoints that can appear in decoded strings.
	input := "abc\u007Fdef\u0080\u0099ghi"
	got := decodeZipName(input, false)
	want := "abcdefghi"
	if got != want {
		t.Errorf("decodeZipName = %q, want %q", got, want)
	}
}

func TestDecodeZipName_RuneErrorSkipped(t *testing.T) {
	// After Shift-JIS decoding, RuneError may appear for unmappable bytes.
	// Pass bytes that are valid Shift-JIS but decode to undefined → RuneError.
	// Byte 0x80 is undefined in Shift-JIS, so it becomes RuneError and gets skipped.
	got := decodeZipName("abc\x80def", true)
	if got != "abcdef" {
		t.Errorf("decodeZipName = %q, want %q", got, "abcdef")
	}
}

func TestDecodeZipName_NonUTF8_Chinese(t *testing.T) {
	// Chinese text in Shift-JIS should fail and fall back gracefully
	// "模型" in GBK is not valid Shift-JIS
	got := decodeZipName("模型", true)
	// Should not return empty on error, and should not have RuneError
	if got == "" {
		t.Error("decodeZipName(true, Chinese) returned empty string")
	}
}

func TestDecodeZipName_EmptyString(t *testing.T) {
	if got := decodeZipName("", false); got != "" {
		t.Errorf("decodeZipName(false, empty) = %q, want %q", got, "")
	}
	if got := decodeZipName("", true); got != "" {
		t.Errorf("decodeZipName(true, empty) = %q, want %q", got, "")
	}
}

func TestDecodeZipName_OnlyControlChars(t *testing.T) {
	got := decodeZipName("\x00\x01\x02\x7F\x9F\x1B", false)
	if got != "" {
		t.Errorf("decodeZipName(all control) = %q, want empty", got)
	}
}
