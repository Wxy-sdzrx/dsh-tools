<#
  便捷插件 · 自动更新器
  ==================================================================
  由插件在「检查更新」发现新版本时拉起；也可以自己手动双击运行。

  做四件事：
    ① 从 dsh-config.js 读更新地址
    ② 取版本清单，和本目录 main.js 里的 DSH_VERSION 比
    ③ 有新版就把清单 files 列的运行文件全部下载到内存
    ④ 四个文件都拿到之后，才覆盖本目录 —— 【不边下边写】

  设计要点：
    · 失败【静默退出】（加 -Show 才打印），绝不弹窗打扰。
    · 任何一个文件下载失败 → 整个中止，一个字节都不写，旧版照常用。
    · 只覆盖运行文件，不碰 dsh-config.js（每台机器的更新地址可能不同）。
    · 完全绕开 WPS —— 它是个独立进程，不受 WPS 沙箱限制。
#>
param([switch]$Show)

$ErrorActionPreference = 'Continue'
try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch {}
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$Here = $PSScriptRoot
function Say($m) { if ($Show) { Write-Host ('[updater] ' + $m) } }

# 网络必须重试。实测：在装了零信任客户端的机器上，github.io 会【偶发】
# 报「基础连接已经关闭: 发送时发生错误」，连打 12 次里 0 次失败，
# 但一天里总会碰上几次。一次抖动就放弃 = 自动更新等于没做。
# 写一个给插件读的结果文件。
# 为什么需要它：插件【读不了文件】—— WPS 的 FileSystem 只认裸文件名、
# 写到浏览器缓存目录；fetch 也读不了 file://。
# 唯一的回传通道就是【同目录下再注入一个 <script src>】。
# 所以更新器把结果写成 update-status.js，插件注入它就能知道成没成。
function Write-Status($ok, $from, $to, $msg) {
    try {
        $o = 'var DSH_UPDATE_RESULT = {"ok":' + $(if ($ok) { 'true' } else { 'false' }) +
             ',"from":"' + $from + '","to":"' + $to + '","ts":' + ([long](Get-Date -UFormat %s) * 1000) +
             ',"msg":"' + ($msg -replace '"', '') + '"};' + "`n"
        [System.IO.File]::WriteAllText((Join-Path $Here 'update-status.js'), $o, (New-Object System.Text.UTF8Encoding($false)))
    } catch { }
}
function Get-Text($url) {
    for ($k = 1; $k -le 4; $k++) {
        try { return (Invoke-WebRequest -Uri $url -TimeoutSec 25 -UseBasicParsing -ErrorAction Stop).Content }
        catch { Say ('  取清单第 ' + $k + ' 次失败: ' + $_.Exception.Message); if ($k -lt 4) { Start-Sleep -Milliseconds (500 * $k) } }
    }
    return $null
}
function Get-File($url, $dst) {
    for ($k = 1; $k -le 4; $k++) {
        try { Invoke-WebRequest -Uri $url -OutFile $dst -TimeoutSec 30 -UseBasicParsing -ErrorAction Stop; return $true }
        catch { Say ('  ' + (Split-Path $dst -Leaf) + ' 第 ' + $k + ' 次下载失败: ' + $_.Exception.Message); if ($k -lt 4) { Start-Sleep -Milliseconds (500 * $k) } }
    }
    return $false
}

# ---------- ① 更新地址：优先 dsh-config.js，退回 update-url.txt ----------
$manifestUrl = ''
$cfg = Join-Path $Here 'dsh-config.js'
if (Test-Path $cfg) {
    $manifestUrl = ([regex]::Match([System.IO.File]::ReadAllText($cfg, [System.Text.Encoding]::UTF8),
                    "DSH_UPDATE_URL\s*=\s*'([^']*)'")).Groups[1].Value
}
if (-not $manifestUrl) {
    $uf = Join-Path $Here 'update-url.txt'
    if (Test-Path $uf) {
        foreach ($ln in @(Get-Content $uf -Encoding UTF8)) {
            $s = $ln.Trim()
            if ($s -and $s -notmatch '^#') { $manifestUrl = $s; break }
        }
    }
}
if (-not $manifestUrl) { Say '没有配置更新地址，退出'; exit 0 }
Say ('更新地址 ' + $manifestUrl)

# ---------- ② 本地版本 ----------
$mainJs = Join-Path $Here 'main.js'
if (-not (Test-Path $mainJs)) { Say '本目录没有 main.js，退出'; exit 0 }
$localVer = ([regex]::Match([System.IO.File]::ReadAllText($mainJs, [System.Text.Encoding]::UTF8),
             "DSH_VERSION\s*=\s*'([^']+)'")).Groups[1].Value
