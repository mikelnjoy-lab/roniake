// RONIA native Android printer transport (Bluetooth Classic SPP, USB OTG, raw TCP 9100).
// Implements the JS contract in src/lib/printing/transports.ts. Receipt bytes come from the shared
// web ESC/POS engine — this class only moves bytes; it never touches sales data.
// STATUS: compiled-by-design source; physical device tests are recorded separately in the Build Book.
package ke.ronia.business

import android.Manifest
import android.annotation.SuppressLint
import android.app.Activity
import android.app.PendingIntent
import android.bluetooth.BluetoothManager
import android.bluetooth.BluetoothSocket
import android.content.Intent
import android.content.pm.PackageManager
import android.hardware.usb.UsbConstants
import android.hardware.usb.UsbManager
import android.os.Build
import android.util.Base64
import android.webkit.JavascriptInterface
import org.json.JSONArray
import org.json.JSONObject
import java.net.InetAddress
import java.net.InetSocketAddress
import java.net.Socket
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap

class RoniaAndroidPrinter(private val activity: Activity) {
    private val spp: UUID = UUID.fromString("00001101-0000-1000-8000-00805F9B34FB")
    private val usbPermission = "ke.ronia.business.USB_PERMISSION"
    private val lock = Any()                                   // one print at a time per device
    private val recentJobs = ConcurrentHashMap<String, Long>() // duplicate-print guard
    @Volatile private var activeBt: BluetoothSocket? = null
    @Volatile private var activeNet: Socket? = null
    @Volatile private var cancelled = false

    private fun ok(extra: JSONObject.() -> Unit = {}) = JSONObject().put("ok", true).apply(extra).toString()
    private fun fail(msg: String?, code: String = "error") = JSONObject().put("ok", false).put("code", code).put("error", msg ?: "Unknown printer error").toString()

    private fun hasBtPermission() = Build.VERSION.SDK_INT < 31 ||
        activity.checkSelfPermission(Manifest.permission.BLUETOOTH_CONNECT) == PackageManager.PERMISSION_GRANTED

    /** Shows the Android "Nearby devices" prompt. Returns current state; JS should call listPrinters again after the user answers. */
    @JavascriptInterface
    fun requestPermissions(): String {
        if (hasBtPermission()) return ok { put("granted", true) }
        activity.runOnUiThread { activity.requestPermissions(arrayOf(Manifest.permission.BLUETOOTH_CONNECT, Manifest.permission.BLUETOOTH_SCAN), 7101) }
        return ok { put("granted", false); put("prompted", true) }
    }

    @SuppressLint("MissingPermission")
    @JavascriptInterface
    fun listPrinters(): String {
        val out = JSONArray()
        if (hasBtPermission()) try {
            val bt = (activity.getSystemService(BluetoothManager::class.java)).adapter
            bt?.bondedDevices?.forEach { out.put(JSONObject().put("id", "bt:${it.address}").put("name", it.name ?: it.address).put("type", "bluetooth")) }
        } catch (_: SecurityException) { }
        val usb = activity.getSystemService(UsbManager::class.java)
        usb.deviceList.values.forEach { d ->
            out.put(JSONObject().put("id", "usb:${d.vendorId}:${d.productId}").put("name", d.productName ?: "USB ${d.vendorId}:${d.productId}").put("type", "usb"))
        }
        return out.toString()
    }

    @JavascriptInterface
    fun testConnection(target: String): String = run(target, byteArrayOf(0x1B, 0x40), null)

    @JavascriptInterface
    fun print(target: String, base64EscPos: String): String = printJob(target, base64EscPos, null)

    /** Same as print, but a repeated jobId within 10 minutes is acknowledged without printing again. */
    @JavascriptInterface
    fun printJob(target: String, base64EscPos: String, jobId: String?): String {
        val data = try { Base64.decode(base64EscPos, Base64.DEFAULT) } catch (e: Exception) { return fail("Receipt data damaged", "bad_data") }
        if (data.isEmpty() || data.size > 256_000) return fail("Receipt empty or too large", "bad_data")
        return run(target, data, jobId)
    }

    /** Aborts the print currently in progress (e.g. user pressed Cancel). */
    @JavascriptInterface
    fun cancel(): String {
        cancelled = true
        try { activeBt?.close() } catch (_: Exception) { }
        try { activeNet?.close() } catch (_: Exception) { }
        return ok()
    }

    private fun run(target: String, data: ByteArray, jobId: String?): String = synchronized(lock) {
        val now = System.currentTimeMillis()
        recentJobs.entries.removeIf { now - it.value > 600_000 }
        if (jobId != null && recentJobs.containsKey(jobId)) return ok { put("duplicate", true) }
        cancelled = false
        try {
            send(target, data)
            if (jobId != null) recentJobs[jobId] = now
            ok()
        } catch (e: SecurityException) { fail(e.message, "permission")
        } catch (e: Exception) { if (cancelled) fail("Printing cancelled", "cancelled") else fail(e.message, "connection") }
    }

