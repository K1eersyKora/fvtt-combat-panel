param([string]$Foundry,[ValidateRange(0,12)][int]$Players=0,[int]$Port=31940,[switch]$NoWindows,[string]$WorldAssets)
$ErrorActionPreference='Stop'
if(!$Foundry){$Foundry=Read-Host '输入 FVTT 地址，例如 http://127.0.0.1:30001'}
if(!$Players -and !$NoWindows){
  $count=Read-Host '需要几个玩家窗口？直接回车为 1'
  $Players=if($count){[int]$count}else{1}
  if($Players -lt 1 -or $Players -gt 12){throw '请指定 1 至 12 个窗口'}
}
$uri=[Uri]$Foundry
if(!$uri.IsAbsoluteUri -or $uri.Scheme -notin @('https','http')){throw '需要完整的 FVTT 网站地址'}
$env:TABLE_FOUNDRY=$uri.GetLeftPart([UriPartial]::Authority)
$env:TABLE_PORT="$Port"
if($WorldAssets){$env:TABLE_WORLD_ASSETS=(Resolve-Path -LiteralPath $WorldAssets).Path}
$node=(Get-Command node.exe -ErrorAction SilentlyContinue).Source
if(!$node){$node="$env:USERPROFILE/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node.exe"}
if(!(Test-Path -LiteralPath $node)){throw '需要 Windows Node.js 22 或更高版本'}
$private=Join-Path $env:LOCALAPPDATA 'FVTTMobileTable'
if(!$NoWindows){
  $edge=Join-Path ([Environment]::GetEnvironmentVariable('ProgramFiles(x86)')) 'Microsoft/Edge/Application/msedge.exe'
  if(!(Test-Path $edge)){throw '未找到 Microsoft Edge'}
  for($i=1;$i -le $Players;$i++){
    $profile=Join-Path $private "player-$i"
    Start-Process $edge -ArgumentList @(('--user-data-dir="'+$profile+'"'),'--new-window','--enable-gpu','--use-angle=d3d11','--window-size=1280,800','--disable-background-timer-throttling','--disable-renderer-backgrounding','--disable-backgrounding-occluded-windows',('"'+$Foundry+'"'))
  }
}
Write-Host '请在每个窗口登录对应的普通玩家账号，点击右下角「手机配对」。关闭服务窗口即可结束本次连接。'
& $node (Join-Path $PSScriptRoot 'server.mjs')
