package util

import (
	"encoding/binary"
	"math"
	"os"
	"testing"
)

func writeTestPMX(t *testing.T, path string, encoding byte, texts []string) {
	t.Helper()
	f, err := os.Create(path)
	if err != nil {
		t.Fatal(err)
	}
	defer f.Close()

	buf := make([]byte, 0, 512)
	buf = append(buf, []byte("PMX ")...)
	var version [4]byte
	binary.LittleEndian.PutUint32(version[:], math.Float32bits(2.0))
	buf = append(buf, version[:]...)
	buf = append(buf, 1)
	buf = append(buf, encoding)

	for _, s := range texts {
		var raw []byte
		if encoding == 0 {
			for _, r := range s {
				u16 := make([]byte, 2)
				binary.LittleEndian.PutUint16(u16, uint16(r))
				raw = append(raw, u16...)
			}
		} else {
			raw = []byte(s)
		}
		lenBytes := make([]byte, 4)
		binary.LittleEndian.PutUint32(lenBytes, uint32(len(raw)))
		buf = append(buf, lenBytes...)
		buf = append(buf, raw...)
	}

	if _, err := f.Write(buf); err != nil {
		t.Fatal(err)
	}
}

func TestParsePMXHeader_UTF16LE(t *testing.T) {
	f, err := os.CreateTemp("", "test_pmx_*.pmx")
	if err != nil {
		t.Fatal(err)
	}
	path := f.Name()
	f.Close()
	defer os.Remove(path)

	texts := []string{"初音ミク", "Hatsune Miku", "説明コメント", "English comment"}
	writeTestPMX(t, path, 0, texts)

	meta, err := ParsePMXHeader(path)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if meta.NameJp != "初音ミク" {
		t.Errorf("NameJp = %q, want %q", meta.NameJp, "初音ミク")
	}
	if meta.NameEn != "Hatsune Miku" {
		t.Errorf("NameEn = %q, want %q", meta.NameEn, "Hatsune Miku")
	}
	if meta.CommentJp != "説明コメント" {
		t.Errorf("CommentJp = %q, want %q", meta.CommentJp, "説明コメント")
	}
	if meta.CommentEn != "English comment" {
		t.Errorf("CommentEn = %q, want %q", meta.CommentEn, "English comment")
	}
}

func TestParsePMXHeader_UTF8(t *testing.T) {
	f, err := os.CreateTemp("", "test_pmx_utf8_*.pmx")
	if err != nil {
		t.Fatal(err)
	}
	path := f.Name()
	f.Close()
	defer os.Remove(path)

	texts := []string{"ミク", "Miku", "説明", "Comment"}
	writeTestPMX(t, path, 1, texts)

	meta, err := ParsePMXHeader(path)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if meta.NameJp != "ミク" {
		t.Errorf("NameJp = %q, want %q", meta.NameJp, "ミク")
	}
	if meta.NameEn != "Miku" {
		t.Errorf("NameEn = %q, want %q", meta.NameEn, "Miku")
	}
}

func TestParsePMXHeader_InvalidSignature(t *testing.T) {
	f, err := os.CreateTemp("", "bad_pmx_*.pmx")
	if err != nil {
		t.Fatal(err)
	}
	path := f.Name()
	f.Close()
	defer os.Remove(path)

	if err := os.WriteFile(path, []byte("XXXX this is not pmx"), 0644); err != nil {
		t.Fatal(err)
	}

	meta, err := ParsePMXHeader(path)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if meta.NameJp != "" || meta.NameEn != "" {
		t.Errorf("expected empty meta for invalid signature, got NameJp=%q NameEn=%q", meta.NameJp, meta.NameEn)
	}
}

func TestParsePMXHeader_EmptyFile(t *testing.T) {
	f, err := os.CreateTemp("", "empty_pmx_*.pmx")
	if err != nil {
		t.Fatal(err)
	}
	path := f.Name()
	f.Close()
	defer os.Remove(path)

	if _, err := ParsePMXHeader(path); err == nil {
		t.Error("expected error for empty file")
	}
}

func TestParsePMXHeader_FileNotFound(t *testing.T) {
	_, err := ParsePMXHeader("/nonexistent/path.pmx")
	if err == nil {
		t.Error("expected error for nonexistent file")
	}
}

func TestDecodeUTF16(t *testing.T) {
	tests := []struct {
		input []uint16
		want  string
	}{
		{[]uint16{}, ""},
		{[]uint16{0x0048, 0x0069}, "Hi"},
		{[]uint16{0x3053, 0x3093, 0x306B, 0x3061, 0x306F}, "こんにちは"},
		{[]uint16{0xD83D, 0xDE00}, "😀"},
		{[]uint16{0xD800}, "\uFFFD"},
	}

	for _, tt := range tests {
		got := decodeUTF16(tt.input)
		if got != tt.want {
			t.Errorf("decodeUTF16(%v) = %q, want %q", tt.input, got, tt.want)
		}
	}
}

func TestParsePMXHeader_TrimsNullsAndSpaces(t *testing.T) {
	f, err := os.CreateTemp("", "trim_pmx_*.pmx")
	if err != nil {
		t.Fatal(err)
	}
	path := f.Name()
	f.Close()
	defer os.Remove(path)

	texts := []string{"  Miku  \x00\x00", "  Hatsune  \x00", "  comment  \x00", "  desc  "}
	writeTestPMX(t, path, 1, texts)

	meta, err := ParsePMXHeader(path)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if meta.NameJp != "Miku" {
		t.Errorf("NameJp = %q, want %q", meta.NameJp, "Miku")
	}
	if meta.NameEn != "Hatsune" {
		t.Errorf("NameEn = %q, want %q", meta.NameEn, "Hatsune")
	}
}
