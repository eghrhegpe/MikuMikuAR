#!/usr/bin/env python3
"""契约测试：文档内部 Markdown 链接有效性校验。

策略：
1. 先分割代码块（``` / ~~~）和行内代码（`...`），只检查文档正文中的链接。
2. 匹配标准内联链接 `[text](url)`、引用式 `[text][ref]` + `[ref]: url`。
3. 仅对看起来像路径的 `<url>` 自动链接做校验（有扩展名/路径分隔符特征）。
4. 外部 URL（http://、https://、mailto:、ftp://）自动跳过。

用法：
  python tests/test_markdown_links.py

退出码：
  0 = 全部有效
  1 = 存在断裂链接
"""
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DOCS = ROOT / "docs"

SKIP_PREFIXES = ("http://", "https://", "ftp://", "mailto:", "tel:", "file://")

_exists_cache: dict[Path, bool] = {}

def _exists(path: Path) -> bool:
    p = path.resolve()
    if p not in _exists_cache:
        _exists_cache[p] = p.exists()
    return _exists_cache[p]


def strip_code(text: str) -> str:
    """用占位符替换代码块和行内代码，防止误匹配。"""
    placeholders: list[str] = []
    def _ph(m):
        placeholders.append(m.group(0))
        return f"\x00CODE{len(placeholders)-1}\x00"
    text = re.sub(r'`[^`]+`', _ph, text)
    text = re.sub(r'(?s)```.*?```', _ph, text)
    text = re.sub(r'(?s)~~~.*?~~~', _ph, text)
    return text


def looks_like_path(s: str) -> bool:
    """粗判是否像是文件路径（避免 HTML 标签/纯数字误匹配）。

    <word> 必须是：
    - 包含路径分隔符（/ \）
    - 或包含 dot（扩展名），且 dot 后有字母
    - 或包含 ~（home 路径）
    - 纯单词（如 <pkg>、<token>）不算路径。
    """
    s = s.strip()
    if not s or len(s) < 2:
        return False
    if ' ' in s:
        return False
    # 必须包含 /, \, ., ~ 三者之一
    if '/' in s or '\\' in s or '~' in s:
        return True
    # dot + 扩展名：至少 `<something.ext>`
    if '.' in s:
        # 排除纯数字或纯单词后缀（如 `<v2.>` 不匹配）
        parts = s.rsplit('.', 1)
        if len(parts) == 2 and parts[1] and re.match(r'^[a-zA-Z][\w]*$', parts[1]):
            return True
    return False


def extract_links(text: str) -> list[tuple[str, str, str]]:
    """从已剥离代码区域的文本中提取链接。

    返回 [(上下文片段, 标签, url)]。
    """
    links: list[tuple[str, str, str]] = []

    # 1. 内联链接 [text](url)
    for m in re.finditer(r'(?<!\\)\[([^\]]*)\]\(([^)]+)\)', text):
        url = m.group(2).strip()
        if url:
            links.append((m.group(0)[:60], m.group(1), url))

    # 2. 引用式 [text][ref]
    for m in re.finditer(r'(?<!\\)\[([^\]]*)\]\[([^\]]*)\]', text):
        links.append((m.group(0)[:60], f"ref:{m.group(2)}", ""))

    # 3. 引用定义 [ref]: url
    for m in re.finditer(r'^\[([^\]]+)\]:\s*(\S+)', text, re.MULTILINE):
        links.append((m.group(0)[:60], f"ref:{m.group(1)}", m.group(2)))

    # 4. 自动链接 <url>（仅像路径的）
    for m in re.finditer(r'<([^>]+)>', text):
        url = m.group(1).strip()
        if url and not url.startswith(SKIP_PREFIXES) and looks_like_path(url):
            links.append((m.group(0)[:60], "", url))

    return links


def collect_md_files() -> list[Path]:
    """收集需要检查的 .md 文件。跳过第三方镜像和归档。"""
    files: list[Path] = []
    for p in [ROOT / "AGENTS.md", ROOT / "frontend" / "AGENTS.md"]:
        if p.exists():
            files.append(p)
    for p in sorted(DOCS.rglob("*.md")):
        if "dancexr-zh" in p.parts:
            continue
        if "changelog" in p.parts and "archive" in p.parts:
            continue
        files.append(p)
    return files


def resolve_target(link_url: str, source_file: Path) -> Path | None:
    """尝试解析链接目标到实际文件/目录。返回真实路径或 None。"""
    path_part = link_url.split("#")[0].strip()
    if not path_part:
        return None
    for base in (source_file.parent, ROOT, DOCS):
        candidate = (base / path_part).resolve()
        if _exists(candidate):
            return candidate
    return None


def main():
    md_files = collect_md_files()

    # 预读
    contents: list[tuple[Path, str]] = []
    read_err = 0
    for fp in md_files:
        try:
            contents.append((fp, fp.read_text("utf-8", errors="replace")))
        except Exception as e:
            print(f"[ERROR] {fp}: {e}", file=sys.stderr)
            read_err += 1

    total = 0
    skip_ext = 0
    skip_ref = 0
    skip_anchor = 0
    broken: list[str] = []

    for fp, raw in contents:
        cleaned = strip_code(raw)
        links = extract_links(cleaned)

        for snippet, label, url in links:
            total += 1

            if label.startswith("ref:"):
                skip_ref += 1
                continue

            if url.startswith(SKIP_PREFIXES):
                skip_ext += 1
                continue

            path_part = url.split("#")[0].strip()
            if not path_part:
                skip_anchor += 1
                continue

            if resolve_target(url, fp) is None:
                ctx = snippet.replace("\n", "\\n")
                broken.append(
                    f"[{fp}] target not found: '{url}' "
                    f"(label: '{label[:40]}') "
                )

    out = sys.stdout.buffer
    out.write(b"=== Markdown Link Validation ===\n")
    out.write(
        f"Files: {len(md_files)}  Links: {total}  "
        f"(ext: {skip_ext}, ref: {skip_ref}, anchor: {skip_anchor})\n"
        .encode("utf-8")
    )

    if broken:
        out.write(f"\nFAILED: {len(broken)} broken link(s):\n\n".encode("utf-8"))
        for b in broken:
            out.write(f"  {b}\n".encode("utf-8"))
        sys.exit(1)
    else:
        out.write(b"OK: All internal links are valid.\n")
        if read_err:
            sys.exit(1)


if __name__ == "__main__":
    main()
