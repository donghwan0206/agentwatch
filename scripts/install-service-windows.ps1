param(
  [string]$Binary = "",
  [string]$InstallDir = "",
  [string]$ServiceBinary = "",
  [string]$TaskName = "AgentWatchMonitor",
  [Nullable[int]]$Port = $null,
  [string]$Database = "",
  [switch]$StartNow,
  [switch]$DryRun
)

$ErrorActionPreference = "Stop"

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$Root = Resolve-Path (Join-Path $ScriptDir "..")
if (-not $Binary) {
  $Binary = Join-Path $Root "src-tauri\target\release\agentwatch-server.exe"
}
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

if (-not (Test-Path $Binary)) {
  throw "AgentWatch server binary not found: $Binary. Run: npm run build"
}
$Binary = (Resolve-Path $Binary).Path
New-Item -ItemType Directory -Force -Path (Split-Path -Parent $ServiceBinary) | Out-Null
if ($Binary -ne $ServiceBinary) {
  Copy-Item -Force -Path $Binary -Destination $ServiceBinary
}
$ServiceBinary = (Resolve-Path $ServiceBinary).Path

function Quote-PowerShellSingle([string]$Value) {
  return "'" + $Value.Replace("'", "''") + "'"
}

$CommandParts = @(
)
if ($null -ne $Port) {
  $CommandParts += "`$env:AGENTWATCH_PORT = '$Port'"
}
if ($Database) {
  $CommandParts += "`$env:AGENTWATCH_DB = $(Quote-PowerShellSingle $Database)"
}
$CommandParts += "& $(Quote-PowerShellSingle $ServiceBinary)"
$Command = $CommandParts -join "; "

$Action = New-ScheduledTaskAction `
  -Execute "powershell.exe" `
  -Argument "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -Command $Command"
$Trigger = New-ScheduledTaskTrigger -AtLogOn
$Settings = New-ScheduledTaskSettingsSet `
  -AllowStartIfOnBatteries `
  -DontStopIfGoingOnBatteries `
  -ExecutionTimeLimit ([TimeSpan]::Zero) `
  -RestartCount 3 `
  -RestartInterval (New-TimeSpan -Minutes 1)

if ($DryRun) {
  Write-Output "AgentWatch scheduled task dry run: $TaskName"
  Write-Output "Source binary: $Binary"
  Write-Output "Installed binary: $ServiceBinary"
  if ($null -ne $Port) {
    Write-Output "Dashboard: http://127.0.0.1:$Port"
  } else {
    Write-Output "Dashboard: configured by ~/.agentwatch/config.json or selected automatically"
  }
  exit 0
}

Register-ScheduledTask `
  -TaskName $TaskName `
  -Action $Action `
  -Trigger $Trigger `
  -Settings $Settings `
  -Description "AgentWatch Rust monitor server for LAN browser dashboard" `
  -Force | Out-Null

if ($StartNow) {
  Start-ScheduledTask -TaskName $TaskName
}

Write-Output "AgentWatch scheduled task installed: $TaskName"
Write-Output "Installed binary: $ServiceBinary"
if ($null -ne $Port) {
  Write-Output "Dashboard: http://127.0.0.1:$Port"
} else {
  Write-Output "Dashboard: check /api/runtime for the selected port"
}
