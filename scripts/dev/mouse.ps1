param([string]$Action, [int]$X = 0, [int]$Y = 0, [int]$X2 = 0, [int]$Y2 = 0)
Add-Type -Name M -Namespace W -MemberDefinition '[DllImport("user32.dll")] public static extern bool SetProcessDpiAwarenessContext(IntPtr c); [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y); [DllImport("user32.dll")] public static extern void mouse_event(uint f, int x, int y, uint d, UIntPtr e);'
[void][W.M]::SetProcessDpiAwarenessContext([IntPtr](-4))
switch ($Action) {
  "move" { [void][W.M]::SetCursorPos($X, $Y) }
  "click" { [void][W.M]::SetCursorPos($X, $Y); Start-Sleep -Milliseconds 120; [W.M]::mouse_event(2,0,0,0,[UIntPtr]::Zero); Start-Sleep -Milliseconds 50; [W.M]::mouse_event(4,0,0,0,[UIntPtr]::Zero) }
  "shake" { [void][W.M]::SetCursorPos($X, $Y); Start-Sleep -Milliseconds 150; [W.M]::mouse_event(2,0,0,0,[UIntPtr]::Zero); Start-Sleep -Milliseconds 120; for ($i=0; $i -lt 8; $i++) { [void][W.M]::SetCursorPos($X + 60, $Y); Start-Sleep -Milliseconds 45; [void][W.M]::SetCursorPos($X - 60, $Y); Start-Sleep -Milliseconds 45 }; [void][W.M]::SetCursorPos($X, $Y); Start-Sleep -Milliseconds 60; [W.M]::mouse_event(4,0,0,0,[UIntPtr]::Zero) }
  "dragto" { [void][W.M]::SetCursorPos($X, $Y); Start-Sleep -Milliseconds 150; [W.M]::mouse_event(2,0,0,0,[UIntPtr]::Zero); Start-Sleep -Milliseconds 120; for ($i=1; $i -le 10; $i++) { [void][W.M]::SetCursorPos([int]($X + ($X2-$X)*$i/10), [int]($Y + ($Y2-$Y)*$i/10)); Start-Sleep -Milliseconds 30 }; Start-Sleep -Milliseconds 500 }
  "dblclick" { [void][W.M]::SetCursorPos($X, $Y); Start-Sleep -Milliseconds 120; [W.M]::mouse_event(2,0,0,0,[UIntPtr]::Zero); Start-Sleep -Milliseconds 40; [W.M]::mouse_event(4,0,0,0,[UIntPtr]::Zero); Start-Sleep -Milliseconds 90; [W.M]::mouse_event(2,0,0,0,[UIntPtr]::Zero); Start-Sleep -Milliseconds 40; [W.M]::mouse_event(4,0,0,0,[UIntPtr]::Zero) }
  "up" { [W.M]::mouse_event(4,0,0,0,[UIntPtr]::Zero) }
}
