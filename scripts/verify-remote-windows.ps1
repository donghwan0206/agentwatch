param(
  [string]$Url = $env:AGENTWATCH_REMOTE_URL,
  [string]$Report = $env:AGENTWATCH_REMOTE_REPORT,
  [Parameter(ValueFromRemainingArguments = $true)]
  [string[]]$RemainingArgs
)

$ErrorActionPreference = "Stop"

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$Verifier = Join-Path $ScriptDir "agentwatch-verify-remote-client.mjs"
if (-not (Test-Path $Verifier)) {
  $Verifier = Join-Path $ScriptDir "verify-remote-client.mjs"
}
if (-not $Url) {
  throw "Usage: verify-remote-windows.ps1 -Url http://<agent-machine-ip>:<selected-port> [-Report remote-client-verification-windows.json]"
}
if (-not $Report) {
  $Report = Join-Path $ScriptDir "remote-client-verification-windows.json"
}

node $Verifier --url $Url --report $Report @RemainingArgs
