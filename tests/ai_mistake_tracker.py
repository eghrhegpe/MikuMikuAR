#!/usr/bin/env python3
"""AI Mistake Tracker — 分析 git 历史中的修复模式，识别 AI 高频犯错区域。

用法：
    python tests/ai_mistake_tracker.py              # 默认最近 200 条 commit
    python tests/ai_mistake_tracker.py --limit 500  # 扩大范围
    python tests/ai_mistake_tracker.py --json        # JSON 输出（CI 集成用）
"""

import subprocess
import re
import sys
import json
from collections import Counter, defaultdict
from pathlib import Path

# ── 配置 ──────────────────────────────────────────────

# fix 提交的分类规则（按优先级匹配）
CATEGORIES = [
    ("env",         r"\(env\)"),
    ("ci/build",    r"\(ci\)|\(build\)|\(release\)|vitest"),
    ("library",     r"\(library\)|\(scan\)"),
    ("motion",      r"\(lipsync\)|\(procedural-motion\)|\(vmd\)"),
    ("render",      r"\(render\)|\(scene-material\)"),
    ("ui",          r"\(ui\)|\(css\)"),
    ("android",     r"android"),
    ("test",        r"测试|test"),
    ("go-backend",  r"go\s|后端|binding"),
]

# 规则违反检测关键词
RULE_VIOLATIONS = {
    "read_research":    r"read.*docs/research|读取.*research",
    "recursive_scan":   r"ls\s+docs/|find\s+docs/|glob.*docs/\*\*",
    "full_read_large":  r"read.*\.ts.*limit\s*=\s*\d{4,}",  # 读大文件没加 limit
}

# ── Git 操作 ──────────────────────────────────────────

def _run(cmd: list[str]) -> str:
    """运行命令，处理 Windows 编码问题。"""
    result = subprocess.run(
        cmd, capture_output=True, cwd=REPO_ROOT,
        env={**subprocess.os.environ, "GIT_TERMINAL_PROMPT": "0", "LC_ALL": "en_US.UTF-8"},
    )
    return result.stdout.decode("utf-8", errors="replace").strip()


def git_log(limit: int = 200) -> list[dict]:
    """获取 git log。"""
    output = _run(["git", "log", f"--max-count={limit}", "--format=%H|%s|%ai"])
    commits = []
    for line in output.split("\n"):
        if not line or "|" not in line:
            continue
        parts = line.split("|", 2)
        if len(parts) == 3:
            commits.append({
                "hash": parts[0][:8],
                "message": parts[1].strip(),
                "date": parts[2].strip(),
            })
    return commits


def git_files_changed(commit_hash: str) -> list[str]:
    """获取某个 commit 修改的文件列表。"""
    output = _run(["git", "diff-tree", "--no-commit-id", "-r", "--name-only", commit_hash])
    return [f.strip() for f in output.split("\n") if f.strip()]


def git_diff_stat(commit_hash: str) -> str:
    """获取 commit 的 diff stat。"""
    return _run(["git", "diff-tree", "--no-commit-id", "--stat", commit_hash])

# ── 分析逻辑 ──────────────────────────────────────────

def categorize_commit(message: str) -> str:
    """将 commit message 分类。"""
    for cat, pattern in CATEGORIES:
        if re.search(pattern, message, re.IGNORECASE):
            return cat
    return "other"


def find_fix_chains(commits: list[dict], min_chain: int = 3) -> list[dict]:
    """检测连续修复链（同一子系统的连续 fix 提交）。"""
    chains = []
    current_chain = []

    for c in commits:
        if not re.match(r"^\s*fix", c["message"], re.IGNORECASE):
            if len(current_chain) >= min_chain:
                chains.append({
                    "category": current_chain[0]["category"],
                    "length": len(current_chain),
                    "commits": current_chain,
                    "files": list(set(
                        f for c in current_chain for f in c.get("files", [])
                    )),
                })
            current_chain = []
            continue

        cat = categorize_commit(c["message"])
        if current_chain and current_chain[0]["category"] == cat:
            current_chain.append({"category": cat, **c})
        else:
            if len(current_chain) >= min_chain:
                chains.append({
                    "category": current_chain[0]["category"],
                    "length": len(current_chain),
                    "commits": current_chain,
                    "files": list(set(
                        f for c in current_chain for f in c.get("files", [])
                    )),
                })
            current_chain = [{"category": cat, **c}]

    # 处理尾部
    if len(current_chain) >= min_chain:
        chains.append({
            "category": current_chain[0]["category"],
            "length": len(current_chain),
            "commits": current_chain,
            "files": list(set(
                f for c in current_chain for f in c.get("files", [])
            )),
        })

    return sorted(chains, key=lambda x: x["length"], reverse=True)


