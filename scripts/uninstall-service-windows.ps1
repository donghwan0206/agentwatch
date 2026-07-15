param(
  [string]$TaskName = "AgentWatchMonitor",
  [string]$InstallDir = "",
  [string]$ServiceBinary = ""
)

$ErrorActionPreference = "Stop"

if (-not $InstallDir) {
  if ($env:AGENTWATCH_INSTALL_DIR) {
    $InstallDir = $env:AGENTWATCH_INSTALL_DIR
  } else {
    $InstallDir = Join-Path $env:LOCALAPPDATA "AgentWatch"
  }
}
if (-not $ServiceBinary) {
  if ($env:AGENTWATCH_SERVICE_BINARY) {
    $ServiceBinary = $env:AGENTWATCH_SERVICE_BINARY
  } else {
    $ServiceBinary = Join-Path $InstallDir "agentwatch-server.exe"
  }
}

$task = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
if ($task) {
  Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
  Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
}

Remove-Item -Force -ErrorAction SilentlyContinue $ServiceBinary

Write-Output "AgentWatch scheduled task removed: $TaskName"
