#Requires -Version 5.1

<#
.SYNOPSIS
Resets a broken Insight AI Windows installation before a clean reinstall.

.DESCRIPTION
Without -Apply, this script only reports what it would remove. With -Apply, it:
- stops Insight AI and updater process trees;
- removes current and legacy installation directories and updater caches;
- removes exact Insight AI shortcuts and installer registry records.

User data is preserved unless -PurgeUserData is also supplied. Development-build
artifacts are preserved unless -IncludeDevelopment is supplied.

.EXAMPLE
powershell.exe -ExecutionPolicy Bypass -File .\clean-windows-install.ps1

.EXAMPLE
powershell.exe -ExecutionPolicy Bypass -File .\clean-windows-install.ps1 -Apply

.EXAMPLE
powershell.exe -ExecutionPolicy Bypass -File .\clean-windows-install.ps1 -Apply -PurgeUserData
#>

[CmdletBinding()]
param(
  [switch]$Apply,
  [switch]$PurgeUserData,
  [switch]$IncludeDevelopment
)

Set-StrictMode -Version 2.0
$ErrorActionPreference = 'Stop'
$scriptVersion = '1.0.1'

if ($env:OS -ne 'Windows_NT') {
  throw 'This cleanup script must be run on Windows.'
}
foreach ($requiredEnvironmentVariable in @('LOCALAPPDATA', 'APPDATA', 'SystemRoot')) {
  if ([string]::IsNullOrWhiteSpace([Environment]::GetEnvironmentVariable($requiredEnvironmentVariable))) {
    throw "Required environment variable is missing: $requiredEnvironmentVariable"
  }
}

# Keep this file ASCII-only so Windows PowerShell 5.1 does not depend on its
# legacy source-file encoding when matching the Chinese product name.
$productName = [string]::Concat([char]0x56E0, [char]0x8D5B, 'AI')
$developmentProductName = "$productName Dev"
$productionDisplayNamePattern = '^' + [regex]::Escape($productName) + '(?:\s+\d.*)?$'
$developmentDisplayNamePattern = '^' + [regex]::Escape($developmentProductName) + '(?:\s+\d.*)?$'
$productionUninstallerPattern = '(?i)[\\/]insight-desktop(?:-candidate)?[\\/]Uninstall ' + [regex]::Escape($productName) + '\.exe'
$developmentUninstallerPattern = '(?i)[\\/]insight-desktop-dev[\\/]Uninstall ' + [regex]::Escape($developmentProductName) + '\.exe'

$productionGuids = @(
  # com.insight-aigc.desktop (current RC3+ identity)
  '3f22a924-0492-54e4-a8a2-dc8902eed971',
  # Historical internal identities
  'a4b3c61f-1084-536f-8651-426d63588ad7',
  'a9ccf146-0005-5069-b5ad-051c8ea31542',
  'bd4049ec-00cd-5ef9-905d-7a28e0e3e2f5'
)
$developmentGuids = @(
  '938b9620-2f4e-5a12-808e-ee99e9633219',
  'be63aeed-d438-55a1-84ce-407a833fd229'
)

function Write-Section {
  param([Parameter(Mandatory = $true)][string]$Message)
  Write-Host "`n== $Message ==" -ForegroundColor Cyan
}

