param([ValidateSet('WeixinDev','WeixinRelease','Admin')][string]$Target='WeixinDev')
$ErrorActionPreference='Stop'
$projectRoot=Split-Path $PSScriptRoot -Parent
Push-Location $projectRoot
try {
  if ($Target -eq 'Admin') {
    & D:/HBuilderX/cli.exe publish web --project (Join-Path $projectRoot 'admin')
  } else {
    & node scripts/check-weixin-config.cjs --repair
    if ($LASTEXITCODE -ne 0) { throw 'Source AppID check failed' }
    $wechatAppId=(Get-Content app/config/weixin.json -Raw | ConvertFrom-Json).appid
    if ($Target -eq 'WeixinDev') {
      & D:/HBuilderX/cli.exe launch mp-weixin --project (Join-Path $projectRoot 'app') --compile true
      & node scripts/check-weixin-config.cjs
    } else {
      & D:/HBuilderX/cli.exe publish mp-weixin --project (Join-Path $projectRoot 'app') --appid $wechatAppId --upload false
      & node scripts/check-weixin-config.cjs --release
    }
    if ($LASTEXITCODE -ne 0) { throw 'Compiled AppID check failed' }
  }
} finally { Pop-Location }
