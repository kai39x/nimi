Add-Type -Name FC -Namespace W -MemberDefinition '[DllImport("user32.dll")] public static extern bool SetProcessDpiAwarenessContext(IntPtr c); [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y); [DllImport("user32.dll")] public static extern int GetWindowLong(IntPtr h, int i); [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc cb, IntPtr l); public delegate bool EnumProc(IntPtr h, IntPtr l); [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid); [DllImport("user32.dll")] public static extern int GetClassName(IntPtr h, System.Text.StringBuilder s, int n); public static IntPtr Overlay(uint pid){ IntPtr f=IntPtr.Zero; EnumWindows((h,l)=>{ uint p; GetWindowThreadProcessId(h,out p); if(p!=pid) return true; var c=new System.Text.StringBuilder(64); GetClassName(h,c,64); if(c.ToString()=="Tauri Window" && (GetWindowLong(h,-20) & 0x8)!=0){ f=h; return false;} return true; }, IntPtr.Zero); return f; }'
[void][W.FC]::SetProcessDpiAwarenessContext([IntPtr](-4))
$h = [W.FC]::Overlay([uint32](Get-Process nimi).Id)
[void][W.FC]::SetCursorPos(1200,1200); Start-Sleep -Milliseconds 350
$a = ([W.FC]::GetWindowLong($h,-20) -band 0x20) -ne 0
[void][W.FC]::SetCursorPos(1920,72); Start-Sleep -Milliseconds 350
$b = ([W.FC]::GetWindowLong($h,-20) -band 0x20) -ne 0
[void][W.FC]::SetCursorPos(1200,1200)
"transparent away=$a over=$b  -> " + $(if ($a -and -not $b) { "FLIPS OK" } else { "NOT FLIPPING" })
