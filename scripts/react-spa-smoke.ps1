param(
    [string]$BaseUrl = "http://127.0.0.1:7979"
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$failures = @()

function Assert-Condition {
    param(
        [bool]$Condition,
        [string]$Message
    )

    if (-not $Condition) {
        $script:failures += $Message
    }
}

function Get-Page {
    param(
        [string]$Path
    )

    return Invoke-WebRequest -Uri ($BaseUrl.TrimEnd('/') + $Path) -UseBasicParsing
}

Write-Output "Checking SPA routes at $BaseUrl"

$spaRoutes = @("/", "/login", "/setup", "/dashboard", "/totally-made-up-spa-route")
foreach ($route in $spaRoutes) {
    try {
        $resp = Get-Page -Path $route
        $content = [string]$resp.Content
        $hasReactRoot = $content -match '<div id="root"></div>'

        Assert-Condition ($resp.StatusCode -eq 200) "$route expected HTTP 200, got $($resp.StatusCode)"
        Assert-Condition $hasReactRoot "$route did not return React index.html"

        Write-Output ("PASS {0} | {1} | reactRoot={2}" -f $route, $resp.StatusCode, $hasReactRoot)
    }
    catch {
        $failures += "$route request failed: $($_.Exception.Message)"
        Write-Output ("FAIL {0} | {1}" -f $route, $_.Exception.Message)
    }
}

Write-Output "Checking API endpoints"

try {
    $csrf = Get-Page -Path "/api/auth/csrf"
    $csrfJson = $csrf.Content | ConvertFrom-Json
    Assert-Condition ($csrf.StatusCode -eq 200) "/api/auth/csrf expected HTTP 200, got $($csrf.StatusCode)"
    Assert-Condition ($null -ne $csrfJson.csrf_token -and $csrfJson.csrf_token.Length -gt 0) "/api/auth/csrf missing csrf_token"
    Write-Output "PASS /api/auth/csrf"
}
catch {
    $failures += "/api/auth/csrf request failed: $($_.Exception.Message)"
    Write-Output ("FAIL /api/auth/csrf | {0}" -f $_.Exception.Message)
}

try {
    $state = Get-Page -Path "/api/state"
    $stateJson = $state.Content | ConvertFrom-Json
    Assert-Condition ($state.StatusCode -eq 200) "/api/state expected HTTP 200, got $($state.StatusCode)"
    Assert-Condition ($null -ne $stateJson.running) "/api/state missing running property"
    Write-Output "PASS /api/state"
}
catch {
    $failures += "/api/state request failed: $($_.Exception.Message)"
    Write-Output ("FAIL /api/state | {0}" -f $_.Exception.Message)
}

Write-Output "Checking bundled assets from /"

try {
    $index = Get-Page -Path "/"
    $indexHtml = [string]$index.Content

    $jsPath = [regex]::Match($indexHtml, 'src="(/assets/[^"]+\.js)"').Groups[1].Value
    $cssPath = [regex]::Match($indexHtml, 'href="(/assets/[^"]+\.css)"').Groups[1].Value

    Assert-Condition (-not [string]::IsNullOrWhiteSpace($jsPath)) "Could not find JS asset in index.html"
    Assert-Condition (-not [string]::IsNullOrWhiteSpace($cssPath)) "Could not find CSS asset in index.html"

    if (-not [string]::IsNullOrWhiteSpace($jsPath)) {
        $js = Get-Page -Path $jsPath
        Assert-Condition ($js.StatusCode -eq 200) "$jsPath expected HTTP 200, got $($js.StatusCode)"
        Write-Output ("PASS {0}" -f $jsPath)
    }

    if (-not [string]::IsNullOrWhiteSpace($cssPath)) {
        $css = Get-Page -Path $cssPath
        Assert-Condition ($css.StatusCode -eq 200) "$cssPath expected HTTP 200, got $($css.StatusCode)"
        Write-Output ("PASS {0}" -f $cssPath)
    }
}
catch {
    $failures += "Asset check failed: $($_.Exception.Message)"
    Write-Output ("FAIL assets | {0}" -f $_.Exception.Message)
}

if ($failures.Count -gt 0) {
    Write-Output ""
    Write-Output "React SPA smoke check FAILED"
    foreach ($failure in $failures) {
        Write-Output (" - {0}" -f $failure)
    }
    exit 1
}

Write-Output ""
Write-Output "React SPA smoke check PASSED"
exit 0
