<#
.SYNOPSIS
  DPI-aware screen capture for phase evidence.
  Windows PowerShell is DPI-unaware by default, so on a scaled display (e.g. 4K @ 200 %) a naive
  CopyFromScreen captures only part of the screen. This script opts the process into per-monitor
  DPI awareness first, then captures a physical-pixel region.
.EXAMPLE
  powershell -File scripts/screenshot.ps1 -Out shot.png                 # whole primary screen
  powershell -File scripts/screenshot.ps1 -Out top.png -X 960 -Y 0 -W 1920 -H 300
#>
param(
  [Parameter(Mandatory = $true)][string]$Out,
  [int]$X = 0, [int]$Y = 0, [int]$W = 0, [int]$H = 0
)
Add-Type @"
using System; using System.Runtime.InteropServices;
public static class Dpi {
  [DllImport("user32.dll")] public static extern bool SetProcessDpiAwarenessContext(IntPtr ctx);
  [DllImport("user32.dll")] public static extern int GetSystemMetrics(int i);
}
"@
# DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2 == -4
[void][Dpi]::SetProcessDpiAwarenessContext([IntPtr](-4))
Add-Type -AssemblyName System.Drawing
$sw = [Dpi]::GetSystemMetrics(0); $sh = [Dpi]::GetSystemMetrics(1)
if ($W -le 0) { $W = $sw - $X }
if ($H -le 0) { $H = $sh - $Y }
$bmp = New-Object System.Drawing.Bitmap $W, $H
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.CopyFromScreen($X, $Y, 0, 0, (New-Object System.Drawing.Size $W, $H))
$g.Dispose()
$bmp.Save($Out, [System.Drawing.Imaging.ImageFormat]::Png)
$bmp.Dispose()
Write-Output ("saved {0} ({1}x{2} at {3},{4}; screen {5}x{6} physical)" -f $Out, $W, $H, $X, $Y, $sw, $sh)
