# 一轮迭代 = 渲染 + 打分。用法：
#   pwsh -File check.ps1                       # 默认 950x600（原版默认窗口）
#   pwsh -File check.ps1 -W 1200 -H 700        # 验证缩放后的布局
#
# 基准图由 _grab.py 从**原版程序**离屏渲染而来（1:1、字体正常），
# 所以这里渲染页面时不加任何缩放，物理像素与基准一一对应。
param(
  [string]$Page = 'parse',
  [int]$W = 950,
  [int]$H = 600,
  [string]$State = '',     # 页面状态，如 empty；基准图名会带这个后缀
  [string]$Theme = ''      # dark 时用 ref/dark 下的基准图，并给页面带 ?theme=dark
)
$ErrorActionPreference = 'Stop'
$chrome = 'C:\Program Files\Google\Chrome\Application\chrome.exe'
$dir    = $PSScriptRoot

$suffix   = if ($State) { "-$State" } else { '' }
$refName  = "$Page$suffix-$($W)x$($H).png"
$refDir   = if ($Theme -eq 'dark') { "ref\dark" } else { 'ref' }
$mineName = if ($Theme -eq 'dark') { "preview-$Page$suffix-dark-$($W)x$($H).png" }
            else { "preview-$Page$suffix-$($W)x$($H).png" }
$query    = "?w=$W&h=$H" + $(if ($State) { "&state=$State" } else { '' }) +
            $(if ($Theme) { "&theme=$Theme" } else { '' })
if (-not (Test-Path (Join-Path $dir "$refDir\$refName"))) {
  Write-Host "没有这个尺寸的基准图：$refDir\$refName"
  Write-Host "先跑 _grab.py 生成，或换成已有尺寸。现在已有的："
  Get-ChildItem (Join-Path $dir "$refDir\*.png") | ForEach-Object { "  " + $_.Name }
  exit 1
}

# 1) 渲染。实测（对照实验 a/b/c）：
#      --window-size 必须给，否则视口是 Chrome 默认的 752×479；
#      ?w=&h= 同时给，让页面内容尺寸与视口一致（截图截的是整页内容）。
#    两个都给的组合实测产出 1200×700，正确。
$html = Join-Path $dir "$Page.html"
$shot = Join-Path $dir $mineName
$url  = "file:///" + ($html -replace '\\', '/') + $query
& $chrome --headless=new --disable-gpu --hide-scrollbars --virtual-time-budget=1200 `
  --disable-lcd-text `
  "--window-size=$W,$H" --screenshot="$shot" --no-sandbox $url 2>$null | Out-Null
if (-not (Test-Path $shot)) { throw "渲染失败：$shot" }

# 2) 打分（逐像素比对在浏览器里做，报告从 DOM 里取成文字）
$diffUrl = "file:///" + ((Join-Path $dir 'diff.html') -replace '\\', '/') +
           "?ref=$($refDir -replace '\\','/')/$refName&mine=$mineName"
$dom = & $chrome --headless=new --disable-gpu --allow-file-access-from-files `
  --virtual-time-budget=4000 --dump-dom --no-sandbox $diffUrl 2>$null | Out-String
$m = [regex]::Match($dom, '(?s)<div id="report">(.*?)</div>')
if ($m.Success) {
  $txt = $m.Groups[1].Value -replace '<[^>]+>', '' -replace '&gt;', '>' -replace '&lt;', '<' -replace '&amp;', '&'
  $tag = if ($Theme) { "$Theme " } else { '' }
  Write-Host "═══ $Page $tag@ $($W)x$($H) ═══"
  Write-Host $txt.Trim()
} else {
  Write-Host "没取到报告，前 500 字符："
  Write-Host $dom.Substring(0, [Math]::Min(500, $dom.Length))
}
