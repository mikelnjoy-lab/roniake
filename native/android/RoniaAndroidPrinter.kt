// RONIA native Android printer adapter.
// STATUS: source only. This project has no Android shell yet, so this file has NOT been compiled or run.
// Integrate into a WebView/Capacitor shell: webView.addJavascriptInterface(RoniaAndroidPrinter(context), "RoniaAndroidPrinter")
// It implements the JS contract in src/lib/printing/transports.ts (listPrinters / print / testConnection).
// Receipt bytes (ESC/POS) are produced by the shared web engine; this class is transport only.
//
// Manifest needs:
//   <uses-permission android:name="android.permission.BLUETOOTH_CONNECT"/>   (Android 12+, runtime-requested)
//   <uses-permission android:name="android.permission.BLUETOOTH" android:maxSdkVersion="30"/>
//   <uses-permission android:name="android.permission.INTERNET"/>
//   <uses-feature android:name="android.hardware.usb.host" android:required="false"/>
package ke.ronia.business.printing

import android.annotation.SuppressLint
import android.app.PendingIntent
import android.bluetooth.BluetoothManager
import android.content.Context
import android.content.Intent
import android.hardware.usb.UsbConstants
import android.hardware.usb.UsbManager
import android.os.Build
import android.util.Base64
import android.webkit.JavascriptInterface
import org.json.JSONArray
import org.json.JSONObject
import java.net.InetSocketAddress
import java.net.Socket
import java.util.UUID

class RoniaAndroidPrinter(private val ctx: Context) {
    private val spp: UUID = UUID.fromString("00001101-0000-1000-8000-00805F9B34FB")
    private val usbPermission = "ke.ronia.business.USB_PERMISSION"

    private fun ok() = JSONObject().put("ok", true).toString()
    private fun fail(msg: String?) = JSONObject().put("ok", false).put("error", msg ?: "Unknown printer error").toString()

    /** Paired Bluetooth devices + attached USB printers. Network printers are entered as "net:host:port". */
    @SuppressLint("MissingPermission")
    @JavascriptInterface
    fun listPrinters(): String {
        val out = JSONArray()
        try {
            val bt = (ctx.getSystemService(Context.BLUETOOTH_SERVICE) as BluetoothManager).adapter
            bt?.bondedDevices?.forEach { out.put(JSONObject().put("id", "bt:${it.address}").put("name", it.name ?: it.address).put("type", "bluetooth")) }
        } catch (e: SecurityException) { /* BLUETOOTH_CONNECT not granted yet */ }
        val usb = ctx.getSystemService(Context.USB_SERVICE) as UsbManager
        usb.deviceList.values.forEach { d ->
            out.put(JSONObject().put("id", "usb:${d.vendorId}:${d.productId}").put("name", d.productName ?: "USB ${d.vendorId}:${d.productId}").put("type", "usb"))
        }
        return out.toString()
    }

    @JavascriptInterface
    fun testConnection(target: String): String = try { send(target, byteArrayOf(0x1B, 0x40)); ok() } catch (e: Exception) { fail(e.message) }

    @JavascriptInterface
    fun print(target: String, base64EscPos: String): String =
        try { send(target, Base64.decode(base64EscPos, Base64.DEFAULT)); ok() } catch (e: Exception) { fail(e.message) }

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
        if (Build.VERSION.SDK_INT >= 31 && ctx.checkSelfPermission(android.Manifest.permission.BLUETOOTH_CONNECT) != android.content.pm.PackageManager.PERMISSION_GRANTED)
            throw SecurityException("Allow Nearby devices (Bluetooth) permission for RONIA")
        val adapter = (ctx.getSystemService(Context.BLUETOOTH_SERVICE) as BluetoothManager).adapter ?: throw IllegalStateException("No Bluetooth on this device")
        if (!adapter.isEnabled) throw IllegalStateException("Bluetooth is off")
        val dev = adapter.getRemoteDevice(address)
        adapter.cancelDiscovery()
        dev.createRfcommSocketToServiceRecord(spp).use { s ->
            s.connect() // throws if printer is off, out of range or not paired
            s.outputStream.write(data); s.outputStream.flush()
            Thread.sleep(200)
        }
    }

    private fun sendUsb(ids: String, data: ByteArray) {
        val (vid, pid) = ids.split(":").map { it.toInt() }
        val usb = ctx.getSystemService(Context.USB_SERVICE) as UsbManager
        val dev = usb.deviceList.values.firstOrNull { it.vendorId == vid && it.productId == pid } ?: throw IllegalStateException("USB printer unplugged")
        if (!usb.hasPermission(dev)) {
            val flags = if (Build.VERSION.SDK_INT >= 31) PendingIntent.FLAG_MUTABLE else 0
            usb.requestPermission(dev, PendingIntent.getBroadcast(ctx, 0, Intent(usbPermission), flags))
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
                            val n = minOf(16384, data.size - off)
                            val w = conn.bulkTransfer(ep, data.copyOfRange(off, off + n), n, 5000)
                            if (w < 0) throw IllegalStateException("USB write failed")
                            off += w
                        }
                    } finally { conn.releaseInterface(intf); conn.close() }
                    return
                }
            }
        }
        throw IllegalStateException("Device has no printer endpoint")
    }

    private fun sendNetwork(host: String, port: Int, data: ByteArray) {
        Socket().use { s ->
            s.connect(InetSocketAddress(host, port), 5000)
            s.soTimeout = 5000
            s.getOutputStream().write(data); s.getOutputStream().flush()
        }
    }
}
// NOTE: @JavascriptInterface calls run on a WebView background thread; Bluetooth/network I/O here is
// blocking by design so the JS caller receives a real success/failure result.
