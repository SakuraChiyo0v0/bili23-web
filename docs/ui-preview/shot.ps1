# 截图 + 与原版拼成上下对照图。用法：pwsh -File shot.ps1 [页面文件名]
# 上=原版基准（.ui-ref/orig_main.png），下=我们的实现。中间红色分隔条。
param([string]$Page = 'parse', [int]$W = 950, [int]$H = 600)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

$chrome = 'C:\Program Files\Google\Chrome\Application\chrome.exe'
$dir    = Split-Path -Parent $MyInvocation.MyCommand.Path
$html   = Join-Path $dir "$Page.html"
$shot   = Join-Path $dir "preview-$Page-$($W)x$($H).png"
$out    = Join-Path $dir "compare-$Page-$($W)x$($H).png"

# 新版 Chrome 已移除旧 headless，必须用 --headless=new
# 基准图是原版程序 1:1 渲染的，所以这里也按同一尺寸、不加缩放。
# --disable-lcd-text：Qt 用灰度抗锯齿，Chrome 默认是次像素（LCD），
#   不关掉的话字形边缘的 RGB 会分开渲染，与基准图对不上（实测通道差 24.5 vs 4.8）。
$url = "file:///" + ($html -replace '\\', '/') + "?w=$W&h=$H"
& $chrome --headless=new --disable-gpu --hide-scrollbars --virtual-time-budget=1200 `
  --disable-lcd-text `
  "--window-size=$W,$H" --screenshot="$shot" --no-sandbox $url 2>$null | Out-Null
if (-not (Test-Path $shot)) { throw "截图失败：$shot" }

# 基准图现在由**原版程序自己离屏渲染**（_grab.py），1:1、字体正常，
# 比之前那张 150% 缩放的手工截图可靠得多。
$orig = [System.Drawing.Image]::FromFile((Join-Path $dir "ref\$Page-$($W)x$($H).png"))
$mine = [System.Drawing.Image]::FromFile($shot)
$gap  = 6
$w    = [Math]::Max($orig.Width, $mine.Width)
$h    = $orig.Height + $gap + $mine.Height
$bmp  = New-Object System.Drawing.Bitmap -ArgumentList @([int]$w, [int]$h)
$g    = [System.Drawing.Graphics]::FromImage($bmp)
$g.Clear([System.Drawing.Color]::FromArgb(255, 220, 40, 40))
$g.DrawImage($orig, 0, 0, $orig.Width, $orig.Height)
$g.DrawImage($mine, 0, $orig.Height + $gap, $mine.Width, $mine.Height)
$bmp.Save($out, [System.Drawing.Imaging.ImageFormat]::Png)
$g.Dispose(); $bmp.Dispose(); $orig.Dispose(); $mine.Dispose()

"预览图: $shot"
"对照图: $out"