function Add-UniquePath {
  param(
    [Parameter(Mandatory = $true)][AllowEmptyCollection()][System.Collections.Generic.List[string]]$List,
    [AllowEmptyString()][string]$Path
  )

  if ([string]::IsNullOrWhiteSpace($Path)) { return }
  $expanded = [Environment]::ExpandEnvironmentVariables($Path.Trim().Trim('"'))
  try {
    $fullPath = [IO.Path]::GetFullPath($expanded).TrimEnd('\')
  } catch {
    Write-Warning "Ignored invalid path: $Path"
    return
  }

  $root = [IO.Path]::GetPathRoot($fullPath)
  if ([string]::IsNullOrWhiteSpace($root) -or $fullPath -eq $root.TrimEnd('\')) {
    Write-Warning "Refused unsafe root path: $fullPath"
    return
  }

  foreach ($existing in $List) {
    if ($existing.Equals($fullPath, [StringComparison]::OrdinalIgnoreCase)) { return }
  }
  $List.Add($fullPath)
}

function Get-UninstallerPath {
  param([AllowEmptyString()][string]$Command)

  if ([string]::IsNullOrWhiteSpace($Command)) { return $null }
  if ($Command -match '^\s*"([^"]+)"') { return $Matches[1] }
  if ($Command -match '^\s*([^\s]+\.exe)') { return $Matches[1] }
  return $null
}

function Add-RegisteredInstallDirectory {
  param(
    [Parameter(Mandatory = $true)][AllowEmptyCollection()][System.Collections.Generic.List[string]]$List,
    [AllowEmptyString()][string]$Path
  )

  if ([string]::IsNullOrWhiteSpace($Path)) { return }
  $expanded = [Environment]::ExpandEnvironmentVariables($Path.Trim().Trim('"'))
  try {
    $fullPath = [IO.Path]::GetFullPath($expanded).TrimEnd('\')
  } catch {
    Write-Warning "Ignored invalid registered installation path: $Path"
    return
  }

  if (-not (Test-Path -LiteralPath $fullPath)) { return }
  $hasProductMarker = (
    (Test-Path -LiteralPath (Join-Path $fullPath "$productName.exe")) -or
    (Test-Path -LiteralPath (Join-Path $fullPath "Uninstall $productName.exe")) -or
    ($IncludeDevelopment -and (
      (Test-Path -LiteralPath (Join-Path $fullPath "$developmentProductName.exe")) -or
      (Test-Path -LiteralPath (Join-Path $fullPath "Uninstall $developmentProductName.exe"))
    ))
  )
  if (-not $hasProductMarker) {
    Write-Warning "Ignored registered path without an Insight AI executable: $fullPath"
    return
  }
  Add-UniquePath -List $List -Path $fullPath
}

function Get-StringProperty {
  param(
    [Parameter(Mandatory = $true)][object]$InputObject,
    [Parameter(Mandatory = $true)][string]$Name
  )

  $property = $InputObject.PSObject.Properties[$Name]
  if ($null -eq $property -or $null -eq $property.Value) { return '' }
  return [string]$property.Value
}

function Get-InsightUninstallRecords {
  $roots = @(
    'Registry::HKEY_CURRENT_USER\Software\Microsoft\Windows\CurrentVersion\Uninstall',
    'Registry::HKEY_LOCAL_MACHINE\Software\Microsoft\Windows\CurrentVersion\Uninstall',
    'Registry::HKEY_LOCAL_MACHINE\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall'
  )

  $records = New-Object System.Collections.Generic.List[object]
  foreach ($root in $roots) {
    if (-not (Test-Path -LiteralPath $root)) { continue }
    foreach ($key in Get-ChildItem -LiteralPath $root -ErrorAction SilentlyContinue) {
      $value = Get-ItemProperty -LiteralPath $key.PSPath -ErrorAction SilentlyContinue
      if ($null -eq $value) { continue }
      $displayName = Get-StringProperty -InputObject $value -Name 'DisplayName'
      $uninstallString = Get-StringProperty -InputObject $value -Name 'UninstallString'
      $isProductionRecord = $displayName -match $productionDisplayNamePattern
      $isDevelopmentRecord = $displayName -match $developmentDisplayNamePattern
      $isProductionUninstaller = $uninstallString -match $productionUninstallerPattern
      $isDevelopmentUninstaller = $uninstallString -match $developmentUninstallerPattern
      if ($isProductionRecord -or $isProductionUninstaller -or
        ($IncludeDevelopment -and ($isDevelopmentRecord -or $isDevelopmentUninstaller))) {
        $records.Add([PSCustomObject]@{
          RegistryPath = $key.PSPath
          DisplayName = $displayName
          InstallLocation = Get-StringProperty -InputObject $value -Name 'InstallLocation'
          UninstallString = $uninstallString
        })
      }
    }
  }
  return $records
}

function Test-PathUnderRoot {
  param(
    [Parameter(Mandatory = $true)][string]$Path,
    [Parameter(Mandatory = $true)][string]$Root
  )

  $normalizedPath = $Path.TrimEnd('\')
  $normalizedRoot = $Root.TrimEnd('\')
  return (
    $normalizedPath.Equals($normalizedRoot, [StringComparison]::OrdinalIgnoreCase) -or
    $normalizedPath.StartsWith($normalizedRoot + '\', [StringComparison]::OrdinalIgnoreCase)
  )
}

function Get-TargetProcesses {
  param([Parameter(Mandatory = $true)][AllowEmptyCollection()][System.Collections.Generic.List[string]]$Roots)

  $targets = New-Object System.Collections.Generic.List[object]
  foreach ($process in Get-CimInstance -ClassName Win32_Process -ErrorAction SilentlyContinue) {
    $path = [string]$process.ExecutablePath
    $name = [string]$process.Name
    $matchesRoot = $false
    if (-not [string]::IsNullOrWhiteSpace($path)) {
      foreach ($root in $Roots) {
        if (Test-PathUnderRoot -Path $path -Root $root) {
          $matchesRoot = $true
          break
        }
      }
    }

    $isInstaller = $name -match '^insight-.*-windows-.*-setup\.exe$'
    $isDevelopmentInstaller = $name -match '^insight-dev-'
    $matchesFallbackName = (
      $name -eq "$productName.exe" -or
      ($IncludeDevelopment -and $name -eq "$developmentProductName.exe") -or
      ($isInstaller -and ($IncludeDevelopment -or -not $isDevelopmentInstaller))
    )
    if ($matchesRoot -or $matchesFallbackName) { $targets.Add($process) }
  }
  return $targets
}

function Stop-TargetProcesses {
  param([Parameter(Mandatory = $true)][AllowEmptyCollection()][System.Collections.Generic.List[string]]$Roots)

  for ($attempt = 1; $attempt -le 3; $attempt++) {
    $targets = @(Get-TargetProcesses -Roots $Roots)
    if ($targets.Count -eq 0) { return }
    foreach ($target in $targets) {
      Write-Host "Stopping PID $($target.ProcessId): $($target.Name)"
      if ($Apply) {
        $taskKillOptions = @{
          FilePath = "$env:SystemRoot\System32\taskkill.exe"
          ArgumentList = @('/PID', [string]$target.ProcessId, '/T', '/F')
          WindowStyle = 'Hidden'
          Wait = $true
          PassThru = $true
        }
        $taskKill = Start-Process @taskKillOptions
        if ($taskKill.ExitCode -ne 0) {
          Write-Warning "taskkill returned $($taskKill.ExitCode) for PID $($target.ProcessId); it may already have exited."
        }
      }
    }
    if (-not $Apply) { return }
    Start-Sleep -Milliseconds 600
  }
}

function Remove-TargetPath {
  param(
    [Parameter(Mandatory = $true)][string]$Path,
    [Parameter(Mandatory = $true)][string]$Kind
  )

  if (-not (Test-Path -LiteralPath $Path)) { return }
  if ($Apply) {
    Write-Host "Removing ${Kind}: $Path"
    Remove-Item -LiteralPath $Path -Recurse -Force
  } else {
    Write-Host "Would remove ${Kind}: $Path"
  }
}

$uninstallRecords = @(Get-InsightUninstallRecords)
$installDirectories = New-Object System.Collections.Generic.List[string]
$updaterDirectories = New-Object System.Collections.Generic.List[string]
$userDataDirectories = New-Object System.Collections.Generic.List[string]
$shortcutPaths = New-Object System.Collections.Generic.List[string]

Add-UniquePath -List $installDirectories -Path "$env:LOCALAPPDATA\Programs\insight-desktop"
Add-UniquePath -List $installDirectories -Path "$env:LOCALAPPDATA\Programs\insight-desktop-candidate"
Add-UniquePath -List $installDirectories -Path "$env:LOCALAPPDATA\Programs\$productName"
if (-not [string]::IsNullOrWhiteSpace($env:ProgramFiles)) {
  Add-UniquePath -List $installDirectories -Path "$env:ProgramFiles\insight-desktop"
}
$programFilesX86 = [Environment]::GetEnvironmentVariable('ProgramFiles(x86)')
if (-not [string]::IsNullOrWhiteSpace($programFilesX86)) {
  Add-UniquePath -List $installDirectories -Path "$programFilesX86\insight-desktop"
}

foreach ($record in $uninstallRecords) {
  if (-not [string]::IsNullOrWhiteSpace($record.InstallLocation)) {
    Add-RegisteredInstallDirectory -List $installDirectories -Path $record.InstallLocation
  }
  $uninstallerPath = Get-UninstallerPath -Command $record.UninstallString
  if (-not [string]::IsNullOrWhiteSpace($uninstallerPath)) {
    Add-RegisteredInstallDirectory -List $installDirectories -Path (Split-Path -Path $uninstallerPath -Parent)
  }
}

Add-UniquePath -List $updaterDirectories -Path "$env:LOCALAPPDATA\insight-desktop-updater"
Add-UniquePath -List $updaterDirectories -Path "$env:LOCALAPPDATA\insight-desktop-candidate-updater"
if ($IncludeDevelopment) {
  Add-UniquePath -List $installDirectories -Path "$env:LOCALAPPDATA\Programs\insight-desktop-dev"
  Add-UniquePath -List $updaterDirectories -Path "$env:LOCALAPPDATA\insight-desktop-dev-updater"
}

Add-UniquePath -List $userDataDirectories -Path "$env:APPDATA\insight-desktop"
Add-UniquePath -List $userDataDirectories -Path "$env:LOCALAPPDATA\insight-desktop"
Add-UniquePath -List $userDataDirectories -Path "$env:APPDATA\$productName"
Add-UniquePath -List $userDataDirectories -Path "$env:LOCALAPPDATA\$productName"
Add-UniquePath -List $userDataDirectories -Path "$env:APPDATA\insight-desktop-candidate"
Add-UniquePath -List $userDataDirectories -Path "$env:LOCALAPPDATA\insight-desktop-candidate"
if ($IncludeDevelopment) {
  Add-UniquePath -List $userDataDirectories -Path "$env:APPDATA\insight-desktop-dev"
  Add-UniquePath -List $userDataDirectories -Path "$env:LOCALAPPDATA\insight-desktop-dev"
}

$shortcutNames = @("$productName.lnk")
if ($IncludeDevelopment) { $shortcutNames += "$developmentProductName.lnk" }
$shortcutRoots = @(
  [Environment]::GetFolderPath('Desktop'),
  "$env:PUBLIC\Desktop",
  "$env:APPDATA\Microsoft\Windows\Start Menu\Programs",
  "$env:ProgramData\Microsoft\Windows\Start Menu\Programs"
)
foreach ($root in $shortcutRoots) {
  if ([string]::IsNullOrWhiteSpace($root)) { continue }
  foreach ($name in $shortcutNames) {
    Add-UniquePath -List $shortcutPaths -Path (Join-Path $root $name)
  }
}

$processRoots = New-Object System.Collections.Generic.List[string]
foreach ($path in $installDirectories) { Add-UniquePath -List $processRoots -Path $path }
foreach ($path in $updaterDirectories) { Add-UniquePath -List $processRoots -Path $path }

Write-Host "Insight AI Windows installation reset v$scriptVersion" -ForegroundColor White
if ($Apply) {
  Write-Host 'Mode: APPLY (files and registry records will be removed)' -ForegroundColor Yellow
} else {
  Write-Host 'Mode: REPORT ONLY (run again with -Apply to make changes)' -ForegroundColor Yellow
}
if ($PurgeUserData) {
  Write-Host 'User data: REMOVE' -ForegroundColor Red
} else {
  Write-Host 'User data: PRESERVE' -ForegroundColor Green
}

Write-Section 'Stop application and updater process trees'
Stop-TargetProcesses -Roots $processRoots

Write-Section 'Remove installation and updater remnants'
foreach ($path in $installDirectories) { Remove-TargetPath -Path $path -Kind 'installation directory' }
foreach ($path in $updaterDirectories) { Remove-TargetPath -Path $path -Kind 'updater cache' }
foreach ($path in $shortcutPaths) { Remove-TargetPath -Path $path -Kind 'shortcut' }
if ($PurgeUserData) {
  foreach ($path in $userDataDirectories) { Remove-TargetPath -Path $path -Kind 'user data' }
}

Write-Section 'Remove installer registry records'
foreach ($record in $uninstallRecords) {
  if ($Apply) {
    Write-Host "Removing registry record: $($record.RegistryPath) [$($record.DisplayName)]"
    Remove-Item -LiteralPath $record.RegistryPath -Recurse -Force -ErrorAction Continue
  } else {
    Write-Host "Would remove registry record: $($record.RegistryPath) [$($record.DisplayName)]"
  }
}

$guids = @($productionGuids)
if ($IncludeDevelopment) { $guids += $developmentGuids }
foreach ($guid in $guids) {
  $knownRegistryPaths = @(
    "Registry::HKEY_CURRENT_USER\Software\$guid",
    "Registry::HKEY_LOCAL_MACHINE\Software\$guid",
    "Registry::HKEY_LOCAL_MACHINE\Software\WOW6432Node\$guid",
    "Registry::HKEY_CURRENT_USER\Software\Microsoft\Windows\CurrentVersion\Uninstall\$guid",
    "Registry::HKEY_LOCAL_MACHINE\Software\Microsoft\Windows\CurrentVersion\Uninstall\$guid",
    "Registry::HKEY_LOCAL_MACHINE\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\$guid"
  )
  foreach ($path in $knownRegistryPaths) {
    if (-not (Test-Path -LiteralPath $path)) { continue }
    if ($Apply) {
      Write-Host "Removing known installer key: $path"
      Remove-Item -LiteralPath $path -Recurse -Force -ErrorAction Continue
    } else {
      Write-Host "Would remove known installer key: $path"
    }
  }
}

if (-not $Apply) {
  Write-Host "`nNo changes were made. Re-run with -Apply after reviewing the list." -ForegroundColor Yellow
  exit 0
}

Write-Section 'Verify cleanup'
$remainingProcesses = @(Get-TargetProcesses -Roots $processRoots)
$remainingPaths = @()
foreach ($path in @($installDirectories) + @($updaterDirectories)) {
  if (Test-Path -LiteralPath $path) { $remainingPaths += $path }
}
$remainingRecords = @(Get-InsightUninstallRecords)

if ($remainingProcesses.Count -gt 0 -or $remainingPaths.Count -gt 0 -or $remainingRecords.Count -gt 0) {
  foreach ($process in $remainingProcesses) {
    Write-Host "Remaining process: PID $($process.ProcessId) $($process.Name) $($process.ExecutablePath)" -ForegroundColor Red
  }
  foreach ($path in $remainingPaths) {
    Write-Host "Remaining path: $path" -ForegroundColor Red
  }
  foreach ($record in $remainingRecords) {
    Write-Host "Remaining installer record: $($record.RegistryPath) [$($record.DisplayName)]" -ForegroundColor Red
  }
  $failureSummary = 'Cleanup is incomplete. Remaining processes: {0}; paths: {1}; installer records: {2}.' -f $remainingProcesses.Count, $remainingPaths.Count, $remainingRecords.Count
  Write-Error "$failureSummary Restart Windows, then run this script with -Apply again before reinstalling."
  exit 1
}

Write-Host "`nCleanup completed. Restart Windows before installing the latest candidate." -ForegroundColor Green
