<#
.SYNOPSIS
  Logs in with every account in accounts.json and reports whether it is valid,
  plus the role and status the server returns. Passwords are never printed.

.EXAMPLE
  .\scripts\Test-Accounts.ps1
#>
param(
    [string]$BaseUrl = 'https://api.dev.techdomain.com.au/api',
    [string]$AccountsFile = (Join-Path (Split-Path $PSScriptRoot -Parent) 'accounts.json')
)

$BaseUrl = $BaseUrl.TrimEnd('/')
$headers = @{ Origin = 'https://dev.techdomain.com.au' }

function Get-Field($obj, [string[]]$paths) {
    foreach ($p in $paths) {
        $v = $obj
        foreach ($part in $p.Split('.')) { if ($null -ne $v) { $v = $v.$part } }
        if ($null -ne $v -and "$v" -ne '') { return "$v" }
    }
    return '-'
}

$rows = foreach ($a in (Get-Content $AccountsFile -Raw | ConvertFrom-Json)) {
    $row = [ordered]@{ expected = $a.role; email = $a.email; result = ''; serverRole = '-'; status = '-'; note = '' }
    try {
        $login = Invoke-RestMethod -Method POST -Uri "$BaseUrl/auth/login" -Headers $headers -ContentType 'application/json' `
            -Body (@{ email = $a.email; password = $a.password } | ConvertTo-Json)
        $user = $login.user
        if ($login.accessToken) {
            try {
                $auth = $headers.Clone(); $auth['Authorization'] = "Bearer $($login.accessToken)"
                $session = Invoke-RestMethod -Method GET -Uri "$BaseUrl/auth/session" -Headers $auth
                if ($session.user) { $user = $session.user } elseif ($session) { $user = $session }
            } catch { }
        }
        $row.result = 'VALID'
        $row.serverRole = Get-Field $user @('role.name', 'role', 'roleName', 'roleId')
        $row.status = Get-Field $user @('status', 'accountStatus')
        if ($user.isCustomerUser) { $row.note = 'customer sub-user' }
    } catch {
        $code = $null
        if ($_.Exception.Response) { $code = [int]$_.Exception.Response.StatusCode }
        $msg = $_.ErrorDetails.Message
        if (-not $msg) { $msg = $_.Exception.Message }
        $row.result = 'INVALID'
        if ($code -eq 307) { $row.result = 'UNVERIFIED'; $msg = 'email not verified (OTP re-sent to inbox)' }
        $row.note = "HTTP $code $msg"
    }
    [pscustomobject]$row
}

$rows | Format-Table expected, email, result, serverRole, status, note -AutoSize -Wrap
