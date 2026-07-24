package util

import (
	"encoding/binary"
	"fmt"
	"os"
	"strings"
	"unicode/utf16"
)

// PMXMeta holds the header metadata extracted from a .pmx file.
type PMXMeta struct {
	NameJp    string // 模型名（本地）
	NameEn    string // 模型名（通用）
	CommentJp string // 说明（本地）
	CommentEn string // 说明（通用）
}

// ParsePMXHeader reads the PMX binary header (first ~1.5KB) and extracts
// the four text segments (local/universal name and comment).
// Returns empty meta (no error) on parse failure so scanning is non-fatal.
func ParsePMXHeader(path string) (*PMXMeta, error) {
	return SafeCall(func() (*PMXMeta, error) {
		return parsePMXHeaderUnsafe(path)
	})
}

func parsePMXHeaderUnsafe(path string) (*PMXMeta, error) {
	const op = "ParsePMXHeader"
	f, err := os.Open(path)
	if err != nil {
		return nil, WrapError(op, fmt.Errorf("open file: %w", err))
	}
	defer f.Close()

	// Read first 8192 bytes — enough for the header area including long comments
	buf := make([]byte, 8192)
	n, err := f.Read(buf)
	if err != nil {
		return nil, WrapError(op, fmt.Errorf("read header: %w", err))
	}
	return parsePMXHeaderBytes(buf[:n]), nil
}

// parsePMXHeaderBytes parses PMX header metadata from raw bytes
// (useful for reading from zip entries without extracting to disk).
func parsePMXHeaderBytes(buf []byte) *PMXMeta {
	if len(buf) < 9 {
		// Too short for even signature + version + globalsCount
		return &PMXMeta{}
	}

	// Check signature "PMX " (0x50 0x4d 0x58 0x20)
	if string(buf[0:4]) != "PMX " {
		return &PMXMeta{}
	}

	offset := 8 // skip signature(4) + version float32(4)

	// globalsCount: 1 byte — number of following flag bytes
	globalsCount := int(buf[offset])
	offset++
	if offset+globalsCount > len(buf) {
		return &PMXMeta{}
	}

	// flags[0] = encoding: 0=UTF-16LE, 1=UTF-8
	encoding := buf[offset]
	offset += globalsCount

	// Read 4 consecutive text segments
	meta := &PMXMeta{}
	texts := []*string{&meta.NameJp, &meta.NameEn, &meta.CommentJp, &meta.CommentEn}

	for _, dst := range texts {
		if offset+4 > len(buf) {
			return meta // partial data is fine
		}
		textLen := int(binary.LittleEndian.Uint32(buf[offset : offset+4]))
		offset += 4
		if textLen < 0 || offset+textLen > len(buf) {
			return meta
		}
		if textLen > 0 {
			raw := buf[offset : offset+textLen]
			if encoding == 0 { // UTF-16LE
				*dst = decodeUTF16LE(raw)
			} else { // UTF-8
				*dst = string(raw)
			}
			// Strip trailing nulls and trim whitespace
			*dst = strings.TrimRight(*dst, "\x00")
			*dst = strings.TrimSpace(*dst)
		}
		offset += textLen
	}

	return meta
}

// decodeUTF16LE decodes a UTF-16 little-endian byte slice to a Go string.
func decodeUTF16LE(b []byte) string {
	if len(b)%2 != 0 {
		return ""
	}
	u16 := make([]uint16, len(b)/2)
	for i := range u16 {
		u16[i] = binary.LittleEndian.Uint16(b[i*2:])
	}
	return decodeUTF16(u16)
}

// decodeUTF16 converts a []uint16 (as stored in UTF-16) to a Go string.
func decodeUTF16(u16 []uint16) string {
	return string(utf16.Decode(u16))
}
