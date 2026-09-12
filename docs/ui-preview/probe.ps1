# 在同一组探针行上分别扫描「原版基准」和「我们的实现」，列出深色像素的 x 区间，
# 用来算出文字到底偏了多少像素。用法：pwsh -File probe.ps1
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

$a = New-Object System.Drawing.Bitmap((Resolve-Path "$PSScriptRoot\..\..\.ui-ref\orig_main.png").Path)
$b = New-Object System.Drawing.Bitmap("$PSScriptRoot\preview-parse.png")
function Lum($c) { 0.299 * $c.R + 0.587 * $c.G + 0.114 * $c.B }

# 把一行里连续的深色像素合并成区间
function Runs($bmp, $y, $x0, $x1, $thr) {
  $out = @(); $s = $null
  for ($x = $x0; $x -lt $x1; $x++) {
    $dark = (Lum $bmp.GetPixel($x, $y)) -lt $thr
    if ($dark -and $null -eq $s) { $s = $x }
    elseif (-not $dark -and $null -ne $s) { if ($x - $s -ge 2) { $out += "$s-$($x-1)" }; $s = $null }
  }
  if ($null -ne $s) { $out += "$s-$($x1-1)" }
  return ($out -join '  ')
}

$probes = @(
  @(96,  10, 110, 200, '导航 解析 图标/文字'),
  @(330, 10, 110, 200, '导航 收藏 文字'),
  @(121, 140, 700, 180, '输入框 URL 文字'),
  @(178, 140, 700, 180, '状态行文字'),
  @(230, 140, 700, 210, '表头 序号+标题'),
  @(486, 140, 700, 210, '叶子行2 勾选框/序号/标题'),
  @(486, 1000, 1400, 210, '叶子行2 时长/发布时间'),
  @(865, 1150, 1400, 220, '右下角按钮文字')
)
foreach ($p in $probes) {
  $y = $p[0]; $x0 = $p[1]; $x1 = $p[2]; $thr = $p[3]; $label = $p[4]
  Write-Host "── $label  (y=$y, 阈值$thr) ──"
  Write-Host "   原版 : $(Runs $a $y $x0 $x1 $thr)"
  Write-Host "   我的 : $(Runs $b $y $x0 $x1 $thr)"
}
$a.Dispose(); $b.Dispose()