def file_hotspots(commits: list[dict], top_n: int = 15) -> list[tuple]:
    """统计文件修改频率（仅 fix 提交）。"""
    fix_commits = [c for c in commits if re.match(r"^\s*fix", c["message"], re.IGNORECASE)]
    file_counter = Counter()
    for c in fix_commits:
        for f in c.get("files", []):
            # 只统计 frontend/src/ 和 internal/ 下的代码文件
            if f.startswith(("frontend/src/", "internal/")):
                file_counter[f] += 1
    return file_counter.most_common(top_n)


def category_stats(commits: list[dict]) -> dict:
    """按类别统计 fix 提交数。"""
    fix_commits = [c for c in commits if re.match(r"^\s*fix", c["message"], re.IGNORECASE)]
    stats = Counter()
    for c in fix_commits:
        stats[categorize_commit(c["message"])] += 1
    return dict(stats.most_common())


def rule_violation_scan(limit: int = 50) -> list[dict]:
    """扫描最近 commit message 中的规则违反信号。"""
    commits = git_log(limit)
    violations = []
    for c in commits:
        for rule_name, pattern in RULE_VIOLATIONS.items():
            if re.search(pattern, c["message"], re.IGNORECASE):
                violations.append({
                    "rule": rule_name,
                    "commit": c["hash"],
                    "message": c["message"],
                })
    return violations

# ── 输出 ──────────────────────────────────────────────

def format_report(commits: list[dict], chains: list[dict], hotspots: list,
                   cat_stats: dict, violations: list) -> str:
    """格式化报告。"""
    lines = []
    lines.append("=" * 60)
    lines.append("  AI Mistake Tracker Report")
    lines.append("=" * 60)
    lines.append("")

    # 概览
    fix_count = sum(1 for c in commits if re.match(r"^\s*fix", c["message"], re.IGNORECASE))
    lines.append(f"总 commit 数: {len(commits)}")
    lines.append(f"fix 提交数:   {fix_count} ({fix_count*100//max(len(commits),1)}%)")
    lines.append("")

    # 按类别统计
    lines.append("── Fix 提交分类 ──")
    for cat, count in cat_stats.items():
        bar = "█" * min(count, 30)
        lines.append(f"  {cat:12s} {count:3d}  {bar}")
    lines.append("")

    # 连续修复链
    if chains:
        lines.append("── 连续修复链（AI 反复犯错热点）──")
        for chain in chains[:5]:
            lines.append(f"  [{chain['category']}] {chain['length']} 次连续修复")
            lines.append(f"    文件: {', '.join(chain['files'][:3])}")
            for c in chain["commits"][:3]:
                lines.append(f"      {c['hash']} {c['message'][:60]}")
            if chain["length"] > 3:
                lines.append(f"      ... 还有 {chain['length']-3} 条")
            lines.append("")
    else:
        lines.append("── 连续修复链：无 ──")
        lines.append("")

    # 文件热力图
    if hotspots:
        lines.append("── 文件热力图（fix 提交修改次数 Top 15）──")
        max_count = hotspots[0][1] if hotspots else 1
        for f, count in hotspots:
            bar_len = int(count / max_count * 20)
            bar = "▓" * bar_len
            lines.append(f"  {count:3d}  {bar}  {f}")
        lines.append("")

    # 规则违反
    if violations:
        lines.append("── 疑似规则违反 ──")
        for v in violations:
            lines.append(f"  [{v['rule']}] {v['commit']} {v['message'][:50]}")
        lines.append("")
    else:
        lines.append("── 规则违反扫描：无 ──")
        lines.append("")

    lines.append("=" * 60)
    return "\n".join(lines)

# ── 主入口 ──────────────────────────────────────────

REPO_ROOT = Path(__file__).resolve().parent.parent

def main():
    import argparse
    parser = argparse.ArgumentParser(description="AI Mistake Tracker")
    parser.add_argument("--limit", type=int, default=200, help="分析最近 N 条 commit")
    parser.add_argument("--json", action="store_true", help="JSON 输出")
    args = parser.parse_args()

    # 获取 commits 并附加文件信息
    commits = git_log(args.limit)
    for c in commits:
        c["files"] = git_files_changed(c["hash"])

    # 分析
    chains = find_fix_chains(commits)
    hotspots = file_hotspots(commits)
    cat_stats = category_stats(commits)
    violations = rule_violation_scan(args.limit)

    if args.json:
        output = {
            "total_commits": len(commits),
            "fix_commits": sum(1 for c in commits if re.match(r"^\s*fix", c["message"], re.IGNORECASE)),
            "category_stats": cat_stats,
            "fix_chains": [
                {
                    "category": ch["category"],
                    "length": ch["length"],
                    "files": ch["files"],
                    "commits": [{"hash": c["hash"], "message": c["message"]} for c in ch["commits"]],
                }
                for ch in chains
            ],
            "file_hotspots": [{"file": f, "count": n} for f, n in hotspots],
            "rule_violations": violations,
        }
        print(json.dumps(output, ensure_ascii=False, indent=2))
    else:
        print(format_report(commits, chains, hotspots, cat_stats, violations))


if __name__ == "__main__":
    main()
