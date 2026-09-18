# ============================================
# Capacitor + Cordova ProGuard Rules
# ============================================

# Keep Capacitor classes
-keep class com.getcapacitor.** { *; }
-keep class com.getcapacitor.plugin.** { *; }

# Keep Capacitor Bridge
-keep class com.getcapacitor.BridgeActivity { *; }
-keep class com.getcapacitor.BridgeFragment { *; }

# Keep JavaScript interface
-keepclassmembers class com.getcapacitor.Bridge {
    public *;
}

# Keep plugin methods
-keepclassmembers class * {
    @com.getcapacitor.PluginMethod <methods>;
}

# Keep annotation classes
-keep @interface com.getcapacitor.annotation.CapacitorPlugin { *; }
-keep @interface com.getcapacitor.annotation.PluginMethod { *; }
-keep @interface com.getcapacitor.annotation.ActivityCallback { *; }

# Keep your custom plugins
-keep class com.eboses.app.SmsInboxPlugin { *; }
-keep class com.eboses.app.SavedCredentialsPlugin { *; }

# Keep WebView JS interfaces
-keepclassmembers class * {
    @android.webkit.JavascriptInterface <methods>;
}

# Keep source line numbers for debugging
-keepattributes SourceFile,LineNumberTable

# Keep generic signatures
-keepattributes *Annotation*

# Keep all native methods
-keepclasseswithmembernames class * {
    native <methods>;
}

# ============================================
# Google Play Services (for SmsInbox)
# ============================================
-keep class com.google.android.gms.auth.api.phone.** { *; }
-keep class com.google.android.gms.common.** { *; }

# ============================================
# AndroidX
# ============================================
-keep class androidx.** { *; }
-keep interface androidx.** { *; }

