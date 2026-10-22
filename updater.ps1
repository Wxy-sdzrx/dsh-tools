<#
  便捷插件 · 自动更新器
  ==================================================================
  两个入口：
    · 插件里点「检查更新」→ 用户选【是】→ 由插件拉起（wps.OAAssist.ShellExecute）
    · 登录时由 HKCU\Run 拉起（-Daily，每天最多查一次）—— 兜底通道

  做五件事：
    ⓪ 读更新地址（dsh-config.js，每台机器各自一份）
    ① 读本目录 main.js 的 DSH_VERSION 当本地版本
    ② 取线上清单，数字段比版本
    ③ 把清单 files 列的每个文件下载到【临时目录】
    ④ 全部拿到后，逐个字节级覆盖，并【一路写进度】

  设计要点（每条都是实测踩出来的）：
    · 先全下载、再落盘。任何一个文件没拿到就整个中止，绝不留下半新半旧的安装目录。
    · 落临时目录 + Copy-Item，不做字符串读写 —— GitHub Pages 对 .ps1 返回
      application/octet-stream，此时 Invoke-WebRequest 的 .Content 是【字节数组】，
      按字符串写会把文件写坏。
    · 网络请求一律 4 次重试 —— 实测零信任环境下 github.io 会偶发
      「基础连接已经关闭」，一次抖动就放弃等于没做自动更新。
    · 进度写进 update-status.js，供插件对话框轮询显示进度条。
      插件读不了文件（FileSystem 只认裸文件名、fetch 读不了 file://），
      【同目录注入 script 标签】是唯一的回传通道。
    · 失败静默（加 -Show 才打印），绝不弹窗打扰。
#>
param([switch]$Show, [switch]$Daily)

$ErrorActionPreference = 'Continue'
try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch {}
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$Here = $PSScriptRoot
function Say($m) { if ($Show) { Write-Host ('[updater] ' + $m) } }

# ---------- 给插件读的进度/结果文件 ----------
function Write-Status {
    param(
        [string]$State = 'idle', [bool]$Ok = $false,
        [string]$From = '', [string]$To = '',
        [int]$Done = 0, [int]$Total = 0, [string]$File = '', [string]$Msg = ''
    )
    try {
        $safe = ($Msg -replace '"', '') -replace "[`r`n]", ' '
        $o = 'var DSH_UPDATE_RESULT = {"state":"' + $State + '"' +
             ',"ok":' + $(if ($Ok) { 'true' } else { 'false' }) +
             ',"from":"' + $From + '"' +
             ',"to":"' + $To + '"' +
             ',"done":' + $Done +
             ',"total":' + $Total +
             ',"file":"' + $File + '"' +
             ',"msg":"' + $safe + '"' +
             ',"ts":' + ([long](Get-Date -UFormat %s) * 1000) + '};' + "`n"
        [System.IO.File]::WriteAllText((Join-Path $Here 'update-status.js'), $o,
            (New-Object System.Text.UTF8Encoding($false)))
    } catch { }
}

# ---------- 网络：必须重试 ----------
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

# ---------- 0 开机自启模式：每天最多查一次 ----------
if ($Daily) {
    $stamp = Join-Path $Here 'last-check.txt'
    if (Test-Path $stamp) {
        try {
            if (((Get-Date) - (Get-Item $stamp).LastWriteTime).TotalHours -lt 20) {
                Say '今天已查过，跳过'
                exit 0
            }
        } catch { }
    }
    try { [System.IO.File]::WriteAllText($stamp, (Get-Date).ToString('s')) } catch { }
}

# ---------- 1 更新地址 ----------
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

# ---------- 2 本地版本 ----------
$mainJs = Join-Path $Here 'main.js'
if (-not (Test-Path $mainJs)) { Say '本目录没有 main.js，退出'; exit 0 }
$localVer = ([regex]::Match([System.IO.File]::ReadAllText($mainJs, [System.Text.Encoding]::UTF8),
             "DSH_VERSION\s*=\s*'([^']+)'")).Groups[1].Value
if (-not $localVer) { Say '读不到本地版本号，退出'; exit 0 }

# ---------- 3 取清单 ----------
$sep = if ($manifestUrl.Contains('?')) { '&' } else { '?' }
$txt = Get-Text ($manifestUrl + $sep + '_t=' + (Get-Random))
if (-not $txt) {
    Write-Status -State 'error' -From $localVer -Msg '连不上版本清单（已重试 4 次）'
    Say '取清单失败（已重试 4 次），退出'; exit 0
}

