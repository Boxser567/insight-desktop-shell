#Requires -Version 5.1
<# Read-only update diagnostics. Does not stop processes, uninstall, change ACLs,
   edit registry values, or read account/session contents. Only writes the report. #>
[CmdletBinding()]
param(
  [string]$InstallDirectory = '',
  [string]$OutputDirectory = [Environment]::GetFolderPath('Desktop')
)
$ErrorActionPreference = 'Stop'
if ($env:OS -ne 'Windows_NT') { throw 'Run this script on Windows.' }
$product = [string]::Concat([char]0x56E0, [char]0x8D5B, 'AI')
$guids = @('3f22a924-0492-54e4-a8a2-dc8902eed971', 'a4b3c61f-1084-536f-8651-426d63588ad7', 'a9ccf146-0005-5069-b5ad-051c8ea31542', 'bd4049ec-00cd-5ef9-905d-7a28e0e3e2f5')
$errors = New-Object System.Collections.ArrayList
$registrations = New-Object System.Collections.ArrayList
$roots = New-Object System.Collections.ArrayList
if ($InstallDirectory) { [void]$roots.Add([IO.Path]::GetFullPath($InstallDirectory)) }
$uninstallKey = 'SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall'
foreach ($hive in @('CurrentUser', 'LocalMachine')) {
  foreach ($view in @('Registry64', 'Registry32')) {
    $base = $null; $uninstall = $null
    try {
      $base = [Microsoft.Win32.RegistryKey]::OpenBaseKey([Microsoft.Win32.RegistryHive]$hive, [Microsoft.Win32.RegistryView]$view)
      $uninstall = $base.OpenSubKey($uninstallKey)
      if ($uninstall) {
        foreach ($name in $uninstall.GetSubKeyNames()) {
          $key = $uninstall.OpenSubKey($name)
          try {
            $display = [string]$key.GetValue('DisplayName')
            if (($guids -notcontains $name.Trim('{}')) -and ($display -notmatch ([regex]::Escape($product) + '|^Insight AI'))) { continue }
            $location = [string]$key.GetValue('InstallLocation')
            $command = [string]$key.GetValue('UninstallString')
            [void]$registrations.Add([ordered]@{ Hive=$hive; View=$view; Key=$name; DisplayName=$display; DisplayVersion=$key.GetValue('DisplayVersion'); InstallLocation=$location; UninstallString=$command })
            if ($location) { [void]$roots.Add($location) }
            if ($command -match '^"([^"]+)"') { [void]$roots.Add([IO.Path]::GetDirectoryName($Matches[1])) }
          } finally { if ($key) { $key.Close() } }
        }
      }
      foreach ($guid in $guids) {
        $key = $base.OpenSubKey('SOFTWARE\' + $guid)
        if ($key) {
          try {
            $location = [string]$key.GetValue('InstallLocation')
            if ($location) {
              [void]$roots.Add($location)
              [void]$registrations.Add([ordered]@{ Hive=$hive; View=$view; Key=('SOFTWARE\'+$guid); InstallLocation=$location })
            }
          } finally { $key.Close() }
        }
      }
    } catch { [void]$errors.Add("Registry $hive/$view : $($_.Exception.Message)") }
    finally { if ($uninstall) { $uninstall.Close() }; if ($base) { $base.Close() } }
  }
}
$roots = @($roots | Where-Object { $_ } | ForEach-Object { [Environment]::ExpandEnvironmentVariables($_).TrimEnd('\') } | Sort-Object -Unique)
function Read-BinaryInfo([string]$Path) {
  try {
    $item = Get-Item -LiteralPath $Path
    $version = $item.VersionInfo
    return [ordered]@{ Path=$item.FullName; Length=$item.Length; LastWriteTimeUtc=$item.LastWriteTimeUtc; FileVersion=$version.FileVersion; ProductVersion=$version.ProductVersion; Sha256=(Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash }
  } catch { return [ordered]@{ Path=$Path; Error=$_.Exception.Message } }
}
$installations = @($roots | ForEach-Object {
  $root = $_
  $result = [ordered]@{ Path=$root; Exists=(Test-Path -LiteralPath $root); Drive=[IO.Path]::GetPathRoot($root) }
  if ($result.Exists) {
    try { $acl=Get-Acl -LiteralPath $root; $result.Owner=$acl.Owner; $result.Sddl=$acl.Sddl } catch { $result.AclError=$_.Exception.Message }
    $result.Binaries = @((Join-Path $root ($product+'.exe')), (Join-Path $root ('Uninstall '+$product+'.exe')) | ForEach-Object { Read-BinaryInfo $_ })
    $manifest = Join-Path $root 'resources\app\package.json'
    if (Test-Path -LiteralPath $manifest) {
      try { $value=Get-Content -LiteralPath $manifest -Raw -Encoding UTF8 | ConvertFrom-Json; $result.AppVersion=$value.version; $result.Channel=$value.insightDesktopChannel } catch { $result.ManifestError=$_.Exception.Message }
    }
  }
  $result
})
$processes = @(); $unknownPaths = 0
try {
  $all = @(Get-CimInstance Win32_Process -ErrorAction Stop)
  $unknownPaths = @($all | Where-Object { -not $_.ExecutablePath }).Count
  $processes = @($all | Where-Object {
    $p=$_; $match=($p.Name -like ('*'+$product+'*') -or $p.Name -match '^(old-uninstaller\.exe|insight-.*setup\.exe)$')
    foreach ($root in $roots) { if ($p.ExecutablePath -and $p.ExecutablePath.StartsWith($root+'\', [StringComparison]::OrdinalIgnoreCase)) { $match=$true } }
    $match
  } | ForEach-Object {
    # Do not collect general process command lines: Harness arguments can contain tokens.
    $entry=[ordered]@{ Pid=$_.ProcessId; ParentPid=$_.ParentProcessId; Name=$_.Name; ExecutablePath=$_.ExecutablePath; Created=$_.CreationDate }
    if ($_.Name -match '^(old-uninstaller\.exe|insight-.*setup\.exe)$' -or $_.Name -like ('Uninstall '+$product+'*')) { $entry.InstallerArguments=$_.CommandLine }
    $entry
  })
} catch { [void]$errors.Add('Process query: '+$_.Exception.Message) }
$pending = @()
foreach ($name in @('insight-desktop-updater', 'insight-desktop-candidate-updater')) {
  $directory = Join-Path $env:LOCALAPPDATA ($name+'\pending')
  if (Test-Path -LiteralPath $directory) {
    $pending += @(Get-ChildItem -LiteralPath $directory -Filter '*.exe' -File | ForEach-Object { Read-BinaryInfo $_.FullName })
  }
}
# Include recent installer logs without requiring Procmon or a working client.
$installerLogs = @()
$logDirectory = Join-Path $env:TEMP 'insight-desktop-update-logs'
try {
 if (Test-Path -LiteralPath $logDirectory) {
  $installerLogs = @(Get-ChildItem -LiteralPath $logDirectory -Filter 'update-*.log' -File |
    Sort-Object LastWriteTimeUtc -Descending | Select-Object -First 20 | ForEach-Object {
      [ordered]@{ Name=$_.Name; LastWriteTimeUtc=$_.LastWriteTimeUtc; Content=@(Get-Content -LiteralPath $_.FullName -Encoding Unicode -Tail 500) }
    })
 }
} catch { [void]$errors.Add('Installer logs: '+$_.Exception.Message) }
$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$principal = New-Object Security.Principal.WindowsPrincipal($identity)
$report = [ordered]@{
  SchemaVersion=2; CollectedAt=(Get-Date).ToString('o'); PowerShell=$PSVersionTable.PSVersion.ToString(); Windows=[Environment]::OSVersion.VersionString
  Elevated=$principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator); Is64BitProcess=[Environment]::Is64BitProcess
  Temp=$env:TEMP; TempDrive=[IO.Path]::GetPathRoot($env:TEMP); ExecutionPolicies=@(Get-ExecutionPolicy -List | Select-Object Scope,ExecutionPolicy)
  InstallerLogDirectory=$logDirectory; InstallerLogs=$installerLogs
  Registrations=@($registrations.ToArray()); Installations=$installations; Processes=$processes; ProcessesWithUnavailablePaths=$unknownPaths; PendingInstallers=$pending; Errors=@($errors.ToArray())
}
if (-not (Test-Path -LiteralPath $OutputDirectory -PathType Container)) { throw 'OutputDirectory must already exist.' }
$output = Join-Path $OutputDirectory ('insight-update-diagnostic-'+(Get-Date -Format 'yyyyMMdd-HHmmss')+'.json')
$report | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $output -Encoding UTF8
Write-Host "Read-only diagnostics saved to: $output"
Write-Host 'Send this JSON report while preserving the installer failure screen.'
