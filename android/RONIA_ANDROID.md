# RONIA Android app (Capacitor shell with native printing)

The app loads the published RONIA web app (`https://roniake.lovable.app`) and adds one native
object, `window.RoniaAndroidPrinter`, for Bluetooth Classic (SPP), USB OTG and Wi-Fi/LAN (port 9100) printers.
Receipts are still produced by the shared web engine (58/80 mm); the native code only moves bytes.

## Build (needs a computer with Android Studio — cannot be done inside Lovable)
1. Export/clone the project, run `npm install`.
2. `npx cap sync android`
3. `npx cap open android` → in Android Studio: Build → Build APK, or Run on a connected phone.

## Using it
Receipt settings → Receipt printer → **RONIA Android app** → *Allow Bluetooth* → *Refresh list* → choose printer
→ **Check connection** → **Print test receipt**. Pair Bluetooth printers in Android Settings first.

## Behaviour
- Permissions: Android 12+ asks for "Nearby devices"; USB asks per printer (tap Print again after allowing).
- One print at a time per device; a repeated job id within 10 minutes is not printed twice.
- `cancel()` closes the open Bluetooth/network connection.
- Network targets limited to private IPv4 addresses, ports 9100–9103.
- Errors come back as `{ok:false, code:"permission"|"connection"|"cancelled"|"bad_data", error}`; the web app then
  falls back to the print dialog and shows the message. A sale is never re-posted by printing.

## Not yet verified
The Android project has not been compiled here (no Android SDK in this environment) and no physical printer was used.
Record device tests in the Master Build Book (device, Android version, printer model, transport, result).