    private fun send(target: String, data: ByteArray) {
        when {
            target.startsWith("bt:") -> sendBluetooth(target.removePrefix("bt:"), data)
            target.startsWith("usb:") -> sendUsb(target.removePrefix("usb:"), data)
            target.startsWith("net:") -> {
                val parts = target.removePrefix("net:").split(":")
                sendNetwork(parts[0], parts.getOrNull(1)?.toIntOrNull() ?: 9100, data)
            }
            else -> throw IllegalArgumentException("Unknown printer target")
        }
    }

    @SuppressLint("MissingPermission")
    private fun sendBluetooth(address: String, data: ByteArray) {
        if (!hasBtPermission()) throw SecurityException("Allow Nearby devices (Bluetooth) for RONIA, then try again")
        val adapter = activity.getSystemService(BluetoothManager::class.java).adapter ?: throw IllegalStateException("This device has no Bluetooth")
        if (!adapter.isEnabled) throw IllegalStateException("Bluetooth is off — turn it on")
        val dev = adapter.getRemoteDevice(address)
        adapter.cancelDiscovery()
        val s = dev.createRfcommSocketToServiceRecord(spp)
        activeBt = s
        try {
            try { s.connect() } catch (e: Exception) { throw IllegalStateException("Printer not reachable — is it on, paired and near?") }
            s.outputStream.write(data); s.outputStream.flush()
            Thread.sleep(250) // let the printer drain its buffer before closing
        } finally { try { s.close() } catch (_: Exception) { }; activeBt = null }
    }

    private fun sendUsb(ids: String, data: ByteArray) {
        val (vid, pid) = ids.split(":").map { it.toInt() }
        val usb = activity.getSystemService(UsbManager::class.java)
        val dev = usb.deviceList.values.firstOrNull { it.vendorId == vid && it.productId == pid } ?: throw IllegalStateException("USB printer unplugged")
        if (!usb.hasPermission(dev)) {
            val flags = if (Build.VERSION.SDK_INT >= 31) PendingIntent.FLAG_MUTABLE else 0
            val intent = Intent(usbPermission).setPackage(activity.packageName)
            usb.requestPermission(dev, PendingIntent.getBroadcast(activity, 0, intent, flags))
            throw SecurityException("Allow USB access in the popup, then print again")
        }
        for (i in 0 until dev.interfaceCount) {
            val intf = dev.getInterface(i)
            for (e in 0 until intf.endpointCount) {
                val ep = intf.getEndpoint(e)
                if (ep.type == UsbConstants.USB_ENDPOINT_XFER_BULK && ep.direction == UsbConstants.USB_DIR_OUT) {
                    val conn = usb.openDevice(dev) ?: throw IllegalStateException("Cannot open USB printer")
                    try {
                        if (!conn.claimInterface(intf, true)) throw IllegalStateException("USB printer busy")
                        var off = 0
                        while (off < data.size) {
                            if (cancelled) throw IllegalStateException("cancelled")
                            val n = minOf(16384, data.size - off)
                            val w = conn.bulkTransfer(ep, data.copyOfRange(off, off + n), n, 5000)
                            if (w < 0) throw IllegalStateException("USB write failed — printer disconnected?")
                            off += w
                        }
                    } finally { conn.releaseInterface(intf); conn.close() }
                    return
                }
            }
        }
        throw IllegalStateException("This USB device is not a printer")
    }

    private fun sendNetwork(host: String, port: Int, data: ByteArray) {
        // Same destination rules as the desktop bridge: private IPv4 literal, printer ports only.
        if (!Regex("^\\d{1,3}(\\.\\d{1,3}){3}$").matches(host)) throw IllegalArgumentException("Printer address must be an IP like 192.168.1.50")
        val addr = InetAddress.getByName(host)
        if (!addr.isSiteLocalAddress) throw IllegalArgumentException("Only shop-network (private) printer addresses are allowed")
        if (port !in 9100..9103) throw IllegalArgumentException("Printer port must be 9100–9103")
        val s = Socket()
        activeNet = s
        try {
            try { s.connect(InetSocketAddress(addr, port), 5000) } catch (e: Exception) { throw IllegalStateException("Printer not reachable on the network") }
            s.soTimeout = 5000
            s.getOutputStream().write(data); s.getOutputStream().flush()
        } finally { try { s.close() } catch (_: Exception) { }; activeNet = null }
    }
}
// @JavascriptInterface methods run on the WebView "JavaBridge" thread, not the UI thread,
// so blocking I/O here does not freeze the screen and JS gets a real success/failure result.
