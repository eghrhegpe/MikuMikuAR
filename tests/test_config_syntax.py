#!/usr/bin/env python3
"""契约测试：mmdhub 的 wails.json + go.mod 语法与结构校验。"""
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent  # tests/ → mmdhub/


def check_wails():
    """Wails v3 uses Taskfile.yml instead of wails.json; check that exists."""
    errors = []
    fp = ROOT / "wails.json"
    if fp.exists():
        # Legacy v2 config — validate contents
        try:
            data = json.loads(fp.read_text("utf-8"))
        except json.JSONDecodeError as e:
            errors.append(f"SYNTAX: wails.json 解析失败: {e}")
            return errors
        if not data.get("name"):
            errors.append("'name' must be non-empty")
        if not data.get("outputfilename"):
            errors.append("'outputfilename' must be non-empty")
        if not data.get("frontend:install"):
            errors.append("'frontend:install' must be non-empty")
        if not data.get("frontend:build"):
            errors.append("'frontend:build' must be non-empty")
        return errors

    # Wails v3: require Taskfile.yml instead
    tfp = ROOT / "Taskfile.yml"
    if not tfp.exists():
        errors.append("MISSING: wails.json and Taskfile.yml — neither found")
    return errors


def check_gomod():
    errors = []
    fp = ROOT / "go.mod"
    if not fp.exists():
        errors.append("MISSING: go.mod")
        return errors

    text = fp.read_text("utf-8", errors="replace")
    lines = text.split("\n")

    if not text.startswith("module "):
        errors.append("must start with 'module <name>'")

    go_version = None
    for line in lines:
        m = re.match(r"^go\s+(\S+)", line)
        if m:
            go_version = m.group(1)
            break
    if not go_version:
        errors.append("missing 'go X.Y.Z' version line")
    else:
        parts = go_version.split(".")
        if len(parts) >= 2:
            try:
                if int(parts[0]) < 1 or int(parts[1]) < 20:
                    errors.append(f"go version {go_version} too old, need 1.20+")
            except ValueError:
                errors.append(f"invalid go version '{go_version}'")

    # mmdhub 使用单行 require（非 block 风格）
    require_count = 0
    for line in lines:
        stripped = line.strip()
        if re.match(r"^require\s+\S+", stripped) and not stripped.startswith("require ("):
            require_count += 1
    if require_count == 0:
        # 也可能是 require block
        in_block = False
        for line in lines:
            stripped = line.strip()
            if re.match(r"^require\s*\($", stripped):
                in_block = True
                continue
            if in_block:
                if stripped == ")":
                    break
                if stripped and not stripped.startswith("//"):
                    require_count += 1
    if require_count == 0:
        errors.append("no dependencies found in go.mod")

    return errors


def main():
    errors = []
    errors += [("wails.json", e) for e in check_wails()]
    errors += [("go.mod", e) for e in check_gomod()]

    if errors:
        sys.stdout.buffer.write(f"FAILED: {len(errors)} issue(s)\n\n".encode("utf-8"))
        for src, e in errors:
            sys.stdout.buffer.write(f"  [{src}] {e}\n".encode("utf-8"))
        sys.exit(1)
    else:
        sys.stdout.buffer.write(b"OK: wails.json + go.mod syntax checks passed\n")


if __name__ == "__main__":
    main()
