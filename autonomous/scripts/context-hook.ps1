# Windows wrapper for the lifecycle context hook.
#
# Resolves the repository from this file's own location, prefers a project-local
# Node 22 under .tools\ when one exists, and otherwise uses node from PATH.
# Every failure writes a note to stderr, "{}" to stdout, and exits 0, so a
# broken hook can never stop a session.

param(
    [ValidateSet('run', 'render')]
    [string]$Mode = 'run'
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

function Exit-FailOpen {
    param([string]$Reason)
    [Console]::Error.WriteLine("context hook: $Reason")
    [Console]::Out.WriteLine('{}')
    exit 0
}

try {
    $root = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
    $hookScript = Join-Path $root 'scripts\context-hook.mjs'
    if (-not [IO.File]::Exists($hookScript)) {
        Exit-FailOpen 'scripts\context-hook.mjs is missing'
    }

    $node = $null
    $localNodes = @(Get-ChildItem -Path (Join-Path $root '.tools') -Filter 'node.exe' -Recurse -ErrorAction SilentlyContinue | Select-Object -First 1)
    if ($localNodes.Count -gt 0) {
        $node = $localNodes[0].FullName
    }
    else {
        $command = Get-Command node -ErrorAction SilentlyContinue
        if ($null -ne $command) { $node = $command.Source }
    }
    if ($null -eq $node) { Exit-FailOpen 'no Node runtime is available' }

    $version = & $node --version 2>$null
    if ($LASTEXITCODE -ne 0) { Exit-FailOpen 'the Node runtime could not start' }
    if ($version -notmatch '^v(2[2-9]|[3-9][0-9])\.') {
        Exit-FailOpen "Node 22 or newer is required; found $version"
    }

    & $node $hookScript $Mode
    if ($null -eq $LASTEXITCODE) { exit 0 }
    exit $LASTEXITCODE
}
catch {
    Exit-FailOpen $_.Exception.Message
}
