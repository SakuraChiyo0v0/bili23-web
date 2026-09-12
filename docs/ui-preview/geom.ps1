# 几何复核：把非文字元素的边界在「原版 1:1 基准图」和「我们的渲染」上分别量出来对比。
# 起因：项目早期有一批常量是从 150% 缩放的手工截图上量来的，后来换了干净基准却没回头重算。
# 用法：pwsh -File geom.ps1 [-Theme dark]
param([string]$Theme = '')
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
$dir = $PSScriptRoot
$refPath  = if ($Theme -eq 'dark') { "$dir\ref\dark\parse-950x600.png" } else { "$dir\ref\parse-950x600.png" }
$minePath = if ($Theme -eq 'dark') { "$dir\preview-parse-dark-950x600.png" } else { "$dir\preview-parse-950x600.png" }
$a = New-Object System.Drawing.Bitmap($refPath)
$b = New-Object System.Drawing.Bitmap($minePath)
$W = [Math]::Min($a.Width, $b.Width); $H = [Math]::Min($a.Height, $b.Height)

function Lum($c) { 0.299 * $c.R + 0.587 * $c.G + 0.114 * $c.B }
function Hex($c) { "#{0:x2}{1:x2}{2:x2}" -f $c.R, $c.G, $c.B }

# 找一列里符合条件的连续区间（用于量纵向边界）
function VBands($bmp, $x, $y0, $y1, $test) {
  if ($x -ge $W) { return "x越界" }
  $out = @(); $s = $null
  for ($y = [Math]::Max(0,$y0); $y -lt [Math]::Min($H,$y1); $y++) {
    $ok = & $test $bmp.GetPixel($x, $y)
    if ($ok -and $null -eq $s) { $s = $y } elseif (-not $ok -and $null -ne $s) { if ($y-$s -ge 1) { $out += "$s-$($y-1)" }; $s = $null }
  }
  if ($null -ne $s) { $out += "$s-$([Math]::Min($H,$y1)-1)" }
  return ($out -join ' ')
}
# 找一行里符合条件的横向范围
function HRange($bmp, $y, $x0, $x1, $test) {
  if ($y -ge $H) { return "y越界" }
  $f = -1; $l = -1
  for ($x = [Math]::Max(0,$x0); $x -lt [Math]::Min($W,$x1); $x++) {
    if (& $test $bmp.GetPixel($x, $y)) { if ($f -lt 0) { $f = $x }; $l = $x }
  }
  if ($f -lt 0) { return "无" }
  return "$f..$l (宽$($l-$f+1))"
}

$dark = ($Theme -eq 'dark')
$tAccent  = { param($c) $l = Lum $c; if ($dark) { $c.B -gt 180 -and $c.G -gt 150 -and $c.R -lt 120 } else { $c.G -gt 120 -and $c.B -gt 120 -and $c.R -lt 90 } }
$tDarkish = { param($c) (Lum $c) -lt 170 }
$tBorder  = { param($c) $l = Lum $c; if ($dark) { $l -gt 45 -and $l -lt 110 } else { $l -lt 210 -and $l -gt 120 } }

$checks = @(
  @('标题栏 标题文字 y',   { VBands $a 60 0 50 $tDarkish }, { VBands $b 60 0 50 $tDarkish }),
  @('导航项 纵向分布',     { VBands $a 36 45 600 $tDarkish }, { VBands $b 36 45 600 $tDarkish }),
  @('输入框 下边框 y',     { VBands $a 500 55 105 $tBorder }, { VBands $b 500 55 105 $tBorder }),
  @('解析按钮 x 范围',     { HRange $a 80 700 $W $tAccent }, { HRange $b 80 700 $W $tAccent }),
  @('解析按钮 y 范围',     { VBands $a 860 55 105 $tAccent }, { VBands $b 860 55 105 $tAccent }),
  @('工具栏图标 x（y=116）',{ HRange $a 116 770 935 $tDarkish }, { HRange $b 116 770 935 $tDarkish }),
  @('表头下边框 y',        { VBands $a 500 160 180 $tBorder }, { VBands $b 500 160 180 $tBorder }),
  @('下载按钮 x 范围',     { HRange $a 568 700 $W $tAccent }, { HRange $b 568 700 $W $tAccent }),
  @('下载按钮 y 范围',     { VBands $a 860 540 $H $tAccent }, { VBands $b 860 540 $H $tAccent })
)
Write-Host "═══ 几何复核 $Theme（基准 vs 我的）═══"
foreach ($c in $checks) {
  $ra = & $c[1]; $rb = & $c[2]
  $mark = if ($ra -eq $rb) { '✓' } else { '✗' }
  Write-Host ("  {0,-22} {1}" -f $c[0], $mark)
  Write-Host ("      原版: {0}" -f $ra)
  Write-Host ("      我的: {0}" -f $rb)
}
$a.Dispose(); $b.Dispose()
