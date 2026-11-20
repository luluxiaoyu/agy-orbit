# Orbit · Windows CDP 快捷方式自动修补脚本
# 为 Antigravity 的快捷方式添加 --remote-debugging-port=0 参数，使输入框底栏遥测圆环能够正常挂载。
# 使用 -Undo 参数可撤销修改。

param(
    [switch]$Undo,
    [switch]$Silent,
    [string[]]$ShortcutDirectories = @(
        [Environment]::GetFolderPath('Desktop'),
        [Environment]::GetFolderPath('CommonDesktopDirectory'),
        [Environment]::GetFolderPath('StartMenu'),
        [Environment]::GetFolderPath('CommonStartMenu'),
        (Join-Path $env:APPDATA 'Microsoft\Internet Explorer\Quick Launch\User Pinned\TaskBar')
    )
)

$ErrorActionPreference = 'SilentlyContinue'
$switchName = '--remote-debugging-port'
$switchText = "$switchName=0"
$switchPattern = "(^|\s)$([regex]::Escape($switchName))(=\S*)?(?=\s|$)"
$shell = New-Object -ComObject WScript.Shell

$shortcuts = @(foreach ($directory in $ShortcutDirectories | Where-Object { $_ -and (Test-Path -LiteralPath $_) } | Select-Object -Unique) {
    foreach ($file in Get-ChildItem -LiteralPath $directory -Recurse -Filter *.lnk -ErrorAction SilentlyContinue) {
        $link = $null
        try { $link = $shell.CreateShortcut($file.FullName) } catch { continue }
        if ($link -and $link.TargetPath -and (Split-Path -Leaf $link.TargetPath) -eq 'Antigravity.exe') {
            [pscustomobject]@{ Path = $file.FullName; Link = $link; HasSwitch = ([string]$link.Arguments -match $switchPattern) }
        }
    }
})

if ($shortcuts.Count -eq 0) {
    if (-not $Silent) {
        Write-Host "[Orbit] 未找到 Antigravity 快捷方式。如果手动启动，请带上参数：Antigravity.exe $switchText" -ForegroundColor Yellow
    }
    exit 0
}

$updatedCount = 0

foreach ($shortcut in $shortcuts) {
    $arguments = [string]$shortcut.Link.Arguments
    if ($Undo) {
        if (-not $shortcut.HasSwitch) { continue }
        $next = ($arguments -replace $switchPattern, '').Trim()
    } else {
        if ($shortcut.HasSwitch) { continue }
        $next = "$arguments $switchText".Trim()
    }
    try {
        $shortcut.Link.Arguments = $next
        $shortcut.Link.Save()
        $updatedCount++
        if (-not $Silent) {
            Write-Host "[Orbit] 已成功更新快捷方式: $($shortcut.Path)" -ForegroundColor Green
        }
    } catch {
        if (-not $Silent) {
            Write-Host "[Orbit] 权限不足，无法修改（请以管理员身份重试）: $($shortcut.Path)" -ForegroundColor Red
        }
    }
}

if (-not $Silent) {
    if ($updatedCount -gt 0) {
        Write-Host "`n[Orbit] 共更新了 $updatedCount 个快捷方式！" -ForegroundColor Cyan
        Write-Host "[Orbit] 请完全退出 Antigravity，再重新双击桌面或开始菜单图标打开即可看到底栏圆环。" -ForegroundColor Cyan
    } else {
        Write-Host "`n[Orbit] 快捷方式均已配置完成，无需额外更改。" -ForegroundColor Green
    }
}

exit 0
