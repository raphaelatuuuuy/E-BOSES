import { Capacitor, registerPlugin } from "@capacitor/core"

interface SmsInboxPlugin {
  requestSmsUpdate(options: { sender: string }): Promise<{
    sender: string
    body: string
  } | null>
  sendSms(options: { to: string; body: string }): Promise<{ parts: number }>
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

export function openSmsApp(to: string, body: string) {
  window.location.href = `sms:${to}?body=${encodeURIComponent(body)}`
}
