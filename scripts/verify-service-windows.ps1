param(
  [string]$Url = $env:AGENTWATCH_SERVICE_URL,
  [string]$Report = $env:AGENTWATCH_SERVICE_REPORT,
  [Parameter(ValueFromRemainingArguments = $true)]
  [string[]]$RemainingArgs
)

$ErrorActionPreference = "Stop"

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$Verifier = Join-Path $ScriptDir "agentwatch-verify-service.mjs"
if (-not (Test-Path $Verifier)) {
  $Verifier = Join-Path $ScriptDir "verify-service.mjs"
}
if (-not $Report) {
  $Report = Join-Path $ScriptDir "service-verification-windows.json"
}

$Args = @("--report", $Report)
if ($Url) {
  $Args = @("--url", $Url) + $Args
}

node $Verifier @Args @RemainingArgs
