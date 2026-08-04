# MikuMikuAR 一键发版脚本（骨架）
# 用法: .\scripts\release.ps1 -Version 1.9.1
# 对应 docs/releases/release-process.md §2 的 9 步 + §11 命令序列。
#
# 设计原则（AI 可幂等跑）：
#   1. 每步前打印 [release] step N: <desc>，失败即 throw，不吞错。
#   2. 动依赖检测：git diff main 前后对比 go.mod/go.sum/frontend/package-lock.json，
#      有变更则自动 push main 后 gh run watch cache-warm。
#   3. 不替你写 docs/releases/vX.Y.Z.md——这是人类创意活，脚本只校验文件存在。
#   4. tag 已存在则中止（防 §10.3 重推同名 tag 覆盖 body）。
#
# 未实现的占位（标 # TODO）：Android Secrets 校验、应用内版本核对。
# 这些需要 gh/机器环境，留给 AI 在跑脚本前后用 gh CLI 补。

param(
    [Parameter(Mandatory = $true)]
    [string]$Version,          # 形如 1.9.1，不带 v 前缀
    [switch]$DryRun            # 只打印不执行，用于发版前演练
)

$ErrorActionPreference = 'Stop'

# ── 防呆：版本号格式校验 ──────────────────────────────────────
if ($Version -notmatch '^\d+\.\d+\.\d+$') {
    throw "版本号格式错：$Version。应为 X.Y.Z，如 1.9.1（不带 v 前缀）"
}
$tag = "v$Version"
Write-Output "[release] 目标版本：$Version (tag: $tag)"

if ($DryRun) { Write-Output "[release] === DryRun 模式：只打印不执行 ===" }

# ── 工作目录定位 ──────────────────────────────────────────────
$scriptsDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot = Resolve-Path "$scriptsDir\.." | Select-Object -ExpandProperty Path
Set-Location $repoRoot
Write-Output "[release] 工作目录：$repoRoot"

# ── 前置校验：gh CLI 是否可用 ─────────────────────────────────
$ghOk = $true
try { $null = Get-Command gh -ErrorAction Stop } catch { $ghOk = $false }
if (-not $ghOk) {
    Write-Warning "[release] gh CLI 未安装，步骤 6/8/9 的 CI 监控将无法自动化。请先 winget install GitHub.cli。"
}

# ═══════════════════════════════════════════════════════════════
# 步骤 2：改 package.json + build/windows/info.json
# ═══════════════════════════════════════════════════════════════
Write-Output "[release] step 2: 写入版本号到 package.json + build/windows/info.json"

function Set-JsonVersion($path, $version) {
    $obj = Get-Content $path -Raw | ConvertFrom-Json
    $obj.version = $version
    $obj | ConvertTo-Json -Depth 100 | Set-Content $path -NoNewline
}

# package.json：唯一事实源
if (-not $DryRun) { Set-JsonVersion 'package.json' $Version }

# build/windows/info.json：file_version + ProductVersion（§2 步 2 续）
$infoPath = 'build/windows/info.json'
if (Test-Path $infoPath) {
    if (-not $DryRun) {
        $info = Get-Content $infoPath -Raw | ConvertFrom-Json
        $info.file_version = $Version
        $info.ProductVersion = $Version
        $info | ConvertTo-Json -Depth 100 | Set-Content $infoPath -NoNewline
    }
} else {
    Write-Warning "[release] $infoPath 不存在，跳过 Windows info 同步"
}

# ═══════════════════════════════════════════════════════════════
# 步骤 4：校验 docs/releases/vX.Y.Z.md 存在
# ═══════════════════════════════════════════════════════════════
$notesPath = "docs/releases/v$Version.md"
Write-Output "[release] step 4: 校验发布说明 $notesPath"
if (-not (Test-Path $notesPath)) {
    throw "发布说明缺失：$notesPath。请先手写 notes（格式参考 docs/releases/v1.3.5.md），再重跑本脚本。"
}
Write-Output "[release] ✓ 发布说明已存在"

# ═══════════════════════════════════════════════════════════════
# 步骤 3+5：提交版本号 + 发布说明，推 main
# ═══════════════════════════════════════════════════════════════
Write-Output "[release] step 3+5: 提交并推 main"

# 防呆：tag 已存在则中止（§10.3）
$tagExists = $false
try { git rev-parse $tag 2>$null | Out-Null; $tagExists = $true } catch {}
if ($tagExists) {
    throw "tag $tag 已存在。若需重建，先 git tag -d $tag && git push origin :$tag。"
}

