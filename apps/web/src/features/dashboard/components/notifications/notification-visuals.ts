import {
  AtSignIcon,
  BellRingIcon,
  CheckCircle2Icon,
  CircleXIcon,
  ConstructionIcon,
  FilePlus2Icon,
  FileTextIcon,
  MegaphoneIcon,
  MessageCircleIcon,
  MessageCircleQuestionIcon,
  MessageCircleReplyIcon,
  MessagesSquareIcon,
  ScaleIcon,
  SearchCheckIcon,
  ShieldCheckIcon,
  ShieldOffIcon,
  TriangleAlertIcon,
  UserRoundCheckIcon,
  type LucideIcon,
} from "lucide-react"

import type { NotificationItem } from "@/features/dashboard/components/notification-context"

export type NotificationVisual = { Icon: LucideIcon; chipClass: string }

function typeOf(item: NotificationItem) {
  return (item.type ?? "").toLowerCase()
}

function categoryOf(item: NotificationItem) {
  return (item.category ?? "").toLowerCase()
}

export function isConversationNotification(item: NotificationItem) {
  const type = typeOf(item)
  return categoryOf(item) === "chat" || type === "chat_message"
}

export function isEmergencyNotification(item: NotificationItem) {
  const type = typeOf(item)
  if (isConversationNotification(item)) return false
  return (
    categoryOf(item) === "emergency" ||
    Boolean(item.emergency_id) ||
    type.startsWith("emergency") ||
    type === "witness_alert"
  )
}

function urgentClass(item: NotificationItem, fallback: string) {
  if (item.priority === "urgent") return "bg-sos/10 text-sos"
  return fallback
}

export function notificationIconFor(item: NotificationItem): NotificationVisual {
  const type = typeOf(item)
  const category = categoryOf(item)

  if (type === "announcement" || category === "announcement") {
    return {
      Icon: MegaphoneIcon,
      chipClass: urgentClass(item, "bg-brand-orange-soft text-brand-orange-strong"),
    }
  }

  if (isConversationNotification(item)) {
    if (type === "concern_mention") {
      return { Icon: AtSignIcon, chipClass: "bg-violet-50 text-violet-700" }
    }
    if (type === "clarification_requested") {
      return { Icon: MessageCircleQuestionIcon, chipClass: "bg-amber-50 text-amber-700" }
    }
    if (type === "clarification_replied") {
      return { Icon: MessageCircleReplyIcon, chipClass: "bg-blue-50 text-blue-700" }
    }
    return {
      Icon: type === "chat_message" ? MessagesSquareIcon : MessageCircleIcon,
      chipClass: "bg-blue-50 text-blue-700",
    }
  }

  if (isEmergencyNotification(item)) {
    return { Icon: TriangleAlertIcon, chipClass: "bg-sos/10 text-sos" }
  }

  if (category === "appeal" || type.includes("appeal")) {
    if (type.endsWith("approved")) {
      return { Icon: ScaleIcon, chipClass: "bg-emerald-50 text-emerald-700" }
    }
    if (type.endsWith("denied")) {
      return { Icon: ScaleIcon, chipClass: "bg-rose-50 text-rose-700" }
    }
    return { Icon: ScaleIcon, chipClass: "bg-violet-50 text-violet-700" }
  }

  if (type === "flag_dismissed") {
    return { Icon: ShieldCheckIcon, chipClass: "bg-emerald-50 text-emerald-700" }
  }
  if (type === "post_taken_down" || type === "comment_taken_down") {
    return { Icon: ShieldOffIcon, chipClass: "bg-rose-50 text-rose-700" }
  }

  switch (type) {
    case "submitted":
      return { Icon: FilePlus2Icon, chipClass: "bg-blue-50 text-blue-700" }
    case "under_review":
      return { Icon: SearchCheckIcon, chipClass: "bg-indigo-50 text-indigo-700" }
    case "assigned":
      return { Icon: UserRoundCheckIcon, chipClass: "bg-brand-orange-soft text-brand-orange-strong" }
    case "in_progress":
      return { Icon: ConstructionIcon, chipClass: "bg-amber-50 text-amber-700" }
    case "resolved":
      return { Icon: CheckCircle2Icon, chipClass: "bg-emerald-50 text-emerald-700" }
    case "rejected":
      return { Icon: CircleXIcon, chipClass: "bg-rose-50 text-rose-700" }
    case "clarification_requested":
      return { Icon: MessageCircleQuestionIcon, chipClass: "bg-amber-50 text-amber-700" }
    case "clarification_replied":
      return { Icon: MessageCircleReplyIcon, chipClass: "bg-blue-50 text-blue-700" }
    case "concern_comment":
      return { Icon: MessageCircleIcon, chipClass: "bg-blue-50 text-blue-700" }
    case "concern_mention":
      return { Icon: AtSignIcon, chipClass: "bg-violet-50 text-violet-700" }
    case "chat_message":
      return { Icon: MessagesSquareIcon, chipClass: "bg-blue-50 text-blue-700" }
    case "system":
      return { Icon: BellRingIcon, chipClass: "bg-slate-100 text-slate-600" }
    default:
      return { Icon: FileTextIcon, chipClass: "bg-slate-100 text-slate-700" }
  }
}
