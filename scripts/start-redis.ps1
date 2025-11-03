param(
    [int]$Port = 6379,
    [string]$ContainerName = "dev-redis",
    [string]$DataDirectory = "$PSScriptRoot/../infra/redis-data"
)

function Convert-ToDockerPath {
    param([string]$Path)
    $resolved = (Resolve-Path -Path $Path).ProviderPath
    $normalized = $resolved -replace '\\', '/'
    if ($normalized -match '^[A-Za-z]:') {
        $drive = $normalized.Substring(0, 1).ToLower()
        return "/$drive$($normalized.Substring(2))"
    }
    return $normalized
}

Write-Host "→ Preparing data directory at $DataDirectory" -ForegroundColor Cyan
if (-not (Test-Path -Path $DataDirectory)) {
    New-Item -ItemType Directory -Path $DataDirectory -Force | Out-Null
}

$docker = Get-Command docker -ErrorAction SilentlyContinue
if ($docker) {
    Write-Host "→ Docker detected. Ensuring container '$ContainerName' is running…" -ForegroundColor Cyan
    $existing = docker ps -a --filter "name=$ContainerName" --format "{{.ID}}"
    if ($existing) {
        docker start $ContainerName | Out-Null
        Write-Host "✓ Redis container '$ContainerName' started on port $Port" -ForegroundColor Green
    } else {
        $mountPath = Convert-ToDockerPath -Path $DataDirectory
        docker run `
            --detach `
            --name $ContainerName `
            --publish "${Port}:6379" `
            --volume "${mountPath}:/data" `
            redis:7-alpine `
            redis-server --appendonly yes | Out-Null
        Write-Host "✓ Redis container '$ContainerName' created and running on port $Port" -ForegroundColor Green
    }
    Write-Host "Use 'docker logs -f $ContainerName' to view logs." -ForegroundColor Yellow
    exit 0
}

$redisServer = Get-Command redis-server -ErrorAction SilentlyContinue
if ($redisServer) {
    Write-Host "→ Launching local redis-server binary on port $Port" -ForegroundColor Cyan
    Start-Process -FilePath $redisServer.Source -ArgumentList "--port", $Port.ToString() -WorkingDirectory $DataDirectory
    Write-Host "✓ redis-server started in the background." -ForegroundColor Green
    exit 0
}

Write-Error "Redis is not installed. Install Docker Desktop or redis-server (winget install Redis)."
exit 1
