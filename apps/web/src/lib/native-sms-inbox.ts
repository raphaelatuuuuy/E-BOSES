import { Capacitor, registerPlugin } from "@capacitor/core"

interface SmsInboxPlugin {
  requestSmsUpdate(options: { sender: string }): Promise<{
    sender: string
    body: string
  } | null>
  sendSms(options: { to: string; body: string }): Promise<{ parts: number }>
  openSms(options: { to: string; body?: string }): Promise<void>
}

const SmsInbox = registerPlugin<SmsInboxPlugin>("SmsInbox")

export function canUseSmsInbox() {
  return Capacitor.isNativePlatform() && Capacitor.getPlatform() === "android"
}

export async function requestSmsUpdate(
  sender: string
): Promise<{ sender: string; body: string } | null> {
  if (!canUseSmsInbox()) return null
  try {
    const result = await SmsInbox.requestSmsUpdate({ sender })
    if (!result?.body) return null
    return { sender: result.sender ?? "", body: result.body }
  } catch {
    return null
  }
}

export function canSendSms() {
  return canUseSmsInbox()
}

export async function sendSmsText(
  to: string,
  body: string
): Promise<{ parts: number }> {
  if (!canSendSms())
    throw new Error("Automatic SMS is only available in the Android app.")
  const result = await SmsInbox.sendSms({ to, body })
  return { parts: Number(result?.parts ?? 1) || 1 }
}

export async function openSmsApp(to: string, body?: string) {
  if (canUseSmsInbox()) {
    try {
      await SmsInbox.openSms({ to, body })
      return
    } catch {
      // Fall back to the platform URL if no SMS activity is available.
    }
  }
  const query = body ? `?body=${encodeURIComponent(body)}` : ""
  window.location.href = `sms:${to}${query}`
}