$remoteVer = ([regex]::Match($txt, "version:\s*'([^']+)'")).Groups[1].Value
$base      = ([regex]::Match($txt, "base:\s*'([^']*)'")).Groups[1].Value
$filesM    = [regex]::Match($txt, "files:\s*\[([^\]]*)\]")
if (-not $remoteVer -or -not $base) {
    Write-Status -State 'error' -From $localVer -Msg '版本清单字段不全'
    Say '清单字段不全（缺 version 或 base），退出'; exit 0
}
if (-not $base.EndsWith('/')) { $base += '/' }
# base 也来自远程清单 —— 校验它与清单同一主机，否则清单能把文件指到别处去
try {
    $baseHost = ([regex]::Match($base, '^(https?://)([^/]+)')).Groups[2].Value
    $manHost  = ([regex]::Match($manifestUrl, '^(https?://)([^/]+)')).Groups[2].Value
    if ($baseHost -and $manHost -and $baseHost -ne $manHost) {
        Write-Status -State 'error' -From $localVer -Msg '清单里的下载地址与清单不同主机，拒绝更新'
        Say ('清单里的 base 主机与清单主机不同（' + $baseHost + ' vs ' + $manHost + '），拒绝更新')
        exit 0
    }
} catch { }

$files = @()
if ($filesM.Success) {
    $files = @($filesM.Groups[1].Value -split ',' |
               ForEach-Object { $_.Trim().Trim("'").Trim('"') } |
               Where-Object { $_ })
}
if ($files.Count -eq 0) { $files = @('index.html', 'main.js', 'ribbon.xml', 'dialog_sum.html', 'updater.ps1') }

# ---------- 文件名白名单（2026-10-20 质检 Q-03）----------
# 远程版本清单是【不可信输入】：它决定"下载什么、覆盖什么、写到哪"。
# 直接拿清单里的文件名拼路径，清单里带 ".." 就能写到目标目录之外 ——
# 那等于把托管账号变成任意写文件。
# 所以只接受"纯文件名"：字母数字、下划线、点、短横线，且不许是 . 或 ..。
# 不合法的项剔除并记一笔（不中止整个更新——其余文件仍然有效）。
$Rejected = @()
$filesSafe = @()
foreach ($f in $files) {
    if ($f -match '^[A-Za-z0-9._-]+$' -and $f -notmatch '^\.\.?$') {
        $filesSafe += $f
    } else {
        $Rejected += $f
    }
}
if ($Rejected.Count) {
    Say ('清单里有不合法的文件名，已剔除（防止写到目录外）：' + ($Rejected -join ', '))
    Write-Status -State 'error' -From $localVer -Msg ('清单里有不合法的文件名，已剔除：' + ($Rejected -join ','))
}
$files = @($filesSafe | Where-Object { $_ })
if ($files.Count -eq 0) {
    Say '清单里没有任何可用的文件名，退出'
    exit 0
}

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
    Write-Status -State 'done' -Ok $true -From $localVer -To $localVer -Done $files.Count -Total $files.Count -Msg '已是最新版本'
    Say '已是最新，无事可做'
    exit 0
}

# ---------- 4 全部下载到临时目录 ----------
$tmpDir = Join-Path ([System.IO.Path]::GetTempPath()) ('dsh_upd_' + (Get-Random))
New-Item -ItemType Directory -Force -Path $tmpDir | Out-Null
function Cleanup { Remove-Item $tmpDir -Recurse -Force -ErrorAction SilentlyContinue }

Write-Status -State 'downloading' -From $localVer -To $remoteVer -Done 0 -Total $files.Count -Msg '正在下载'
$i = 0
foreach ($f in $files) {
    $u = $base + $f + '?_t=' + (Get-Random)
    $dst = Join-Path $tmpDir $f
    if (-not (Get-File $u $dst)) {
        Write-Status -State 'error' -From $localVer -To $remoteVer -Done $i -Total $files.Count -File $f -Msg ('下载失败：' + $f)
        Say ($f + ' 下载失败（已重试 4 次），中止 —— 一个文件都没写')
        Cleanup; exit 0
    }
    $sz = (Get-Item $dst).Length
    if ($sz -lt 20) {
        Write-Status -State 'error' -From $localVer -To $remoteVer -Done $i -Total $files.Count -File $f -Msg ('文件内容异常：' + $f)
        Say ($f + ' 内容异常（' + $sz + ' 字节），中止')
        Cleanup; exit 0
    }
    $i++
    Write-Status -State 'downloading' -From $localVer -To $remoteVer -Done $i -Total $files.Count -File $f -Msg '正在下载'
    Say ($f + ' 已下载 ' + $sz + ' 字节')
}

