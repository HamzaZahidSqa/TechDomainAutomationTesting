<#
.SYNOPSIS
  Runs jmeter/tdp-chat-load.jmx: N active users (HTTP polling + a socket each) while Tech Domain chat
  senders push messages over socket.io and a customer receiver measures delivery / notification latency.

.EXAMPLE
  .\scripts\Run-ChatLoad.ps1 -Users 0 -Senders 5 -SenderDelay 2 -SenderDuration 60     # baseline, no load
  .\scripts\Run-ChatLoad.ps1 -Users 1000 -Ramp 120 -Duration 330 -Senders 10 -SenderDelay 130 -SenderDuration 180
#>
param(
    [int]$Users = 1000,
    [int]$Ramp = 120,
    [int]$Duration = 330,
    [int]$Senders = 10,
    [int]$SenderRamp = 10,
    [int]$SenderDelay = 130,
    [int]$SenderDuration = 180,
    [int]$ReceiverDelay = -1,          # default: SenderDelay - 5
    [int]$ReceiverDuration = -1,       # default: SenderDuration + 25
    [string]$Label = 'run',
    [string]$ApiHost = 'api.dev.techdomain.com.au',
    [string]$AccountsFile = (Join-Path (Split-Path $PSScriptRoot -Parent) 'accounts.json'),
    [string]$Heap = '-Xms1g -Xmx3g -XX:MaxMetaspaceSize=512m'
)

$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$plan = Join-Path $root 'jmeter\tdp-chat-load.jmx'
if ($ReceiverDelay -lt 0) { $ReceiverDelay = [Math]::Max(0, $SenderDelay - 5) }
if ($ReceiverDuration -lt 0) { $ReceiverDuration = $SenderDuration + 25 }

$jmHome = $env:JMETER_HOME; if (-not $jmHome) { $jmHome = (Get-ChildItem "$env:USERPROFILE\tools" -Directory -Filter 'apache-jmeter-*' | Select-Object -First 1).FullName }
$jre = $env:JAVA_HOME; if (-not $jre) { $jre = (Get-ChildItem "$env:USERPROFILE\tools" -Directory -Filter 'jdk-*' | Select-Object -First 1).FullName }
if (-not (Test-Path "$jmHome\bin\jmeter.bat")) { throw "JMeter not found (JMETER_HOME=$jmHome)" }
$env:JAVA_HOME = $jre
$env:Path = "$jre\bin;$jmHome\bin;$env:Path"
$env:HEAP = $Heap

$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$out = Join-Path $root "jmeter\results\chat-$Label-$stamp"
New-Item -ItemType Directory -Force $out | Out-Null

# accounts.json -> accounts.csv without the Admin account (admin cannot use /inbox)
$csv = Join-Path $out 'accounts.csv'
$accounts = Get-Content $AccountsFile -Raw | ConvertFrom-Json | Where-Object { $_.role -ne 'Admin' }
$accounts | Select-Object role, email, password | Export-Csv -Path $csv -NoTypeInformation -Encoding UTF8
$nAccounts = @($accounts).Count

$jtl = Join-Path $out 'results.jtl'
$report = Join-Path $out 'report'
$log = Join-Path $out 'jmeter.log'

Write-Host "Plan: $plan"
Write-Host "Users=$Users Ramp=${Ramp}s Duration=${Duration}s | Senders=$Senders delay=${SenderDelay}s dur=${SenderDuration}s | Receiver delay=${ReceiverDelay}s dur=${ReceiverDuration}s"
Write-Host "Output: $out"

try {
    & "$jmHome\bin\jmeter.bat" -n -t $plan -l $jtl -j $log -e -o $report `
        "-Jusers=$Users" "-Jramp=$Ramp" "-Jduration=$Duration" `
        "-Jsenders=$Senders" "-JsenderRamp=$SenderRamp" "-JsenderDelay=$SenderDelay" "-JsenderDuration=$SenderDuration" `
        "-JreceiverDelay=$ReceiverDelay" "-JreceiverDuration=$ReceiverDuration" `
        "-Jhost=$ApiHost" "-JaccountsCsv=$csv" "-JnAccounts=$nAccounts"
}
finally {
    Remove-Item $csv -Force -ErrorAction SilentlyContinue
}

# Summary per label: count, errors, avg / p50 / p90 / p95 / max (ms)
if (Test-Path $jtl) {
    $rows = Import-Csv $jtl
    $summary = $rows | Group-Object label | ForEach-Object {
        $t = @($_.Group | ForEach-Object { [int]$_.elapsed } | Sort-Object)
        $pct = { param($p) $t[[Math]::Min($t.Count - 1, [Math]::Floor($p * $t.Count))] }
        [pscustomobject]@{
            label = $_.Name; count = $t.Count
            errors = @($_.Group | Where-Object { $_.success -ne 'true' }).Count
            avg = [Math]::Round(($t | Measure-Object -Average).Average)
            p50 = & $pct 0.5; p90 = & $pct 0.9; p95 = & $pct 0.95; max = $t[-1]
        }
    }
    $summary | Sort-Object label | Format-Table -AutoSize | Out-String | Write-Host
    $summary | ConvertTo-Json | Set-Content -Path (Join-Path $out 'summary.json') -Encoding utf8
}
