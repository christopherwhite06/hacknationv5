$ErrorActionPreference = "Stop"

$sdk = Join-Path $env:LOCALAPPDATA "Android\Sdk"
$jdk = "C:\Program Files\Eclipse Adoptium\jdk-17.0.18.8-hotspot"

$env:ANDROID_HOME = $sdk
$env:ANDROID_SDK_ROOT = $sdk
$env:JAVA_HOME = $jdk
$env:NODE_OPTIONS = "--dns-result-order=ipv4first"
$env:Path = "$jdk\bin;$sdk\cmdline-tools\latest\bin;$sdk\platform-tools;$sdk\emulator;$env:Path"

adb shell am force-stop host.exp.exponent | Out-Null
adb reverse tcp:8082 tcp:8082 | Out-Null
npx expo start --android --localhost --port 8082 --clear
