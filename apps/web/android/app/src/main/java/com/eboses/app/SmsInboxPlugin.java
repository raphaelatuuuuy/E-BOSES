package com.eboses.app;

import android.app.Activity;
import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.telephony.SmsManager;

import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;
import com.google.android.gms.auth.api.phone.SmsRetriever;
import com.google.android.gms.auth.api.phone.SmsRetrieverClient;
import com.google.android.gms.common.api.CommonStatusCodes;
import com.google.android.gms.common.api.Status;

@CapacitorPlugin(
    name = "SmsInbox",
    requestCodes = { SmsInboxPlugin.CONSENT_REQUEST, SmsInboxPlugin.SMS_SENT_REQUEST },
    permissions = {
        @Permission(alias = SmsInboxPlugin.SMS_ALIAS, strings = { android.Manifest.permission.SEND_SMS })
    }
)
public class SmsInboxPlugin extends Plugin {
    static final int CONSENT_REQUEST = 9021;
    static final int SMS_SENT_REQUEST = 9022;
    static final String SMS_ALIAS = "smsSend";
    static final String SMS_SENT_ACTION = "com.eboses.app.SMS_SENT";
    private static final long SAFETY_TIMEOUT_MS = 6 * 60 * 1000L;
    private static final long SEND_TIMEOUT_MS = 60 * 1000L;
    private static final int MAX_SEND_PARTS = 5;

    private PluginCall pendingCall;
    private String pendingSender = "";
    private BroadcastReceiver consentReceiver;
    private final Handler handler = new Handler(Looper.getMainLooper());
    private Runnable safetyTimeout;
    private PluginCall pendingSendCall;
    private BroadcastReceiver sentReceiver;
    private Runnable sendTimeout;
    private int sentOk;
    private int sentDone;
    private int sentExpected;

    @PluginMethod
    public void sendSms(PluginCall call) {
        String to = call.getString("to", "");
        String body = call.getString("body", "");
        if (to == null || !to.matches("\\+?\\d{7,15}")) {
            call.reject("Recipient number is invalid.");
            return;
        }
        if (body == null || body.trim().isEmpty()) {
            call.reject("Message body is empty.");
            return;
        }
        if (pendingSendCall != null) {
            call.reject("Another SMS send is already running.");
            return;
        }
        if (getPermissionState(SMS_ALIAS) != PermissionState.GRANTED) {
            pendingSendCall = call;
            requestPermissionForAlias(SMS_ALIAS, call, "smsPermissionCallback");
            return;
        }
        transmit(call);
    }

    @PermissionCallback
    private void smsPermissionCallback(PluginCall call) {
        PluginCall pending = pendingSendCall;
        pendingSendCall = null;
        if (pending == null) {
            return;
        }
        if (getPermissionState(SMS_ALIAS) == PermissionState.GRANTED) {
            transmit(pending);
        } else {
            pending.reject("SMS permission was denied.");
        }
    }

