package expo.modules.archivemedia

import android.graphics.Bitmap
import android.graphics.ColorSpace
import android.graphics.ImageDecoder
import android.net.Uri
import android.os.Build
import android.system.Os
import android.system.OsConstants
import androidx.exifinterface.media.ExifInterface
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.File
import java.io.FileOutputStream
import java.io.RandomAccessFile
import java.security.MessageDigest
import java.time.LocalDateTime
import java.time.ZoneOffset
import java.time.format.DateTimeFormatter
import java.time.format.ResolverStyle
import org.json.JSONArray
import org.json.JSONObject

/** Archive-only boundary: no camera/library enumeration, network, or whole-file JS buffers. */
class ArchiveMediaModule : Module() {
  private val maxBytes = 100L * 1024 * 1024
  private fun owned(uri: String): File {
    val u = Uri.parse(uri)
    require(u.scheme == "file") { "INVALID_PATH" }
    val root = File(requireNotNull(appContext.reactContext).filesDir, "vaults").canonicalFile
    val file = File(requireNotNull(u.path)).canonicalFile
    require(file.path.startsWith(root.path + File.separator)) { "INVALID_PATH" }
    return file
  }
  private fun syncDirectory(dir: File) {
    require(dir.isDirectory) { "INVALID_DIRECTORY" }
    val fd = Os.open(dir.path, OsConstants.O_RDONLY, 0)
    try { Os.fsync(fd) } finally { Os.close(fd) }
  }
  private fun hash(file: File): String {
    val md = MessageDigest.getInstance("SHA-256")
    file.inputStream().buffered().use { input ->
      val buffer = ByteArray(64 * 1024)
      while (true) { val n = input.read(buffer); if (n < 0) break; md.update(buffer, 0, n) }
    }
    return md.digest().joinToString("") { "%02x".format(it) }
  }
  private fun format(file: File): String {
    require(file.length() in 1..maxBytes) { "SIZE_LIMIT" }
    RandomAccessFile(file, "r").use { r ->
      val header = ByteArray(8); r.readFully(header)
      if (header[0] == 0xff.toByte() && header[1] == 0xd8.toByte() && header[2] == 0xff.toByte()) {
        r.seek(r.length()-2); require(r.readUnsignedShort()==0xffd9) { "CORRUPT_IMAGE" }; return "jpg"
      }
      if (header.contentEquals(byteArrayOf(137.toByte(),80,78,71,13,10,26,10))) {
        var end = false
        while (r.filePointer < r.length()) {
          val len = r.readInt().toLong() and 0xffffffffL
          val bytes = ByteArray(4); r.readFully(bytes); val type = String(bytes, Charsets.US_ASCII)
          require(type != "acTL") { "UNSUPPORTED_ANIMATION" }
          require(len <= maxBytes && r.filePointer + len + 4 <= r.length()) { "CORRUPT_IMAGE" }
          r.seek(r.filePointer + len + 4)
          if (type == "IEND") { end = true; break }
        }
        require(end) { "CORRUPT_IMAGE" }; return "png"
      }
      error("UNSUPPORTED_FORMAT")
    }
  }
  // ImageDecoder applies EXIF orientation, rejects partial decodes, and converts to sRGB.
  // Target sizing is set before decode, so even a 100MP original stays bounded.
  private fun decode(file: File, edge: Int, dimensions: IntArray = IntArray(2)): Bitmap {
    check(Build.VERSION.SDK_INT >= 28) { "ANDROID_9_REQUIRED" }
    return ImageDecoder.decodeBitmap(ImageDecoder.createSource(file)) { d, info, _ ->
      require(!info.isAnimated) { "UNSUPPORTED_ANIMATION" }
      val w = info.size.width; val h = info.size.height
      require(w > 0 && h > 0 && w.toLong()*h <= 100000000) { "PIXEL_LIMIT" }
      dimensions[0] = w; dimensions[1] = h
      val scale = minOf(1.0, edge.toDouble()/maxOf(w,h))
      d.setTargetSize(maxOf(1,(w*scale).toInt()), maxOf(1,(h*scale).toInt()))
      d.allocator = ImageDecoder.ALLOCATOR_SOFTWARE
      d.setTargetColorSpace(ColorSpace.get(ColorSpace.Named.SRGB))
      d.setOnPartialImageListener { false }
    }
  }
  private fun metadata(file: File): JSONObject {
    val raw = JSONObject(); val warnings = JSONArray(); var capture: Any = JSONObject.NULL; var gps: Any = JSONObject.NULL
    try {
      val exif = ExifInterface(file)
      listOf("DateTimeOriginal","DateTimeDigitized","DateTime","OffsetTimeOriginal","OffsetTimeDigitized","OffsetTime","SubSecTimeOriginal","Orientation","GPSLatitude","GPSLatitudeRef","GPSLongitude","GPSLongitudeRef","GPSAltitude","GPSAltitudeRef","GPSDateStamp","GPSTimeStamp","Make","Model","ImageWidth","ImageLength","ColorSpace").forEach { key ->
        exif.getAttribute(key)?.let { raw.put(key,it) }
      }
      exif.latLong?.let { p ->
        if (p[0].isFinite() && p[1].isFinite() && p[0] in -90.0..90.0 && p[1] in -180.0..180.0) gps = JSONObject().put("latitude",p[0]).put("longitude",p[1])
        else warnings.put("invalid_gps")
      }
      exif.getAttribute("DateTimeOriginal")?.let { value ->
        try {
          val dt = LocalDateTime.parse(value, DateTimeFormatter.ofPattern("uuuu:MM:dd HH:mm:ss").withResolverStyle(ResolverStyle.STRICT))
          var offset: ZoneOffset? = null; val cw = JSONArray()
          exif.getAttribute("OffsetTimeOriginal")?.let {
            try { val o=ZoneOffset.of(it); require(kotlin.math.abs(o.totalSeconds)<=14*3600 && o.totalSeconds%60==0); offset=o }
            catch (_: Exception) { cw.put("invalid_offset") }
          }
          capture = JSONObject().put("local",dt.format(DateTimeFormatter.ofPattern("uuuu-MM-dd'T'HH:mm:ss")))
            .put("utc",offset?.let { dt.toInstant(it).toString() } ?: JSONObject.NULL)
            .put("offset_minutes",offset?.let { it.totalSeconds/60 } ?: JSONObject.NULL)
            .put("precision","second").put("source","exif").put("warnings",cw)
        } catch (_: Exception) { warnings.put("invalid_capture_time") }
      }
    } catch (_: Exception) { warnings.put("metadata_unavailable") }
    return JSONObject().put("exif",raw).put("capture",capture).put("gps",gps).put("warnings",warnings)
  }
  override fun definition() = ModuleDefinition {
    Name("ArchiveMedia")
    AsyncFunction("copyToStaging") { source: String, destination: String ->
      val dest = owned(destination); require(dest.path.contains("/staging/") && dest.name.endsWith(".part")) { "INVALID_PATH" }
      dest.parentFile!!.mkdirs()
      val resolver = requireNotNull(appContext.reactContext).contentResolver
      val uri = Uri.parse(source); require(uri.scheme in listOf("file","content")) { "SOURCE_UNAVAILABLE" }
      val input = resolver.openInputStream(uri) ?: error("SOURCE_UNAVAILABLE")
      input.use { stream -> FileOutputStream(dest).use { out ->
        val buffer=ByteArray(64*1024); var total=0L
        while(true) { val n=stream.read(buffer); if(n<0) break; total+=n; require(total<=maxBytes) { "SIZE_LIMIT" }; out.write(buffer,0,n) }
        out.fd.sync()
      } }
      syncDirectory(dest.parentFile!!)
    }
    AsyncFunction("inspect") { uri: String ->
      val file=owned(uri); val ext=format(file); val dimensions=IntArray(2)
      decode(file, 64, dimensions).recycle()
      JSONObject().put("sha256",hash(file)).put("byteSize",file.length())
        .put("mimeType",if(ext=="jpg") "image/jpeg" else "image/png").put("extension",ext)
        .put("width",dimensions[0]).put("height",dimensions[1]).put("sourceMetadata",metadata(file)).put("parserVersion",1).toString()
    }
    AsyncFunction("verify") { uri: String, expected: String, size: Double ->
      val f=owned(uri); f.isFile && f.length()==size.toLong() && hash(f)==expected
    }
    AsyncFunction("publish") { staging: String, destination: String, expected: String, size: Double ->
      val dest=owned(destination); val src=owned(staging)
      require(dest.path.contains("/media/originals/") && dest.name.startsWith(expected + ".")) { "INVALID_PATH" }
      dest.parentFile!!.mkdirs()
      if(dest.exists()) { require(dest.length()==size.toLong() && hash(dest)==expected) { "ORIGINAL_CONFLICT" } }
      else {
        require(src.length()==size.toLong() && hash(src)==expected) { "STAGING_INVALID" }
        require(src.renameTo(dest)) { "RENAME_FAILED" }; syncDirectory(dest.parentFile!!); syncDirectory(src.parentFile!!)
      }
    }
    AsyncFunction("derive") { original: String, destination: String, edge: Int ->
      require(edge==320 || edge==2048) { "INVALID_RECIPE" }
      val src=owned(original); val dest=owned(destination)
      require(dest.path.contains("/media/display/v1/") || dest.path.contains("/media/thumbnails/v1/")) { "INVALID_PATH" }
      dest.parentFile!!.mkdirs(); val temp=File(dest.path+".part")
      val bitmap=decode(src,edge)
      try {
        FileOutputStream(temp).use { out ->
          require(bitmap.compress(if(dest.extension=="png") Bitmap.CompressFormat.PNG else Bitmap.CompressFormat.JPEG,85,out)) { "DERIVATIVE_FAILED" }
          out.fd.sync()
        }
        require(temp.renameTo(dest)) { "RENAME_FAILED" }; syncDirectory(dest.parentFile!!)
        JSONObject().put("bytes",dest.length()).put("checksum",hash(dest)).put("width",bitmap.width).put("height",bitmap.height).toString()
      } finally { bitmap.recycle() }
    }
  }
}
