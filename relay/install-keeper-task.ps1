# Install the Ampere relay supervisor as a Windows Scheduled Task.
# Run from an elevated PowerShell:
#   powershell -ExecutionPolicy Bypass -File relay\install-keeper-task.ps1

$taskName = "AmpereRelayKeeper"
$scriptPath = Join-Path (Split-Path -Parent $MyInvocation.MyCommand.Path) "run-keeper.ps1"

# Remove stale registration if present
Unregister-ScheduledTask -TaskName $taskName -Confirm:$false -ErrorAction SilentlyContinue

$action = New-ScheduledTaskAction -Execute "powershell.exe" `
    -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$scriptPath`""
$trigger = New-ScheduledTaskTrigger -AtStartup
$settings = New-ScheduledTaskSettingsSet -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) `
    -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
$principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType S4U -RunLevel Limited

Register-ScheduledTask -TaskName $taskName `
    -Action $action -Trigger $trigger -Settings $settings -Principal $principal `
    -Description "Ampere relay supervisor: restarts the relay worker on crash (BOT Chain testnet)"

Write-Host "Scheduled task '$taskName' installed. Start it with:"
Write-Host "  Start-ScheduledTask -TaskName $taskName"
