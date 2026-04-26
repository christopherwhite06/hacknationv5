$ErrorActionPreference = "Stop"

$sdk = Join-Path $env:LOCALAPPDATA "Android\Sdk"
$jdk = "C:\Program Files\Eclipse Adoptium\jdk-17.0.18.8-hotspot"

$env:ANDROID_HOME = $sdk
$env:ANDROID_SDK_ROOT = $sdk
$env:JAVA_HOME = $jdk
$env:Path = "$jdk\bin;$sdk\cmdline-tools\latest\bin;$sdk\platform-tools;$sdk\emulator;$env:Path"

emulator.exe -avd CityWalletPixel -no-metrics
