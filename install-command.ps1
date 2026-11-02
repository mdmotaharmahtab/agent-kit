[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$userRoot = if ($env:AIKIT_HOME) { $env:AIKIT_HOME } else { [Environment]::GetFolderPath('UserProfile') }
$commandRoot = Join-Path $userRoot '.local\bin'
$commandSource = Join-Path $repoRoot 'aisync-inst.cmd'
$commandPath = Join-Path $commandRoot 'aisync-inst.cmd'

if (-not (Test-Path -LiteralPath $commandRoot)) {
    New-Item -ItemType Directory -Path $commandRoot -Force | Out-Null
}

$sourceBytes = [IO.File]::ReadAllBytes($commandSource)
$needsCopy = -not (Test-Path -LiteralPath $commandPath)
if (-not $needsCopy) {
    $destinationBytes = [IO.File]::ReadAllBytes($commandPath)
    $needsCopy = [Convert]::ToBase64String($sourceBytes) -cne
        [Convert]::ToBase64String($destinationBytes)
}

if ($needsCopy) {
    [IO.File]::WriteAllBytes($commandPath, $sourceBytes)
    Write-Host "Installed manual sync shortcut: $commandPath"
}

# Read the user PATH as stored, so entries such as %JAVA_HOME%\bin stay references instead of being saved expanded.
$environmentKey = [Microsoft.Win32.Registry]::CurrentUser.OpenSubKey('Environment', $true)
$userPath = [string]$environmentKey.GetValue('Path', '', [Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames)
$pathEntries = @($userPath -split ';' | Where-Object { -not [string]::IsNullOrWhiteSpace($_) })
if ($env:AIKIT_HOME) {
    # A test home: never change the real user PATH.
} elseif (@($pathEntries | ForEach-Object { [Environment]::ExpandEnvironmentVariables($_).TrimEnd('\') }) -notcontains $commandRoot) {
    $environmentKey.SetValue('Path', (($pathEntries + $commandRoot) -join ';'), [Microsoft.Win32.RegistryValueKind]::ExpandString)
    # Setting any user variable through .NET tells running programs (Explorer, new terminals) that PATH changed.
    [Environment]::SetEnvironmentVariable('AIKIT_PATH_REFRESH', '1', 'User')
    [Environment]::SetEnvironmentVariable('AIKIT_PATH_REFRESH', $null, 'User')
    Write-Host 'Added the shortcut directory to the user PATH. Open a new terminal before using aisync-inst.'
}
$environmentKey.Close()
