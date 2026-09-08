# Read-only. Run on the Windows Ollama PC while a translation is running.
$osInfo = Get-CimInstance Win32_OperatingSystem
$memoryInfo = Get-CimInstance Win32_PerfFormattedData_PerfOS_Memory
[pscustomobject]@{
  TotalRAM_GB = [math]::Round($osInfo.TotalVisibleMemorySize / 1MB, 2)
  AvailableRAM_GB = [math]::Round($osInfo.FreePhysicalMemory / 1MB, 2)
  CommittedBytes_GB = [math]::Round($memoryInfo.CommittedBytes / 1GB, 2)
  PagesInputPerSecond = $memoryInfo.PagesInputPersec
  PageReadsPerSecond = $memoryInfo.PageReadsPersec
}
Get-CimInstance Win32_PageFileUsage | Select-Object Name, AllocatedBaseSize, CurrentUsage, PeakUsage
Get-Process -Name 'ollama*' -ErrorAction SilentlyContinue | Select-Object Id, ProcessName, CPU, WorkingSet64, PrivateMemorySize64
Invoke-RestMethod -Uri 'http://localhost:11434/api/ps'
# Page-file use alone does not prove active swapping. Sample repeatedly during inference.
