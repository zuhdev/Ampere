# Ampere relay supervisor loop (Windows Task Scheduler entry point).
# Restarts the relay worker whenever it crashes; logs to relay/keeper.log.
#
# Install as a Scheduled Task with install-keeper-task.ps1.

$ErrorActionPreference = "Continue"
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location (Join-Path $root "..")

$logFile = Join-Path $root "keeper.log"

function Log([string]$msg) {
    $line = "$(Get-Date -Format o) $msg"
    Write-Host $line
    Add-Content -Path $logFile -Value $line
}

Log "=== Ampere keeper started ==="

while ($true) {
    Log "starting relay worker (npm start -w relay)"
    $proc = Start-Process -FilePath "npm" `
        -ArgumentList "start", "-w", "relay" `
        -NoNewWindow -PassThru `
        -RedirectStandardOutput (Join-Path $root "relay.out.log") `
        -RedirectStandardError (Join-Path $root "relay.err.log")

    Wait-Process -Id $proc.Id
    Log "relay worker exited with code $($proc.ExitCode) — restarting in 5s"
    Start-Sleep -Seconds 5
}
