param(
  [string]$AppPath = "$env:ProgramFiles\AgentWatch\agentwatch.exe",
  [Parameter(ValueFromRemainingArguments = $true)]
  [string[]]$RemainingArgs
)

$ErrorActionPreference = "Stop"
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$Verifier = Join-Path $ScriptDir "agentwatch-verify-tray.mjs"
if (-not (Test-Path $Verifier)) {
  $Verifier = Join-Path $ScriptDir "verify-tray.mjs"
}
$Report = Join-Path $ScriptDir "tray-verification-windows.json"

$Arguments = @("--app", $AppPath) + $RemainingArgs
if ($RemainingArgs -notcontains "--report") {
  $Arguments += @("--report", $(if ($env:AGENTWATCH_VERIFY_REPORT) { $env:AGENTWATCH_VERIFY_REPORT } else { $Report }))
}

& node $Verifier @Arguments

exit $LASTEXITCODE
