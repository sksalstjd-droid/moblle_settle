param(
    [int]$Port = 5000
)

$ErrorActionPreference = "Stop"
$ProjectRoot = $PSScriptRoot
$env:HOST = "0.0.0.0"

if (-not (Test-Path -LiteralPath (Join-Path $ProjectRoot "app.py"))) {
    throw "app.py를 찾을 수 없습니다: $ProjectRoot"
}

$portAvailable = $true
$probe = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Any, $Port)
try {
    $probe.Start()
}
catch [System.Net.Sockets.SocketException] {
    $portAvailable = $false
}
finally {
    $probe.Stop()
    $probe.Dispose()
}

if (-not $portAvailable) {
    Write-Host "포트 $Port 를 이미 사용 중입니다. 기존 프로세스는 종료하지 않습니다."
    $listeners = @(netstat -ano -p tcp | Select-String -Pattern "^\s*TCP\s+\S+:$Port\s+\S+\s+LISTENING\s+(\d+)\s*$")
    foreach ($line in $listeners) {
        $processId = [int]$line.Matches[0].Groups[1].Value
        Write-Host "PID: $processId"
        try {
            $processInfo = Get-Process -Id $processId -ErrorAction Stop
            Write-Host "프로세스: $($processInfo.ProcessName)"
            if ($processInfo.Path) {
                Write-Host "실행 파일: $($processInfo.Path)"
            }
        }
        catch {
            Write-Host "프로세스 이름을 읽을 수 없습니다. 작업 관리자에서 PID를 확인하세요."
        }
    }
    if ($listeners.Count -eq 0) {
        Write-Host "점유 PID를 확인할 수 없습니다. netstat -ano 명령으로 직접 확인하세요."
    }
    throw "다른 포트를 선택하거나 표시된 프로세스를 직접 확인 후 종료하세요."
}

Set-Location -LiteralPath $ProjectRoot
$env:PORT = [string]$Port
$env:FLASK_DEBUG = "0"
python -B app.py
