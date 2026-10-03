param(
    [string]$Bundle = 'android/app/build/outputs/bundle/release/app-release.aab',
    [string]$Bundletool = $env:TMV_BUNDLETOOL_JAR,
    [string]$ExpectedCertificateSha256 = $env:TMV_UPLOAD_CERT_SHA256,
    [switch]$AllowUnsigned
)
$ErrorActionPreference = 'Stop'
$bundlePath = (Resolve-Path -LiteralPath $Bundle).Path
if (!$AllowUnsigned) {
    if (!$ExpectedCertificateSha256) { throw 'Set TMV_UPLOAD_CERT_SHA256 from the trusted upload certificate (not from the artifact being checked).' }
    & java (Join-Path $PSScriptRoot 'VerifyAndroidBundle.java') $bundlePath $ExpectedCertificateSha256
    if ($LASTEXITCODE -ne 0) { throw 'Cryptographic upload signature verification failed.' }
} else {
    Write-Warning 'Explicit unsigned inspection: this result cannot establish signed release readiness.'
}
if (!$Bundletool -or !(Test-Path -LiteralPath $Bundletool -PathType Leaf)) { throw 'Set TMV_BUNDLETOOL_JAR to the official bundletool all.jar.' }
$validation = & java -jar $Bundletool validate "--bundle=$bundlePath" 2>&1
if ($LASTEXITCODE -ne 0) { throw 'Bundle integrity validation failed.' }
'Bundletool integrity validation passed.'
$manifestText = & java -jar $Bundletool dump manifest "--bundle=$bundlePath" --module=base
if ($LASTEXITCODE -ne 0) { throw 'Cannot inspect bundle manifest.' }
[xml]$manifest = $manifestText -join "`n"
$ns = 'http://schemas.android.com/apk/res/android'
$root = $manifest.DocumentElement
$config = (Get-Content (Join-Path $PSScriptRoot '../app.json') -Raw | ConvertFrom-Json).expo
if ($root.GetAttribute('package') -ne $config.android.package -or
    $root.GetAttribute('versionCode', $ns) -ne [string]$config.android.versionCode -or
    $root.GetAttribute('versionName', $ns) -ne $config.version) { throw 'Unexpected application ID or version.' }
$sdk = $root.SelectSingleNode('uses-sdk')
if ($sdk.GetAttribute('minSdkVersion', $ns) -ne '24' -or $sdk.GetAttribute('targetSdkVersion', $ns) -ne '36') { throw 'Unexpected SDK compatibility change.' }
$app = $root.SelectSingleNode('application')
if ($app.GetAttribute('debuggable', $ns) -eq 'true' -or
    $app.GetAttribute('testOnly', $ns) -eq 'true' -or
    $app.GetAttribute('allowBackup', $ns) -ne 'false' -or
    $app.GetAttribute('usesCleartextTraffic', $ns) -ne 'false') { throw 'Unsafe release manifest flags.' }
