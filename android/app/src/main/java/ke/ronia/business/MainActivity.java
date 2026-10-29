package ke.ronia.business;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        // Exposes window.RoniaAndroidPrinter to the RONIA web app (transport only — no sales access).
        getBridge().getWebView().addJavascriptInterface(new RoniaAndroidPrinter(this), "RoniaAndroidPrinter");
    }
}
