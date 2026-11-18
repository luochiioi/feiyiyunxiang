param(
  [ValidateSet('WeixinDev','WeixinRelease','Admin')][string]$Target = 'WeixinDev',
  [string]$HBuilderCli = 'D:/HBuilderX/cli.exe',
  [string]$NodeExe = 'node'
)
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path $PSScriptRoot -Parent
Push-Location $projectRoot
try {
  Write-Host "Source workspace: $projectRoot"
  Write-Host "Build target: $Target"
  if ($Target -eq 'Admin') {
    $compiled = $false
    & $HBuilderCli publish web --project (Join-Path $projectRoot 'admin') | ForEach-Object {
      if ($_ -match '编译成功|发行成功|compiled successfully|build completed successfully') { $compiled = $true }
      $_
    }
    if ($LASTEXITCODE -ne 0 -or !$compiled) { throw 'HBuilderX did not complete the requested Admin build' }
    $webOutput = Join-Path $projectRoot 'admin/unpackage/dist/build/web/index.html'
    if (!(Test-Path -LiteralPath $webOutput -PathType Leaf)) { throw 'Admin Web output is missing' }
    Write-Host "Admin output: $webOutput"
    return
  }

  & $NodeExe scripts/check-weixin-config.cjs --repair
  if ($LASTEXITCODE -ne 0) { throw 'Source AppID check failed' }

  $app = Join-Path $projectRoot 'app'
  $checkArgs = @()
  if ($Target -eq 'WeixinDev') {
    $buildArgs = @('launch', 'mp-weixin', '--project', $app, '--compile', 'true')
  } else {
    $wechatAppId = (Get-Content app/config/weixin.json -Raw | ConvertFrom-Json).appid
    $buildArgs = @('publish', 'mp-weixin', '--project', $app, '--appid', $wechatAppId, '--upload', 'false')
    $checkArgs = @('--release')
  }

  $compiled = $false
  & $HBuilderCli @buildArgs | ForEach-Object {
    if ($_ -match '编译成功|发行成功|compiled successfully|build completed successfully') { $compiled = $true }
    $_
  }
  if ($LASTEXITCODE -ne 0 -or !$compiled) { throw 'HBuilderX did not complete the requested WeChat build' }

  & $NodeExe scripts/check-weixin-config.cjs @checkArgs
  if ($LASTEXITCODE -ne 0) { throw 'Compiled AppID check failed' }
} finally { Pop-Location }
