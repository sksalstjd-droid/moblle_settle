param(
    [ValidateSet("Install", "Remove")]
    [string]$Action = "Install"
)

$ErrorActionPreference = "Stop"
$ProjectRoot = $PSScriptRoot
$RunScript = Join-Path $ProjectRoot "run-local.ps1"
$StartupFolder = [Environment]::GetFolderPath("Startup")
$ShortcutPath = Join-Path $StartupFolder "Mobile Settlement Dev Server.lnk"

if ($Action -eq "Remove") {
    if (Test-Path -LiteralPath $ShortcutPath) {
        Remove-Item -LiteralPath $ShortcutPath
        Write-Host "로그인 자동 실행을 해제했습니다."
    }
    else {
        Write-Host "등록된 로그인 자동 실행 항목이 없습니다."
    }
    exit 0
}

if (-not (Test-Path -LiteralPath $RunScript)) {
    throw "실행 스크립트를 찾을 수 없습니다: $RunScript"
}

$PowerShell = Join-Path $env:SystemRoot "System32\WindowsPowerShell\v1.0\powershell.exe"
if (-not (Test-Path -LiteralPath $PowerShell)) {
    throw "Windows PowerShell을 찾을 수 없습니다: $PowerShell"
}

$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut($ShortcutPath)
$shortcut.TargetPath = $PowerShell
$shortcut.Arguments = "-NoLogo -NoExit -ExecutionPolicy Bypass -File `"$RunScript`""
$shortcut.WorkingDirectory = $ProjectRoot
$shortcut.WindowStyle = 1
$shortcut.Description = "모바일 정산기 로컬 개발 서버"
$shortcut.Save()

Write-Host "로그인 자동 실행을 등록했습니다: $ShortcutPath"
Write-Host "로그인 시 서버 콘솔이 열립니다. 종료는 그 창에서 Ctrl+C를 누르세요."
