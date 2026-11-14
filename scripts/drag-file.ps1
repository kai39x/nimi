<#
.SYNOPSIS
  Performs a real OLE file drag (CF_HDROP) from a start point to an end point, like dragging a
  file out of Explorer. Used to test NIMI's drop target without a human at the mouse.
  Must run in an STA thread:  powershell -STA -File scripts/drag-file.ps1 ...
.PARAMETER Path   File to drag.
.PARAMETER ToX/ToY  Drop point in physical screen pixels.
.PARAMETER FromX/FromY  Start point (defaults to 300 px left / 200 px below the drop point).
.PARAMETER Hold  Milliseconds to hover over the drop point before releasing (default 600).
.NOTES
  DoDragDrop blocks this thread in OLE's modal loop, so the cursor moves and the button release
  come from a helper process started just before the drag begins.
#>
param(
  [Parameter(Mandatory = $true)][string]$Path,
  [Parameter(Mandatory = $true)][int]$ToX,
  [Parameter(Mandatory = $true)][int]$ToY,
  [int]$FromX = -1, [int]$FromY = -1,
  [int]$Hold = 600
)
if ([Threading.Thread]::CurrentThread.GetApartmentState() -ne "STA") { throw "run with powershell -STA" }

$inputType = @"
using System; using System.Runtime.InteropServices;
public static class In {
  [DllImport("user32.dll")] public static extern bool SetProcessDpiAwarenessContext(IntPtr ctx);
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint flags, int dx, int dy, uint data, UIntPtr extra);
  public const uint DOWN = 0x0002, UP = 0x0004;
}
"@
Add-Type $inputType
[void][In]::SetProcessDpiAwarenessContext([IntPtr](-4))
Add-Type -AssemblyName System.Windows.Forms

if ($FromX -lt 0) { $FromX = $ToX - 300 }
if ($FromY -lt 0) { $FromY = $ToY + 200 }

# The drop source must be the foreground window, or OLE cannot capture the mouse and the drag
# loop never sees the moves and the release. So: a small visible window under the cursor, which
# also receives the button press.
$form = New-Object System.Windows.Forms.Form
$form.ShowInTaskbar = $false
$form.FormBorderStyle = "None"
$form.TopMost = $true
$form.BackColor = "DimGray"
$form.StartPosition = "Manual"
$form.Bounds = New-Object System.Drawing.Rectangle(($FromX - 30), ($FromY - 30), 60, 60)
$form.Show()
$form.Activate()
[System.Windows.Forms.Application]::DoEvents()

$data = New-Object System.Windows.Forms.DataObject
$data.SetData([System.Windows.Forms.DataFormats]::FileDrop, [string[]]@((Resolve-Path $Path).Path))

# Press the button on the source window; DoDragDrop keeps going while it stays pressed.
[void][In]::SetCursorPos($FromX, $FromY)
Start-Sleep -Milliseconds 150
[In]::mouse_event([In]::DOWN, 0, 0, 0, [UIntPtr]::Zero)
[System.Windows.Forms.Application]::DoEvents()

# Helper process: wait for the drag loop to start, glide to the target, hover, release.
$helper = @"
Add-Type @'
$inputType
'@
[void][In]::SetProcessDpiAwarenessContext([IntPtr](-4))
Start-Sleep -Milliseconds 400
`$steps = 30
for (`$i = 1; `$i -le `$steps; `$i++) {
  `$t = `$i / `$steps
  [void][In]::SetCursorPos([int]($FromX + ($ToX - $FromX) * `$t), [int]($FromY + ($ToY - $FromY) * `$t))
  Start-Sleep -Milliseconds 25
}
Start-Sleep -Milliseconds $Hold
[In]::mouse_event([In]::UP, 0, 0, 0, [UIntPtr]::Zero)
"@
$encoded = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($helper))
$proc = Start-Process powershell -ArgumentList "-NoProfile", "-EncodedCommand", $encoded -WindowStyle Hidden -PassThru

try {
  $effect = $form.DoDragDrop($data, [System.Windows.Forms.DragDropEffects]::Copy)
  Write-Output ("drag finished with effect: {0}" -f $effect)
} finally {
  # Never leave a virtual button pressed, whatever happened above.
  [In]::mouse_event([In]::UP, 0, 0, 0, [UIntPtr]::Zero)
  $form.Close()
  if ($proc -and -not $proc.HasExited) { $proc.WaitForExit(5000) | Out-Null }
}
