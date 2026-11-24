param([Parameter(Mandatory)][string]$Jdk,[Parameter(Mandatory)][string]$BuildTools,[Parameter(Mandatory)][string]$Platform)
$ErrorActionPreference='Stop'
$env:JAVA_HOME=(Resolve-Path $Jdk).Path
$repo=(Get-Item $PSScriptRoot).Parent.FullName
$tmp=Join-Path ([IO.Path]::GetTempPath()) ('mobile-table-apk-'+[guid]::NewGuid().ToString('N'))
$out=Join-Path $repo 'dist'
$version=([xml](Get-Content -Raw "$PSScriptRoot/AndroidManifest.xml")).manifest.versionName
$apk=Join-Path $out "FVTT-Mobile-$version.apk"
foreach($dir in @($tmp,"$tmp/classes","$tmp/dex",$out)){New-Item -ItemType Directory -Path $dir -Force | Out-Null}
$android=Join-Path $Platform 'android.jar'
function Run([string]$exe,[string[]]$arguments){& $exe @arguments;if($LASTEXITCODE){throw "$exe failed ($LASTEXITCODE)"}}
Run "$Jdk/bin/javac.exe" @('--release','8','-encoding','UTF-8','-classpath',$android,'-d',"$tmp/classes","$PSScriptRoot/TableActivity.java","$PSScriptRoot/WorldAssets.java")
Run "$Jdk/bin/jar.exe" @('cf',"$tmp/code.jar",'-C',"$tmp/classes",'.')
Run "$BuildTools/d8.bat" @('--lib',$android,'--min-api','26','--output',"$tmp/dex","$tmp/code.jar")
Run "$BuildTools/aapt2.exe" @('compile','--dir',"$PSScriptRoot/res",'-o',"$tmp/resources.zip")
$assets=Join-Path $tmp 'assets'
Copy-Item -LiteralPath "$repo/mobile" -Destination $assets -Recurse
Copy-Item -LiteralPath "$repo/fvtt-mobile-table/relay-4.mjs" -Destination "$assets/relay.js"
Run "$BuildTools/aapt2.exe" @('link','-I',$android,'--manifest',"$PSScriptRoot/AndroidManifest.xml",'-A',$assets,'-o',"$tmp/base.apk","$tmp/resources.zip")
Run "$Jdk/bin/jar.exe" @('uf',"$tmp/base.apk",'-C',"$tmp/dex",'classes.dex')
Run "$BuildTools/zipalign.exe" @('-f','4',"$tmp/base.apk","$tmp/aligned.apk")
$keys=Join-Path $env:LOCALAPPDATA 'FVTTMobileTable'
New-Item -ItemType Directory -Force $keys | Out-Null
$store=Join-Path $keys 'local-build.p12'
if(!(Test-Path $store)){
  $bytes=New-Object byte[] 32
  $rng=[Security.Cryptography.RandomNumberGenerator]::Create();$rng.GetBytes($bytes);$rng.Dispose()
  $pw=[Convert]::ToBase64String($bytes)
  ConvertTo-SecureString $pw -AsPlainText -Force | ConvertFrom-SecureString | Set-Content "$keys/signer.dpapi"
  $env:TABLE_SIGN_PASSWORD=$pw
  Run "$Jdk/bin/keytool.exe" @('-genkeypair','-storetype','PKCS12','-keystore',$store,'-alias','mobile','-storepass:env','TABLE_SIGN_PASSWORD','-keyalg','RSA','-keysize','3072','-validity','7300','-dname','CN=FVTT Mobile Local Build')
}else{
  $secure=Get-Content "$keys/signer.dpapi" | ConvertTo-SecureString
  $env:TABLE_SIGN_PASSWORD=[Net.NetworkCredential]::new('', $secure).Password
}
try{
  Run "$BuildTools/apksigner.bat" @('sign','--ks',$store,'--ks-pass','env:TABLE_SIGN_PASSWORD','--v4-signing-enabled','false','--out',$apk,"$tmp/aligned.apk")
}finally{Remove-Item Env:TABLE_SIGN_PASSWORD}
Run "$BuildTools/apksigner.bat" @('verify','--verbose',$apk)
Run "$BuildTools/zipalign.exe" @('-c','4',$apk)
