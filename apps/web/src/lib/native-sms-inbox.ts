import { Capacitor, registerPlugin } from "@capacitor/core"

interface SmsInboxPlugin {
  requestSmsUpdate(options: { sender: string }): Promise<{
    sender: string
    body: string
  } | null>
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
