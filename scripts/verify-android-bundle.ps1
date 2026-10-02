param([string]$Bundle = 'android/app/build/outputs/bundle/release/app-release.aab')
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression.FileSystem
$archive = [System.IO.Compression.ZipFile]::OpenRead((Resolve-Path -LiteralPath $Bundle).Path)
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
    "Bundle signature present: $($signatures.Count -gt 0) (a certificate's upload authorization must be checked separately)"
} finally { $archive.Dispose() }
