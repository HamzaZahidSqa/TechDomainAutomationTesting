<#
.SYNOPSIS
  Runs a JMeter plan in non-GUI mode against the TDP dev API and builds the HTML dashboard.
  accounts.csv is generated from accounts.json next to the results and deleted afterwards.

.EXAMPLE
  .\scripts\Run-JMeter.ps1                       # 5 users, 10 loops, ramp 5s
  .\scripts\Run-JMeter.ps1 -Users 20 -Loops 5    # heavier run
  .\scripts\Run-JMeter.ps1 -Plan jmeter\other.jmx -Host api.dev.techdomain.com.au
#>
param(
    [string]$Plan = (Join-Path (Split-Path $PSScriptRoot -Parent) 'jmeter\tdp-api-smoke.jmx'),
    [int]$Users = 5,
    [int]$Loops = 10,
    [int]$Ramp = 5,
    [int]$ThinkMs = 300,
    [string]$ApiHost = 'api.dev.techdomain.com.au',
    [string]$AccountsFile = (Join-Path (Split-Path $PSScriptRoot -Parent) 'accounts.json')
)

$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent

# Resolve java + jmeter (installed under ~/tools by setup; fall back to PATH / env vars)
$jmHome = $env:JMETER_HOME; if (-not $jmHome) { $jmHome = (Get-ChildItem "$env:USERPROFILE\tools" -Directory -Filter 'apache-jmeter-*' | Select-Object -First 1).FullName }
$jre = $env:JAVA_HOME; if (-not $jre) { $jre = (Get-ChildItem "$env:USERPROFILE\tools" -Directory -Filter 'jdk-*' | Select-Object -First 1).FullName }
if (-not (Test-Path "$jmHome\bin\jmeter.bat")) { throw "JMeter not found (JMETER_HOME=$jmHome)" }
$env:JAVA_HOME = $jre
$env:Path = "$jre\bin;$jmHome\bin;$env:Path"

$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$out = Join-Path $root "jmeter\results\$stamp"
New-Item -ItemType Directory -Force $out | Out-Null

# accounts.json -> accounts.csv (role,email,password), quoted
$csv = Join-Path $out 'accounts.csv'
$accounts = Get-Content $AccountsFile -Raw | ConvertFrom-Json
$accounts | Select-Object role, email, password | Export-Csv -Path $csv -NoTypeInformation -Encoding UTF8

$jtl = Join-Path $out 'results.jtl'
$report = Join-Path $out 'report'
$log = Join-Path $out 'jmeter.log'

Write-Host "Plan: $Plan"
Write-Host "Users=$Users Loops=$Loops Ramp=${Ramp}s Think=${ThinkMs}ms Host=$ApiHost"
Write-Host "Output: $out"

try {
    # -J args must be quoted, otherwise PowerShell passes "$Users" literally
    & "$jmHome\bin\jmeter.bat" -n -t $Plan -l $jtl -j $log -e -o $report `
        "-Jusers=$Users" "-Jloops=$Loops" "-Jramp=$Ramp" "-Jthink=$ThinkMs" "-Jhost=$ApiHost" "-JaccountsCsv=$csv"
}
finally {
    Remove-Item $csv -Force -ErrorAction SilentlyContinue   # never leave passwords in results
}

# Quick summary from the JTL (per sampler: count, errors, avg/p90/max ms)
if (Test-Path $jtl) {
    $rows = Import-Csv $jtl
    $rows | Group-Object label | ForEach-Object {
        $t = $_.Group | ForEach-Object { [int]$_.elapsed } | Sort-Object
        $p90 = $t[[math]::Min($t.Count - 1, [math]::Floor($t.Count * 0.9))]
        [pscustomobject]@{
            Sampler = $_.Name
            Samples = $_.Count
            Errors  = ($_.Group | Where-Object success -ne 'true').Count
            AvgMs   = [math]::Round(($t | Measure-Object -Average).Average)
            P90Ms   = $p90
            MaxMs   = $t[-1]
        }
    } | Format-Table -AutoSize
    Write-Host "HTML dashboard: $report\index.html"
}
