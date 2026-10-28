import type { CapacitorConfig } from "@capacitor/cli";

// Android shell for RONIA. The app itself is the published web app; the shell only adds
// native printer access (window.RoniaAndroidPrinter). Offline sales keep using the web app's
// own IndexedDB queue inside the WebView.
const config: CapacitorConfig = {
  appId: "ke.ronia.business",
  appName: "RONIA Business",
  webDir: "native/capacitor-web",
  server: {
    url: "https://roniake.lovable.app",
    cleartext: false,
    allowNavigation: ["roniake.lovable.app"],
  },
  android: { allowMixedContent: false },
};

export default config;
