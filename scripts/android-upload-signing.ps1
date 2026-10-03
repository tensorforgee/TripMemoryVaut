param(
    [ValidateSet('Initialize', 'Build')]
    [string]$Action = 'Build'
)
$ErrorActionPreference = 'Stop'
if (!$IsWindows) { throw 'This local credential store requires Windows DPAPI and the creating Windows account.' }
$repository = Split-Path $PSScriptRoot -Parent
$privateDirectory = Join-Path $repository '.local-signing'
$credentialsFile = Join-Path $privateDirectory 'credentials.dpapi'
$storeFile = Join-Path $privateDirectory 'upload.jks'
$certificateFile = Join-Path $privateDirectory 'upload-certificate.cer'
if (!$env:JAVA_HOME -or !(Test-Path (Join-Path $env:JAVA_HOME 'bin/keytool.exe'))) { throw 'Set JAVA_HOME to the documented JDK 17.' }

function Invoke-PrivateKeytool([string[]]$Arguments, [string]$Password) {
    $info = [Diagnostics.ProcessStartInfo]::new((Join-Path $env:JAVA_HOME 'bin/keytool.exe'))
    $info.UseShellExecute = $false
    $info.CreateNoWindow = $true
    $info.RedirectStandardOutput = $true
    $info.RedirectStandardError = $true
    foreach ($argument in $Arguments) { $info.ArgumentList.Add($argument) }
    $info.Environment['TMV_KEYTOOL_PASSWORD'] = $Password
    $process = [Diagnostics.Process]::Start($info)
    $output = $process.StandardOutput.ReadToEndAsync()
    $errors = $process.StandardError.ReadToEndAsync()
    $process.WaitForExit()
    $null = $output.GetAwaiter().GetResult()
    $null = $errors.GetAwaiter().GetResult()
    $code = $process.ExitCode
    $process.Dispose()
    if ($code -ne 0) { throw 'Keytool failed; diagnostic output withheld to protect signing inputs. Existing files were preserved.' }
}

Push-Location $repository
try {
    # Check ignore rules before creating anything; never force-add this directory.
    $null = & git check-ignore --quiet -- .local-signing/credentials.dpapi
    if ($LASTEXITCODE -ne 0) { throw 'The private signing directory must be Git-ignored.' }
    if ($Action -eq 'Initialize') {
        if (Test-Path -LiteralPath $privateDirectory) { throw 'Local signing storage already exists; refusing to overwrite or rotate keys.' }
        $null = New-Item -ItemType Directory -Path $privateDirectory
        $acl = [Security.AccessControl.DirectorySecurity]::new()
        $acl.SetAccessRuleProtection($true, $false)
        $identity = [Security.Principal.WindowsIdentity]::GetCurrent().User
        $acl.SetOwner($identity)
        foreach ($sid in @($identity, [Security.Principal.SecurityIdentifier]::new('S-1-5-18'))) {
            $acl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new(
                $sid, 'FullControl', 'ContainerInherit, ObjectInherit', 'None', 'Allow'))
        }
        Set-Acl -LiteralPath $privateDirectory -AclObject $acl
        $password = [Convert]::ToBase64String([Security.Cryptography.RandomNumberGenerator]::GetBytes(32))
        $alias = [Convert]::ToHexString([Security.Cryptography.RandomNumberGenerator]::GetBytes(16)).ToLowerInvariant()
        $json = @{ storeFile = $storeFile; alias = $alias; storePassword = $password; keyPassword = $password } | ConvertTo-Json -Compress
        $plain = [Text.Encoding]::UTF8.GetBytes($json)
        try {
            $encrypted = [Security.Cryptography.ProtectedData]::Protect($plain, $null, [Security.Cryptography.DataProtectionScope]::CurrentUser)
            [IO.File]::WriteAllBytes($credentialsFile, $encrypted)
        } finally { [Array]::Clear($plain, 0, $plain.Length); $json = $null }
        Invoke-PrivateKeytool -Password $password -Arguments @(
            '-genkeypair', '-storetype', 'JKS', '-keystore', $storeFile, '-alias', $alias,
            '-keyalg', 'RSA', '-keysize', '3072', '-sigalg', 'SHA256withRSA', '-validity', '10000',
            '-dname', 'CN=Trip Memory Vault Upload', '-storepass:env', 'TMV_KEYTOOL_PASSWORD',
            '-keypass:env', 'TMV_KEYTOOL_PASSWORD')
        Invoke-PrivateKeytool -Password $password -Arguments @(
            '-exportcert', '-keystore', $storeFile, '-alias', $alias,
            '-storepass:env', 'TMV_KEYTOOL_PASSWORD', '-file', $certificateFile)
        $password = $null
        $alias = $null
        'Upload key created: RSA 3072 / SHA256withRSA / 10000 days; credentials protected with Windows CurrentUser DPAPI.'
    } else {
        if (!(Test-Path $storeFile) -or !(Test-Path $credentialsFile) -or !(Test-Path $certificateFile)) {
            throw 'Local upload signing is incomplete. No debug or unsigned fallback is allowed.'
        }
        $plain = [Security.Cryptography.ProtectedData]::Unprotect(
            [IO.File]::ReadAllBytes($credentialsFile), $null, [Security.Cryptography.DataProtectionScope]::CurrentUser)
        try { $credentials = [Text.Encoding]::UTF8.GetString($plain) | ConvertFrom-Json }
        finally { [Array]::Clear($plain, 0, $plain.Length) }
        $names = 'TMV_UPLOAD_STORE_FILE','TMV_UPLOAD_KEY_ALIAS','TMV_UPLOAD_STORE_PASSWORD','TMV_UPLOAD_KEY_PASSWORD'
        try {
            $env:TMV_UPLOAD_STORE_FILE = $credentials.storeFile
            $env:TMV_UPLOAD_KEY_ALIAS = $credentials.alias
            $env:TMV_UPLOAD_STORE_PASSWORD = $credentials.storePassword
            $env:TMV_UPLOAD_KEY_PASSWORD = $credentials.keyPassword
            $env:NODE_ENV = 'production'
            $env:EXPO_NO_TYPESCRIPT_SETUP = '1'
            $env:Path = "$env:JAVA_HOME/bin;$env:Path"
            & ./android/gradlew.bat -p android :app:bundleRelease :app:assembleRelease --no-daemon --no-watch-fs --no-parallel --max-workers=1 '-Dorg.gradle.jvmargs=-Xmx4096m -XX:MaxMetaspaceSize=512m' --console=plain --stacktrace 2>&1 |
                ForEach-Object {
                    # Even provider diagnostics must not reveal signing inputs.
                    $line = $_.ToString()
                    foreach ($secret in @($credentials.alias, $credentials.storePassword, $credentials.keyPassword)) {
                        if (![string]::IsNullOrEmpty($secret)) { $line = $line.Replace($secret, '[REDACTED]') }
                    }
                    $line
                }
            if ($LASTEXITCODE -ne 0) { throw 'Signed release build failed; do not use a previous output.' }
        } finally {
            foreach ($name in $names) { [Environment]::SetEnvironmentVariable($name, $null) }
            $credentials = $null
        }
        $certificate = [Security.Cryptography.X509Certificates.X509Certificate2]::new($certificateFile)
        try { $fingerprint = $certificate.GetCertHashString([Security.Cryptography.HashAlgorithmName]::SHA256) }
        finally { $certificate.Dispose() }
        & (Join-Path $PSScriptRoot 'verify-android-bundle.ps1') -ExpectedCertificateSha256 $fingerprint
    }
} finally { Pop-Location }
