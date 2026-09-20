#Requires -Version 5.1
# Tests ONLY newly created empty files in a unique temporary directory.
# Does not access an installation, registry, processes, or account data.
[CmdletBinding()]
param([string]$OutputDirectory = [Environment]::GetFolderPath('Desktop'))
$ErrorActionPreference = 'Stop'
if ($env:OS -ne 'Windows_NT') { throw 'Run on Windows.' }
if (-not (Test-Path -LiteralPath $OutputDirectory -PathType Container)) { throw 'Output directory must exist.' }
Add-Type -TypeDefinition @'
using System;
using System.Text;
using System.Runtime.InteropServices;
public static class InsightPathProbe {
  [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)]
  public static extern IntPtr CreateFileW(string p, uint access, uint share, IntPtr security, uint disposition, uint flags, IntPtr template);
  [DllImport("kernel32.dll", SetLastError=true)]
  public static extern bool CloseHandle(IntPtr h);
  [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)]
  public static extern bool DeleteFileW(string p);
  [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)]
  public static extern bool MoveFileW(string from, string to);
  [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)]
  public static extern uint GetShortPathNameW(string p, StringBuilder output, uint size);
}
'@
$root = Join-Path $env:TEMP ('insight-path-probe-' + [guid]::NewGuid().ToString('N'))
$rows = New-Object System.Collections.ArrayList
$cleanupErrors = New-Object System.Collections.ArrayList
$created = New-Object System.Collections.ArrayList
$leaf = 'getchatcompletionfieldoptionscountsv1observabilitychatcompletionfieldsfieldnameoptionscountspost'
try {
  foreach ($length in @(259, 260, 261)) {
    foreach ($extension in @('js', 'ts')) {
      foreach ($mode in @('ordinary', 'extended', 'short')) {
        $base = Join-Path $root "$length-$extension-$mode"
        $padding = $length - $base.Length - $leaf.Length - $extension.Length - 3
        if ($padding -lt 1) { throw 'TEMP is too long for this fixture. No installation was touched.' }
        $parent = Join-Path $base (('p' * $padding) -join '')
        [void][IO.Directory]::CreateDirectory($parent)
        $file = Join-Path $parent ($leaf + '.' + $extension)
        if ($file.Length -ne $length) { throw 'Invalid fixture length.' }
        $extended = '\\?\' + $file
        $handle = [InsightPathProbe]::CreateFileW($extended, 0x40000000, 7, [IntPtr]::Zero, 1, 0x80, [IntPtr]::Zero)
        $createError = [Runtime.InteropServices.Marshal]::GetLastWin32Error()
        if ($handle -eq [IntPtr](-1)) { throw "Fixture creation failed: $createError" }
        [void][InsightPathProbe]::CloseHandle($handle)
        [void]$created.Add($extended)
        $source = $file
        if ($mode -eq 'extended') { $source = $extended }
        if ($mode -eq 'short') {
          $buffer = New-Object Text.StringBuilder 32768
          $size = [InsightPathProbe]::GetShortPathNameW($extended, $buffer, 32768)
          if ($size -eq 0 -or $size -ge 32768) {
            [void]$rows.Add([ordered]@{ Length=$length; Extension=$extension; Mode=$mode; Skipped='Short path unavailable' })
            continue
          }
          # Remove the extended prefix to test the alias itself.
          $source = $buffer.ToString().Substring(4)
        }
        $destination = Join-Path $base 'moved.tmp'
        [void]$created.Add(('\\?\' + $destination))
        $moved = [InsightPathProbe]::MoveFileW($source, $destination)
        $moveError = [Runtime.InteropServices.Marshal]::GetLastWin32Error()
        if ($moved) {
          if (-not [InsightPathProbe]::MoveFileW(('\\?\' + $destination), $extended)) { throw 'Fixture restore failed.' }
        }
        $deleted = [InsightPathProbe]::DeleteFileW($source)
        $deleteError = [Runtime.InteropServices.Marshal]::GetLastWin32Error()
        [void]$rows.Add([ordered]@{
          Length=$file.Length; Extension=$extension; Mode=$mode; EffectiveLength=$source.Length
          MoveSucceeded=$moved; MoveError=$(if ($moved) { 0 } else { $moveError })
          DeleteSucceeded=$deleted; DeleteError=$(if ($deleted) { 0 } else { $deleteError })
        })
      }
    }
  }
} catch {
  [void]$cleanupErrors.Add($_.Exception.Message)
} finally {
  foreach ($file in $created) { [void][InsightPathProbe]::DeleteFileW($file) }
  try { if ([IO.Directory]::Exists($root)) { [IO.Directory]::Delete($root, $true) } }
  catch { [void]$cleanupErrors.Add('Fixture cleanup: ' + $_.Exception.Message) }
  $output = Join-Path $OutputDirectory ('insight-path-probe-' + (Get-Date -Format 'yyyyMMdd-HHmmss') + '.json')
  [ordered]@{
    CollectedAt=(Get-Date).ToString('o'); FixtureRoot=$root
    Scope='Win32 API probe in PowerShell; NOT an NSIS upgrade acceptance test'
    Results=@($rows.ToArray()); Errors=@($cleanupErrors.ToArray())
  } | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $output -Encoding UTF8
  Write-Host "Report: $output"
}
