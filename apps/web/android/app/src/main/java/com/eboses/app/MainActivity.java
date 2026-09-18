package com.eboses.app;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(SavedCredentialsPlugin.class);
        registerPlugin(SmsInboxPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