$permissions = @($root.SelectNodes('uses-permission | uses-permission-sdk-23') | ForEach-Object { $_.GetAttribute('name', $ns) } | Sort-Object -Unique)
$expectedPermissions = @('android.permission.ACCESS_NETWORK_STATE', "$($config.android.package).DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION")
if (Compare-Object $expectedPermissions $permissions) { throw 'Unexpected release permissions.' }
if (($app.SelectNodes('activity | activity-alias') | ForEach-Object { $_.GetAttribute('name', $ns) }) -match 'expo.modules.dev(launcher|menu)') { throw 'Development activity in release.' }
"Bundle identity: $($config.android.package), version $($config.version) ($($config.android.versionCode)); minSdk 24 / targetSdk 36"
"Release permissions: $($permissions -join ', ')"
$bundleConfig = & java -jar $Bundletool dump config "--bundle=$bundlePath"
if ($LASTEXITCODE -ne 0 -or ($bundleConfig -join "`n") -notmatch 'PAGE_ALIGNMENT_16K') { throw 'Bundle does not request 16 KiB ZIP alignment.' }
Add-Type -AssemblyName System.IO.Compression.FileSystem
$archive = [System.IO.Compression.ZipFile]::OpenRead($bundlePath)
try {
    $js = $archive.GetEntry('base/assets/index.android.bundle')
    if (!$js -or $js.Length -eq 0) { throw 'Release JavaScript asset is missing.' }
    $reader = [System.IO.BinaryReader]::new($js.Open())
    try { $magic = $reader.ReadUInt64() } finally { $reader.Dispose() }
    if ($magic -ne [UInt64]0x1F1903C103BC1FC6) { throw 'Expected compiled Hermes bytecode.' }
    "Bundled Hermes bytecode: $($js.Length) bytes"

    $libraries = foreach ($entry in $archive.Entries) {
        if ($entry.FullName -notmatch '^base/lib/([^/]+)/[^/]+\.so$') { continue }
        $abi = $Matches[1]
        $reader = [System.IO.BinaryReader]::new($entry.Open())
        try { $header = $reader.ReadBytes(4096) } finally { $reader.Dispose() }
        if ([BitConverter]::ToUInt32($header, 0) -ne 0x464c457f -or $header[5] -ne 1) { throw "Unexpected ELF: $($entry.FullName)" }
        $machines = @{ 'arm64-v8a' = 183; 'armeabi-v7a' = 40; 'x86' = 3; 'x86_64' = 62 }
        if ([BitConverter]::ToUInt16($header, 18) -ne $machines[$abi]) { throw "ELF machine does not match ABI directory: $($entry.FullName)" }
        $is64 = $header[4] -eq 2
        if ($is64) {
            $offset = [BitConverter]::ToUInt64($header, 32)
            $stride = [BitConverter]::ToUInt16($header, 54)
            $count = [BitConverter]::ToUInt16($header, 56)
        } else {
            $offset = [BitConverter]::ToUInt32($header, 28)
            $stride = [BitConverter]::ToUInt16($header, 42)
            $count = [BitConverter]::ToUInt16($header, 44)
        }
        $alignments = for ($i = 0; $i -lt $count; $i++) {
            $position = [int]($offset + $i * $stride)
            if ($position + $stride -gt $header.Length) { throw 'ELF program headers exceed inspection bound.' }
            if ([BitConverter]::ToUInt32($header, $position) -ne 1) { continue }
            if ($is64) { [BitConverter]::ToUInt64($header, $position + 48) }
            else { [BitConverter]::ToUInt32($header, $position + 28) }
        }
        $minimum = ($alignments | Measure-Object -Minimum).Minimum
        if (!$minimum -or ($is64 -and $minimum -lt 16384)) { throw "Insufficient ELF load alignment: $($entry.FullName) ($minimum)" }
        [PSCustomObject]@{ ABI = $abi; Name = $entry.Name; Alignment = $minimum }
    }
    $expected = @('arm64-v8a', 'armeabi-v7a', 'x86', 'x86_64')
    if (Compare-Object $expected @($libraries.ABI | Sort-Object -Unique)) { throw 'The bundle does not contain the expected four ABIs.' }
    foreach ($abi in $expected) {
        $native = @($libraries | Where-Object ABI -eq $abi)
        foreach ($required in @('libreactnative.so', 'libhermesvm.so', 'libreanimated.so', 'libworklets.so', 'libmaplibre.so')) {
            if ($required -notin $native.Name) { throw "Missing $required for $abi" }
        }
        [PSCustomObject]@{ ABI = $abi; Libraries = $native.Count; MinimumLoadAlignment = ($native.Alignment | Measure-Object -Minimum).Minimum }
    }
    $signatures = @($archive.Entries | Where-Object FullName -match '^META-INF/.*\.(RSA|DSA|EC)$')
    if ($AllowUnsigned -and $signatures.Count -gt 0) { throw 'Signed bundle supplied in unsigned inspection mode; rerun with the expected certificate.' }
    "Bundle signature present: $($signatures.Count -gt 0)"
} finally { $archive.Dispose() }
"Artifact SHA-256: $((Get-FileHash -LiteralPath $bundlePath -Algorithm SHA256).Hash)"
