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

$Report = if ($env:AGENTWATCH_VERIFY_REPORT) {
  $env:AGENTWATCH_VERIFY_REPORT
} else {
  Join-Path $ScriptDir "tray-verification-windows.json"
}
$Screenshot = if ($env:AGENTWATCH_WINDOWS_TRAY_SCREENSHOT) {
  $env:AGENTWATCH_WINDOWS_TRAY_SCREENSHOT
} else {
  Join-Path $ScriptDir "screenshots\windows-tray.png"
}
$CaptureDelaySeconds = if ($env:AGENTWATCH_WINDOWS_CAPTURE_DELAY_SECONDS) {
  [int]$env:AGENTWATCH_WINDOWS_CAPTURE_DELAY_SECONDS
} else {
  3
}
$HoldMs = if ($env:AGENTWATCH_VERIFY_HOLD_MS) {
  $env:AGENTWATCH_VERIFY_HOLD_MS
} else {
  "7000"
}

for ($index = 0; $index -lt $RemainingArgs.Count; $index++) {
  if ($RemainingArgs[$index] -eq "--screenshot" -and ($index + 1) -lt $RemainingArgs.Count) {
    $Screenshot = $RemainingArgs[$index + 1]
  }
  if ($RemainingArgs[$index] -eq "--report" -and ($index + 1) -lt $RemainingArgs.Count) {
    $Report = $RemainingArgs[$index + 1]
  }
}

New-Item -ItemType Directory -Force -Path (Split-Path -Parent $Screenshot) | Out-Null

$env:AGENTWATCH_VERIFY_HOLD_MS = $HoldMs
$verifierArguments = @("--app", $AppPath) + $RemainingArgs
if ($RemainingArgs -notcontains "--report") {
  $verifierArguments += @("--report", $Report)
}
if ($RemainingArgs -notcontains "--screenshot") {
  $verifierArguments += @("--screenshot", $Screenshot)
}
$arguments = @($Verifier) + $verifierArguments

$process = $null
try {
  $process = Start-Process -FilePath "node" -ArgumentList $arguments -PassThru -NoNewWindow
  Start-Sleep -Seconds $CaptureDelaySeconds
  Save-PrimaryScreenScreenshot $Screenshot
  $process.WaitForExit()
} finally {
  if ($null -ne $process -and -not $process.HasExited) {
    Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue
    $process.WaitForExit()
  }
}

Write-Output "Windows tray screenshot: $Screenshot"
exit $(if ($null -ne $process) { $process.ExitCode } else { 1 })

function Save-PrimaryScreenScreenshot([string]$Path) {
  Add-Type -AssemblyName System.Windows.Forms
  Add-Type -AssemblyName System.Drawing
  $bounds = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
  $bitmap = New-Object System.Drawing.Bitmap $bounds.Width, $bounds.Height
  $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
  try {
    $graphics.CopyFromScreen($bounds.Location, [System.Drawing.Point]::Empty, $bounds.Size)
    $bitmap.Save($Path, [System.Drawing.Imaging.ImageFormat]::Png)
  } finally {
    $graphics.Dispose()
    $bitmap.Dispose()
  }
}
