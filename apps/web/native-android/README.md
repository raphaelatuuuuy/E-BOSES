# Versioned Android plugins

`apps/web/android/` is generated and gitignored, so custom native code lives here
and is copied in after `cap sync`.

## SmsInbox (SMS User Consent, no SMS permission needed)

1. Copy `SmsInboxPlugin.java` to
   `apps/web/android/app/src/main/java/com/eboses/app/`.
2. In `MainActivity.java` `onCreate`, before `super.onCreate`:
   `registerPlugin(SmsInboxPlugin.class);`
3. In `apps/web/android/app/build.gradle` dependencies:
   `implementation "com.google.android.gms:play-services-auth-api-phone:18.1.0"`
4. Rebuild the APK. The web side calls it through
   `src/lib/native-sms-inbox.ts`; on web builds it resolves to null.
