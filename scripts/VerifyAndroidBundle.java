import java.io.OutputStream;
import java.nio.file.Path;
import java.security.MessageDigest;
import java.security.cert.X509Certificate;
import java.security.interfaces.RSAPublicKey;
import java.util.HashSet;
import java.util.HexFormat;
import java.util.Locale;
import java.util.jar.JarFile;

/** JDK 17 source launcher; verifies bytes, coverage and the independently pinned upload certificate. */
class VerifyAndroidBundle {
    public static void main(String[] args) {
        try {
            verify(Path.of(args[0]), args[1]);
        } catch (Exception failure) {
            // Provider exceptions can contain owner/alias information. Keep diagnostics bounded.
            System.err.println("Bundle signature verification FAILED: unsigned, altered, unexpected or invalid signing certificate.");
            System.exit(1);
        }
    }

    static void verify(Path bundle, String expected) throws Exception {
        expected = expected.replace(":", "").toUpperCase(Locale.ROOT);
        if (!expected.matches("[0-9A-F]{64}")) throw new IllegalArgumentException();
        var names = new HashSet<String>();
        int payloadEntries = 0;
        try (var jar = new JarFile(bundle.toFile(), true)) {
            var entries = jar.entries();
            while (entries.hasMoreElements()) {
                var entry = entries.nextElement();
                if (!names.add(entry.getName())) throw new SecurityException();
                if (entry.isDirectory()) continue;
                // Fully consume each entry: JarFile checks its signature digest only while reading.
                try (var input = jar.getInputStream(entry)) { input.transferTo(OutputStream.nullOutputStream()); }
                var upper = entry.getName().toUpperCase(Locale.ROOT);
                if (upper.equals("META-INF/MANIFEST.MF") ||
                    upper.matches("META-INF/[^/]+\\.(SF|RSA|DSA|EC)")) continue;
                var signers = entry.getCodeSigners();
                if (signers == null || signers.length != 1) throw new SecurityException();
                var cert = (X509Certificate) signers[0].getSignerCertPath().getCertificates().get(0);
                cert.checkValidity();
                if (cert.getSubjectX500Principal().getName().toLowerCase(Locale.ROOT).contains("cn=android debug")) {
                    throw new SecurityException();
                }
                if (!(cert.getPublicKey() instanceof RSAPublicKey rsa) || rsa.getModulus().bitLength() < 2048) {
                    throw new SecurityException();
                }
                var fingerprint = HexFormat.of().withUpperCase().formatHex(MessageDigest.getInstance("SHA-256").digest(cert.getEncoded()));
                if (!expected.equals(fingerprint)) throw new SecurityException();
                payloadEntries++;
            }
        }
        if (payloadEntries == 0) throw new SecurityException();
        System.out.println("Cryptographic signature verified for all " + payloadEntries + " payload entries; expected upload certificate matched.");
    }
}
