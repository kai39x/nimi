param([int]$Seconds = 6)
$all = Get-CimInstance Win32_Process | Select-Object ProcessId, ParentProcessId, Name, CommandLine
$root = (Get-Process nimi).Id
$ids = New-Object System.Collections.Generic.HashSet[int]; [void]$ids.Add($root); $c = $true
while ($c) { $c = $false; foreach ($p in $all) { if ($ids.Contains([int]$p.ParentProcessId) -and -not $ids.Contains([int]$p.ProcessId)) { [void]$ids.Add([int]$p.ProcessId); $c = $true } } }
$procs = @(); foreach ($id in $ids) { $pr = Get-Process -Id $id -ErrorAction SilentlyContinue; if ($pr) { $cl = ($all | Where-Object { $_.ProcessId -eq $id }).CommandLine; $type = 'main'; if ($cl -match '--type=([a-z-]+)') { $type = $Matches[1] }; $procs += [pscustomobject]@{ P = $pr; Type = $type } } }
$t1 = @{}; foreach ($x in $procs) { $t1[$x.P.Id] = $x.P.TotalProcessorTime.TotalMilliseconds }
Start-Sleep -Seconds $Seconds
$total = 0
foreach ($x in $procs) { $x.P.Refresh(); $d = $x.P.TotalProcessorTime.TotalMilliseconds - $t1[$x.P.Id]; $total += $d; "{0,-12} {1,7:N1} % of one core" -f $x.Type, ($d / ($Seconds * 10)) }
"{0,-12} {1,7:N1} % of one core" -f "TOTAL", ($total / ($Seconds * 10))
