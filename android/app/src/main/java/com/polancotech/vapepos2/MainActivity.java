package com.polancotech.vapepos2;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(NativeBluetoothPrinterPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
