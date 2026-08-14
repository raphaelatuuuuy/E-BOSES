import {
  BadgeCheckIcon,
  CopyIcon,
  GlobeIcon,
  HeadsetIcon,
  InfoIcon,
  ListChecksIcon,
  ListIcon,
  LockIcon,
  MegaphoneIcon,
  MessageSquareIcon,
  ShieldIcon,
  SirenIcon,
  UserPlusIcon,
  UsersIcon,
  type LucideIcon,
} from "lucide-react"

const ICONS: Record<string, LucideIcon> = {
  "user-plus": UserPlusIcon,
  megaphone: MegaphoneIcon,
  info: InfoIcon,
  lock: LockIcon,
  headset: HeadsetIcon,
  list: ListIcon,
  "badge-check": BadgeCheckIcon,
  shield: ShieldIcon,
  users: UsersIcon,
  siren: SirenIcon,
  "list-checks": ListChecksIcon,
  copy: CopyIcon,
  "message-square": MessageSquareIcon,
  globe: GlobeIcon,
}

export function chipIcon(name: string): LucideIcon {
  return ICONS[name] ?? InfoIcon
}