    private void transmit(PluginCall call) {
        Activity activity = getActivity();
        if (activity == null || activity.isFinishing()) {
            call.reject("The app is not ready to send SMS.");
            return;
        }
        String to = call.getString("to", "");
        String body = call.getString("body", "");
        SmsManager sms;
        try {
            sms = activity.getSystemService(SmsManager.class);
        } catch (Exception e) {
            sms = null;
        }
        if (sms == null) {
            try {
                sms = SmsManager.getDefault();
            } catch (Exception e) {
                call.reject("SMS is unavailable on this device.");
                return;
            }
        }
        java.util.ArrayList<String> parts;
        try {
            parts = sms.divideMessage(body);
        } catch (Exception e) {
            call.reject("Message could not be encoded for SMS.");
            return;
        }
        if (parts == null || parts.isEmpty()) {
            call.reject("Message body is empty.");
            return;
        }
        if (parts.size() > MAX_SEND_PARTS) {
            call.reject("Message is too long for SMS.");
            return;
        }
        pendingSendCall = call;
        sentOk = 0;
        sentDone = 0;
        sentExpected = parts.size();
        sentReceiver = new BroadcastReceiver() {
            @Override
            public void onReceive(Context context, Intent intent) {
                if (!SMS_SENT_ACTION.equals(intent.getAction())) return;
                sentDone++;
                if (getResultCode() == Activity.RESULT_OK) {
                    sentOk++;
                }
                if (sentDone >= sentExpected) {
                    boolean allOk = sentOk >= sentExpected;
                    int ok = sentOk;
                    finishSend(allOk, allOk ? null : "The carrier did not accept the SMS.", ok);
                }
            }
        };
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                activity.registerReceiver(sentReceiver, new IntentFilter(SMS_SENT_ACTION), Context.RECEIVER_NOT_EXPORTED);
            } else {
                activity.registerReceiver(sentReceiver, new IntentFilter(SMS_SENT_ACTION));
            }
        } catch (Exception e) {
            finishSend(false, "SMS status tracking is unavailable.", 0);
            return;
        }
        try {
            java.util.ArrayList<PendingIntent> sentIntents = new java.util.ArrayList<>();
            for (int i = 0; i < parts.size(); i++) {
                Intent sentIntent = new Intent(SMS_SENT_ACTION);
                int flags = PendingIntent.FLAG_UPDATE_CURRENT;
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                    flags |= PendingIntent.FLAG_IMMUTABLE;
                }
                sentIntents.add(PendingIntent.getBroadcast(activity, SMS_SENT_REQUEST + i, sentIntent, flags));
            }
            sms.sendMultipartTextMessage(to, null, parts, sentIntents, null);
        } catch (Exception e) {
            finishSend(false, "SMS could not be sent.", 0);
            return;
        }
        sendTimeout = () -> finishSend(false, "SMS send timed out.", sentOk);
        handler.postDelayed(sendTimeout, SEND_TIMEOUT_MS);
    }

    private void finishSend(boolean ok, String error, int parts) {
        PluginCall call = pendingSendCall;
        pendingSendCall = null;
        if (sendTimeout != null) {
            handler.removeCallbacks(sendTimeout);
            sendTimeout = null;
        }
        if (sentReceiver != null) {
            try {
                Activity activity = getActivity();
                if (activity != null) activity.unregisterReceiver(sentReceiver);
            } catch (Exception ignored) {
            }
            sentReceiver = null;
        }
        if (call == null) return;
        if (!ok) {
            call.reject(error == null ? "SMS could not be sent." : error);
            return;
        }
        JSObject result = new JSObject();
        result.put("parts", parts);
        call.resolve(result);
    }

    @PluginMethod
    public void requestSmsUpdate(PluginCall call) {
        if (pendingCall != null) {
            call.reject("Another SMS check is already running.");
            return;
        }
        Activity activity = getActivity();
        if (activity == null || activity.isFinishing()) {
            call.reject("The app is not ready to read messages.");
            return;
        }
        String sender = call.getString("sender", "");
        pendingCall = call;
        pendingSender = sender == null ? "" : sender;
        unregisterReceiver();

        consentReceiver = new BroadcastReceiver() {
            @Override
            public void onReceive(Context context, Intent intent) {
                if (!SmsRetriever.SMS_RETRIEVED_ACTION.equals(intent.getAction())) return;
                Bundle extras = intent.getExtras();
                if (extras == null) return;
                Status status = (Status) extras.get(SmsRetriever.EXTRA_STATUS);
                if (status == null) return;
                if (status.getStatusCode() == CommonStatusCodes.SUCCESS) {
                    Intent consentIntent = extras.getParcelable(SmsRetriever.EXTRA_CONSENT_INTENT);
                    if (consentIntent != null) {
                        try {
                            startActivityForResult(call, consentIntent, CONSENT_REQUEST);
                        } catch (Exception e) {
                            finish(null, null);
                        }
                    }
                } else if (status.getStatusCode() == CommonStatusCodes.TIMEOUT) {
                    finish(null, null);
                }
            }
        };
        try {
            IntentFilter filter = new IntentFilter(SmsRetriever.SMS_RETRIEVED_ACTION);
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                activity.registerReceiver(consentReceiver, filter, Context.RECEIVER_EXPORTED);
            } else {
                activity.registerReceiver(consentReceiver, filter);
            }
        } catch (Exception e) {
            finish(null, null);
            return;
        }
        try {
            SmsRetrieverClient client = SmsRetriever.getClient(activity);
            String filter = pendingSender.isEmpty() ? null : pendingSender;
            client.startSmsUserConsent(filter);
        } catch (Exception e) {
            finish(null, null);
            return;
        }
        safetyTimeout = () -> finish(null, null);
        handler.postDelayed(safetyTimeout, SAFETY_TIMEOUT_MS);
    }

    @ActivityCallback
    private void onConsentResult(PluginCall call, Activity activity, int resultCode, Intent data) {
        if (call != pendingCall) return;
        if (resultCode == Activity.RESULT_OK && data != null) {
            finish(data.getStringExtra("sms_message"), pendingSender);
        } else {
            finish(null, null);
        }
    }

    private void finish(String body, String sender) {
        PluginCall call = pendingCall;
        pendingCall = null;
        pendingSender = "";
        unregisterReceiver();
        if (safetyTimeout != null) {
            handler.removeCallbacks(safetyTimeout);
            safetyTimeout = null;
        }
        if (call == null) return;
        if (body == null || body.trim().isEmpty()) {
            call.resolve();
            return;
        }
        JSObject result = new JSObject();
        result.put("sender", sender == null ? "" : sender);
        result.put("body", body);
        call.resolve(result);
    }

    private void unregisterReceiver() {
        if (consentReceiver == null) return;
        try {
            Activity activity = getActivity();
            if (activity != null) activity.unregisterReceiver(consentReceiver);
        } catch (Exception ignored) {
        }
        consentReceiver = null;
    }

    @Override
    protected void handleOnDestroy() {
        super.handleOnDestroy();
        pendingCall = null;
        unregisterReceiver();
        if (safetyTimeout != null) {
            handler.removeCallbacks(safetyTimeout);
            safetyTimeout = null;
        }
        finishSend(false, "SMS send was cancelled.", sentOk);
    }
}