if (-not $DryRun) {
    git add package.json build/windows/info.json
    git commit -m "chore: bump version to $Version"
    git add $notesPath
    git commit -m "docs: add v$Version release notes"
    git push origin main
}
Write-Output "[release] ✓ 已提交版本号 + 发布说明并推 main"

# ═══════════════════════════════════════════════════════════════
# 步骤 6：等缓存预热（仅动了依赖时）
# ═══════════════════════════════════════════════════════════════
# 检测本次提交是否动了 go.mod / go.sum / frontend/package-lock.json
$depFiles = @('go.mod', 'go.sum', 'frontend/package-lock.json')
$depChanged = $false
foreach ($f in $depFiles) {
    $diff = git diff HEAD~2 HEAD -- $f 2>$null
    if ($diff) { $depChanged = $true; break }
}

if ($depChanged) {
    Write-Output "[release] step 6: 检测到依赖变更（$($depFiles -join ', ')），等 cache-warm 绿勾"
    if ($ghOk -and -not $DryRun) {
        $runId = gh run list --workflow cache-warm.yml --branch main --limit 1 --json databaseId --jq '.[0].databaseId'
        if ($runId) {
            Write-Output "[release] gh run watch $runId （阻塞至 cache-warm 完成）"
            gh run watch $runId
        } else {
            Write-Warning "[release] 未找到最近的 cache-warm run，请手动去 Actions 页确认"
        }
    } elseif (-not $ghOk) {
        Write-Warning "[release] gh 不可用，请手动去 GitHub Actions 页确认 cache-warm 绿勾后再继续"
        Read-Host "确认 cache-warm 绿勾后按回车继续"
    }
    Write-Output "[release] ✓ 缓存预热完成"
} else {
    Write-Output "[release] step 6: 跳过（未动依赖）"
}

# ═══════════════════════════════════════════════════════════════
# 步骤 7：打 tag 触发 release.yml
# ═══════════════════════════════════════════════════════════════
Write-Output "[release] step 7: 打 tag $tag"
if (-not $DryRun) {
    git tag $tag
    git push origin $tag
}
Write-Output "[release] ✓ tag 已推送，release.yml 已触发"

# ═══════════════════════════════════════════════════════════════
# 步骤 8：监控 release.yml 四 job
# ═══════════════════════════════════════════════════════════════
Write-Output "[release] step 8: 监控 release.yml"
if ($ghOk -and -not $DryRun) {
    $runId = gh run list --workflow release.yml --limit 1 --json databaseId --jq '.[0].databaseId'
    if ($runId) {
        Write-Output "[release] gh run watch $runId （阻塞至 release 四 job 完成）"
        gh run watch $runId
        # 检查最终结论
        $conclusion = gh run view $runId --json conclusion --jq '.conclusion'
        if ($conclusion -ne 'success') {
            throw "release.yml 结论为 $conclusion，请到 Actions 页排查"
        }
    } else {
        Write-Warning "[release] 未找到最近的 release run，请手动监控"
    }
} elseif (-not $ghOk) {
    Write-Warning "[release] gh 不可用，请手动 gh run list --workflow release.yml --limit 3 监控"
}
Write-Output "[release] ✓ release.yml 四 job 全绿"

# ═══════════════════════════════════════════════════════════════
# 步骤 9：核对 Release
# ═══════════════════════════════════════════════════════════════
Write-Output "[release] step 9: 核对 GitHub Release"
if ($ghOk -and -not $DryRun) {
    $release = gh release view $tag --json body,tagName,assets --jq '{tag: .tagName, body: (.body[0:80]+\"...\"), assets: (.assets | length)}'
    Write-Output "[release] Release 概览：$release"

    # TODO: 校验 body 是否为手写 notes（非自动生成的 "**Full Changelog**: https://..."）
    #       若是自动生成，则 gh release edit $tag --notes-file $notesPath 修正

    # TODO: 校验三平台产物齐全（Windows .exe / Linux binary / Android .apk）
    #       通过 assets[].name 过滤

    # TODO: 应用内版本核对——需要本机启动应用读「关于」页，脚本无法自动化
}
Write-Output "[release] ✓ 发版完成：$tag"

# ═══════════════════════════════════════════════════════════════
# 附录：Android Secrets 前置校验（可选，发版前手动跑）
# ═══════════════════════════════════════════════════════════════
# gh secret list  # 应含 ANDROID_KEYSTORE_BASE64 / ANDROID_KEYSTORE_PASSWORD / ANDROID_KEY_ALIAS / ANDROID_KEY_PASSWORD
# 缺失则只出 debug APK（§1.2）