# ---------- 5 全部拿到了，才逐个覆盖 ----------
Write-Status -State 'installing' -From $localVer -To $remoteVer -Done 0 -Total $files.Count -Msg '正在写入'
$j = 0
foreach ($f in $files) {
    $src    = Join-Path $tmpDir $f
    $target = Join-Path $Here $f
    try {
        Copy-Item $src $target -Force
        $j++
        Write-Status -State 'installing' -From $localVer -To $remoteVer -Done $j -Total $files.Count -File $f -Msg '正在写入'
        Say ($f + ' 已覆盖')
    } catch {
        # 这三个文件在更新时【可能正被占用】：
        #   updater.ps1  —— 就是我自己在跑；
        #   update.bat / update.vbs —— 刚把活儿交给我们的启动器，可能还没完全退出。
        # 被占用不算失败：其余文件都已经更新成功了，下次更新它们还有机会。
        if ($f -eq 'updater.ps1' -or $f -eq 'update.bat' -or $f -eq 'update.vbs') {
            Say ($f + ' 被占用，跳过（不影响本次更新）'); continue
        }
        Write-Status -State 'error' -From $localVer -To $remoteVer -Done $j -Total $files.Count -File $f -Msg ('写入失败：' + $f)
        Say ($f + ' 写入失败: ' + $_.Exception.Message)
        Cleanup; exit 1
    }
}

Cleanup

# ---------- 5b 把 main.js 里的加载项目录名钉死成本目录 ----------
# 为什么必须做这一步（2026-10-22 质检 P1-01）：
#   main.js 里有一句  DSH_ADDON_DIR = 'BianjieTools_' + DSH_VERSION
#   而自动更新是【就地覆盖】：目录名还是旧的（BianjieTools_1.11.5），
#   版本号却变成了 1.11.6 —— 于是 DSH_ADDON_DIR 指向一个【不存在的目录】。
#   区域求和对话框在算 base 路径时有一条兜底分支用它，
#   拿不到真实目录就会复现 ERR_FILE_NOT_FOUND 白屏（v1.11.4 刚修好的那个坑）。
#
#   修法：覆盖完 main.js 后，把这个常量改写成【当前目录的真实名字】。
#   改写后「代码版本」与「目录名」彻底解耦：升级在哪个目录，目录名就是哪个。
#   —— 幂等：已经钉死过的，匹配到同样的文本，改写后无变化。
#
#   ⚠️ publish.xml 的 version 【不动】：它描述的是【加载项目录】，
#      就地升级时目录没变，改了反而会让它指向不存在的版本。
$addonDirName = Split-Path $Here -Leaf
$mainJsPath   = Join-Path $Here 'main.js'
if (Test-Path $mainJsPath) {
    try {
        $txt = [System.IO.File]::ReadAllText($mainJsPath, [System.Text.Encoding]::UTF8)
        $lit = $addonDirName.Replace('\', '\\').Replace("'", "\'")
        $new = [regex]::Replace($txt, "DSH_ADDON_DIR\s*=\s*'[^']*'(\s*\+\s*DSH_VERSION)?", ("DSH_ADDON_DIR = '" + $lit + "'"))
        if ($new -ne $txt) {
            # 用带 BOM 的 UTF-8 写回：main.js 本来就带 BOM，掉了会让 WPS 里的中文注释乱码
            [System.IO.File]::WriteAllText($mainJsPath, $new, (New-Object System.Text.UTF8Encoding($true)))
            Say ('已把 DSH_ADDON_DIR 钉死为 ' + $addonDirName)
            Write-Status -State 'installing' -From $localVer -To $remoteVer -Done $files.Count -Total $files.Count -Msg ('已更新，加载项目录 ' + $addonDirName)
        } else {
            Say 'DSH_ADDON_DIR 已是当前目录名，无需改写'
        }
    } catch {
        Say ('DSH_ADDON_DIR 修正失败（不影响本次更新）: ' + $_.Exception.Message)
    }
}

Write-Status -State 'done' -Ok $true -From $localVer -To $remoteVer -Done $files.Count -Total $files.Count -Msg '更新完成'
Say ('更新完成 ' + $localVer + ' -> ' + $remoteVer)
exit 0