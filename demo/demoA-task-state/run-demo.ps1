$ErrorActionPreference = 'Stop'

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RepoRoot = [System.IO.Path]::GetFullPath((Join-Path $ScriptDir '..\..'))
$ServerUrl = if ($env:SHADOW_SERVER) { $env:SHADOW_SERVER } else { 'http://localhost:3001' }
$TmpDir = Join-Path ([System.IO.Path]::GetTempPath()) ("shadow-demoA-" + [System.Guid]::NewGuid().ToString('N'))

function Write-Utf8File {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Path,
        [Parameter(Mandatory = $true)]
        [string]$Content
    )

    $directory = Split-Path -Parent $Path
    if ($directory -and -not (Test-Path $directory)) {
        New-Item -ItemType Directory -Path $directory | Out-Null
    }

    $encoding = New-Object System.Text.UTF8Encoding($false)
    [System.IO.File]::WriteAllText($Path, $Content, $encoding)
}

function Resolve-ShadowCli {
    $shadowCommand = Get-Command shadow -ErrorAction SilentlyContinue
    if ($shadowCommand) {
        $script:UseInstalledShadow = $true
        return
    }

    $fallbackPath = Join-Path $RepoRoot 'cli\dist\index.js'
    if (Test-Path $fallbackPath) {
        $script:UseInstalledShadow = $false
        $script:ShadowCliPath = $fallbackPath
        return
    }

    throw 'Shadow CLI not found. Build the CLI first from cli/.'
}

function Invoke-ShadowCliText {
    param(
        [Parameter(ValueFromRemainingArguments = $true)]
        [string[]]$Arguments
    )

    if ($script:UseInstalledShadow) {
        $output = & shadow @Arguments 2>&1 | Out-String
    } else {
        $output = & node $script:ShadowCliPath @Arguments 2>&1 | Out-String
    }

    if ($LASTEXITCODE -ne 0) {
        throw $output.Trim()
    }

    return $output.TrimEnd("`r", "`n")
}

function Get-BundleHashFromCaptureOutput {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Output
    )

    $match = [regex]::Match($Output, 'bundleHash:\s*([0-9a-f]{64})')
    if (-not $match.Success) {
        throw 'bundleHash not found'
    }

    return $match.Groups[1].Value
}

function Invoke-ShadowApi {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Path,
        [Parameter(Mandatory = $true)]
        [object]$Payload
    )

    $uri = $ServerUrl.TrimEnd('/') + $Path
    $body = $Payload | ConvertTo-Json -Depth 20

    try {
        $response = Invoke-RestMethod -Method Post -Uri $uri -Headers @{ Accept = 'application/json' } -ContentType 'application/json' -Body $body
    } catch {
        throw "API request failed: $($_.Exception.Message)"
    }

    if (-not $response.ok) {
        throw "API request failed: $($response | ConvertTo-Json -Depth 20)"
    }

    return $response.data
}

function Get-Sha256Hex {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Text
    )

    $sha = [System.Security.Cryptography.SHA256]::Create()
    try {
        $bytes = [System.Text.Encoding]::UTF8.GetBytes($Text)
        return (($sha.ComputeHash($bytes) | ForEach-Object { $_.ToString('x2') }) -join '')
    } finally {
        $sha.Dispose()
    }
}

function Invoke-PythonChecked {
    param(
        [Parameter(ValueFromRemainingArguments = $true)]
        [string[]]$Arguments
    )

    & python @Arguments
    if ($LASTEXITCODE -ne 0) {
        throw "Python command failed with exit code $LASTEXITCODE."
    }
}

New-Item -ItemType Directory -Path $TmpDir | Out-Null

