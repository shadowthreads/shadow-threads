$ErrorActionPreference = 'Stop'

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RepoRoot = [System.IO.Path]::GetFullPath((Join-Path $ScriptDir '..\..'))
$ServerUrl = if ($env:SHADOW_SERVER) { $env:SHADOW_SERVER } else { 'http://localhost:3001' }
$TmpDir = Join-Path ([System.IO.Path]::GetTempPath()) ("shadow-demoB-" + [System.Guid]::NewGuid().ToString('N'))

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

New-Item -ItemType Directory -Path $TmpDir | Out-Null

try {
    Resolve-ShadowCli
    Push-Location $ScriptDir

    Write-Host 'Demo B: Deterministic Workflow Debugging'
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

    $workflowInputPath = Join-Path $TmpDir 'workflow-input.json'
    $workflowInput = [ordered]@{
        schema = 'demo.workflow.input'
        identity = [ordered]@{
            packageId = 'demo-debug-package'
        }
        payload = [ordered]@{
            workflow = 'deterministic debug demo'
            inputBatch = @(18, 21, 'oops', 34)
            expectedSteps = @('retrieve data', 'transform data', 'generate output')
        }
        references = @()
    }
    Write-Utf8File -Path $workflowInputPath -Content (($workflowInput | ConvertTo-Json -Depth 20) + "`n")

    Write-Host
    Write-Host 'Capturing the workflow input state'
    $inputCaptureOutput = Invoke-ShadowCliText capture $workflowInputPath
    Write-Host $inputCaptureOutput
    $inputBundleHash = Get-BundleHashFromCaptureOutput -Output $inputCaptureOutput

    Write-Host
    Write-Host 'Running the broken workflow'
    $failureReportPath = Join-Path $TmpDir 'failure-report.json'
    & python (Join-Path $ScriptDir 'broken_workflow.py') '--report-out' $failureReportPath
    $workflowExitCode = $LASTEXITCODE
    if ($workflowExitCode -eq 0) {
        throw 'The workflow unexpectedly succeeded.'
    }
    if ($workflowExitCode -ne 1) {
        throw "Broken workflow exited with unexpected code $workflowExitCode."
    }

    $failureArtifactPath = Join-Path $TmpDir 'failure-artifact.json'
    $failureReport = Get-Content -Raw -Path $failureReportPath | ConvertFrom-Json
    $failureArtifact = [ordered]@{
        schema = 'demo.workflow.failure'
        identity = [ordered]@{
            packageId = 'demo-debug-package'
        }
        payload = $failureReport
        references = @(
            [ordered]@{
                bundleHash = $inputBundleHash
                role = 'workflow_input'
            }
        )
    }
    Write-Utf8File -Path $failureArtifactPath -Content (($failureArtifact | ConvertTo-Json -Depth 20) + "`n")

    Write-Host
    Write-Host 'Capturing the failure report'
    $failureCaptureOutput = Invoke-ShadowCliText capture $failureArtifactPath
    Write-Host $failureCaptureOutput
    $failureBundleHash = Get-BundleHashFromCaptureOutput -Output $failureCaptureOutput

    $startedAt = (Get-Date).ToUniversalTime().ToString('o')
    $finishedAt = (Get-Date).ToUniversalTime().AddSeconds(2).ToString('o')

    $baseRevision = Invoke-ShadowApi -Path '/api/v1/revisions' -Payload @{
        packageId = 'demo-debug-package'
        parentRevisionHash = $null
        artifacts = @(
            @{
                bundleHash = $inputBundleHash
                role = 'workflow_input'
            }
        )
        metadata = @{
            author = 'Demo Author'
            message = 'Workflow input state captured before execution'
            createdBy = 'demoB-runner'
            timestamp = $startedAt
            source = 'human'
            tags = @('demo', 'debug')
        }
    }

    $failureRevision = Invoke-ShadowApi -Path '/api/v1/revisions' -Payload @{
        packageId = 'demo-debug-package'
        parentRevisionHash = $baseRevision.revisionHash
        artifacts = @(
            @{
                bundleHash = $inputBundleHash
                role = 'workflow_input'
            },
            @{
                bundleHash = $failureBundleHash
                role = 'failure_report'
            }
        )
        metadata = @{
            author = 'Shadow Threads Demo'
            message = 'Failed transform step recorded for debugging'
            createdBy = 'demoB-runner'
            timestamp = $finishedAt
            source = 'system'
            tags = @('demo', 'debug', 'failure')
        }
    }

    $execution = Invoke-ShadowApi -Path '/api/v1/executions' -Payload @{
        packageId = 'demo-debug-package'
        revisionHash = $failureRevision.revisionHash
        provider = 'demo-script'
        model = 'broken-workflow'
        promptHash = Get-Sha256Hex -Text 'demoB-debug-boundary'
        parameters = @{
            stageCount = 3
            failureStep = 2
        }
        inputArtifacts = @(
            @{
                bundleHash = $inputBundleHash
                role = 'workflow_input'
            }
        )
        outputArtifacts = @(
            @{
                bundleHash = $failureBundleHash
                role = 'failure_report'
            }
        )
        status = 'failure'
        startedAt = $startedAt
        finishedAt = $finishedAt
    }

    Write-Host
    Write-Host 'Inspecting the recorded execution history'
    $executionOutput = Invoke-ShadowCliText inspect execution $execution.executionId
    if ($executionOutput) {
        Write-Host $executionOutput
    }

    Write-Host
    Write-Host 'Replaying recorded execution boundary'
    $replayOutput = Invoke-ShadowCliText replay $execution.executionId
    if ($replayOutput) {
        Write-Host $replayOutput
    }
    Write-Host 'Replay verification matched the recorded failed execution boundary.'
} finally {
    Pop-Location -ErrorAction SilentlyContinue
    Remove-Item -Recurse -Force $TmpDir -ErrorAction SilentlyContinue
}