if (-not $localVer) { Say '读不到本地版本号，退出'; exit 0 }

# ---------- ③ 取清单 ----------
$sep = if ($manifestUrl.Contains('?')) { '&' } else { '?' }
$txt = Get-Text ($manifestUrl + $sep + '_t=' + (Get-Random))
if (-not $txt) { Say '取清单失败（已重试 4 次），退出'; exit 0 }

$remoteVer = ([regex]::Match($txt, "version:\s*'([^']+)'")).Groups[1].Value
$base      = ([regex]::Match($txt, "base:\s*'([^']*)'")).Groups[1].Value
$filesM    = [regex]::Match($txt, "files:\s*\[([^\]]*)\]")
if (-not $remoteVer -or -not $base) { Say '清单字段不全（缺 version 或 base），退出'; exit 0 }
if (-not $base.EndsWith('/')) { $base += '/' }

$files = @()
if ($filesM.Success) {
    $files = @($filesM.Groups[1].Value -split ',' |
               ForEach-Object { $_.Trim().Trim("'").Trim('"') } |
               Where-Object { $_ })
}
if ($files.Count -eq 0) { $files = @('index.html', 'main.js', 'ribbon.xml', 'dialog_sum.html') }

function CmpVer([string]$a, [string]$b) {
    $pa = $a.Split('.'); $pb = $b.Split('.')
    for ($i = 0; $i -lt 3; $i++) {
        $x = 0; $y = 0
        if ($i -lt $pa.Count) { [void][int]::TryParse($pa[$i], [ref]$x) }
        if ($i -lt $pb.Count) { [void][int]::TryParse($pb[$i], [ref]$y) }
        if ($x -ne $y) { if ($x -gt $y) { return 1 } else { return -1 } }
    }
    return 0
}

Say ('本地 ' + $localVer + '  远程 ' + $remoteVer)
if ((CmpVer $remoteVer $localVer) -le 0) {
    Write-Status $true $localVer $remoteVer '无需更新（已是最新）'
    Say '已是最新，无事可做'
    exit 0
}

# ---------- ④ 全部下载到【临时目录】 ----------
# 为什么落临时目录、而不是读进内存再按字符串写：
#   GitHub Pages 不认识 .ps1，会用 application/octet-stream 返回。
#   这时 Invoke-WebRequest 的 .Content 是【字节数组】而不是字符串，
#   按字符串写出去会把文件写坏（实测：.Content.Trim() 直接报
#   「[System.Byte] 不包含名为 Trim 的方法」）。
#   先落盘、再 Copy-Item 是【字节级】的，任何类型都不会出错。
$tmpDir = Join-Path ([System.IO.Path]::GetTempPath()) ('dsh_upd_' + (Get-Random))
New-Item -ItemType Directory -Force -Path $tmpDir | Out-Null
function Cleanup { Remove-Item $tmpDir -Recurse -Force -ErrorAction SilentlyContinue }

foreach ($f in $files) {
    $u = $base + $f + '?_t=' + (Get-Random)
    $dst = Join-Path $tmpDir $f
    if (-not (Get-File $u $dst)) {
        Say ($f + ' 下载失败（已重试 4 次），中止 —— 一个文件都没写')
        Cleanup; exit 0
    }
    $sz = (Get-Item $dst).Length
    if ($sz -lt 20) { Say ($f + ' 内容异常（' + $sz + ' 字节），中止'); Cleanup; exit 0 }
    Say ($f + ' 已下载 ' + $sz + ' 字节')
}

# ---------- ⑤ 全部拿到了，才逐个覆盖 ----------
foreach ($f in $files) {
    $src    = Join-Path $tmpDir $f
    $target = Join-Path $Here $f
    try {
        Copy-Item $src $target -Force
        Say ($f + ' 已覆盖')
    } catch {
        # updater.ps1 可能被自己锁住 —— 那不算失败：其余文件都已更新成功。
        if ($f -eq 'updater.ps1') { Say 'updater.ps1 自身被占用，跳过（不影响本次更新）'; continue }
        Say ($f + ' 写入失败: ' + $_.Exception.Message)
        Cleanup; exit 1
    }
}
Cleanup
Write-Status $true $localVer $remoteVer '更新完成'
Say ('更新完成 ' + $localVer + ' -> ' + $remoteVer)
exit 0