try {
    Resolve-ShadowCli
    Push-Location $ScriptDir

    Write-Host 'Demo A: Task State Management'
    Write-Host "Server: $ServerUrl"
    Write-Host
    Write-Host 'Initializing the demo workspace'
    $initOutput = Invoke-ShadowCliText init
    if ($initOutput) {
        Write-Host $initOutput
    }

    $configPath = Join-Path $ScriptDir 'shadow.config.json'
    $config = Get-Content -Raw -Path $configPath | ConvertFrom-Json
    $config.server = $ServerUrl
    Write-Utf8File -Path $configPath -Content (($config | ConvertTo-Json -Depth 10) + "`n")

    Write-Host
    Write-Host 'Capturing the starting task state'
    $artifactCaptureOutput = Invoke-ShadowCliText capture 'artifact.json'
    Write-Host $artifactCaptureOutput
    $taskBundleHash = Get-BundleHashFromCaptureOutput -Output $artifactCaptureOutput

    Write-Host
    Write-Host 'Running the task with visible progress'
    $workflowSummaryPath = Join-Path $TmpDir 'workflow-summary.json'
    Invoke-PythonChecked (Join-Path $ScriptDir 'workflow.py') '--json-out' $workflowSummaryPath

    $summaryArtifactPath = Join-Path $TmpDir 'summary-artifact.json'
    $summaryData = Get-Content -Raw -Path $workflowSummaryPath | ConvertFrom-Json
    $summaryArtifact = [ordered]@{
        schema = 'demo.task.summary'
        identity = [ordered]@{
            packageId = 'demo-package'
        }
        payload = $summaryData
        references = @(
            [ordered]@{
                bundleHash = $taskBundleHash
                role = 'source_task'
            }
        )
    }
    Write-Utf8File -Path $summaryArtifactPath -Content (($summaryArtifact | ConvertTo-Json -Depth 20) + "`n")

    Write-Host
    Write-Host 'Capturing the completed task state'
    $summaryCaptureOutput = Invoke-ShadowCliText capture $summaryArtifactPath
    Write-Host $summaryCaptureOutput
    $summaryBundleHash = Get-BundleHashFromCaptureOutput -Output $summaryCaptureOutput

    $startedAt = (Get-Date).ToUniversalTime().ToString('o')
    $finishedAt = (Get-Date).ToUniversalTime().AddSeconds(2).ToString('o')

    $initialRevision = Invoke-ShadowApi -Path '/api/v1/revisions' -Payload @{
        packageId = 'demo-package'
        parentRevisionHash = $null
        artifacts = @(
            @{
                bundleHash = $taskBundleHash
                role = 'task_state'
            }
        )
        metadata = @{
            author = 'Demo Author'
            message = 'Task state captured before workflow execution'
            createdBy = 'demoA-runner'
            timestamp = $startedAt
            source = 'human'
            tags = @('demo', 'task-state')
        }
    }

    $finalRevision = Invoke-ShadowApi -Path '/api/v1/revisions' -Payload @{
        packageId = 'demo-package'
        parentRevisionHash = $initialRevision.revisionHash
        artifacts = @(
            @{
                bundleHash = $taskBundleHash
                role = 'task_state'
            },
            @{
                bundleHash = $summaryBundleHash
                role = 'task_summary'
            }
        )
        metadata = @{
            author = 'Shadow Threads Demo'
            message = 'Task progress recorded after summary generation'
            createdBy = 'demoA-runner'
            timestamp = $finishedAt
            source = 'ai'
            tags = @('demo', 'task-state', 'history')
        }
    }

    $execution = Invoke-ShadowApi -Path '/api/v1/executions' -Payload @{
        packageId = 'demo-package'
        revisionHash = $finalRevision.revisionHash
        provider = 'demo-script'
        model = 'task-state-workflow'
        promptHash = Get-Sha256Hex -Text 'demoA-task-state-workflow'
        parameters = @{
            mode = 'demo'
            stepCount = 3
        }
        inputArtifacts = @(
            @{
                bundleHash = $taskBundleHash
                role = 'task_state'
            }
        )
        outputArtifacts = @(
            @{
                bundleHash = $summaryBundleHash
                role = 'task_summary'
            }
        )
        status = 'success'
        startedAt = $startedAt
        finishedAt = $finishedAt
    }

    Write-Host
    Write-Host 'History recorded for this task'
    Write-Host 'Inspecting the latest task revision'
    $revisionOutput = Invoke-ShadowCliText inspect revision $finalRevision.revisionHash
    if ($revisionOutput) {
        Write-Host $revisionOutput
    }

    Write-Host
    Write-Host 'Inspecting the execution history'
    $executionOutput = Invoke-ShadowCliText inspect execution $execution.executionId
    if ($executionOutput) {
        Write-Host $executionOutput
    }

    Write-Host
    Write-Host 'Replaying the recorded task execution boundary'
    $replayOutput = Invoke-ShadowCliText replay $execution.executionId
    if ($replayOutput) {
        Write-Host $replayOutput
    }
    Write-Host 'Replay verification matched the recorded task execution boundary.'
} finally {
    Pop-Location -ErrorAction SilentlyContinue
    Remove-Item -Recurse -Force $TmpDir -ErrorAction SilentlyContinue
}
