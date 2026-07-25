/** Matches backend ContentFlag.Reason */
export type FlagReasonCode =
  | "irrelevant"
  | "false_info"
  | "sensitive"
  | "abusive"
  | "other"

export type ReportSubReason = {
  id: string
  title: string
  description?: string
}

export type ReportCategory = {
  id: string
  title: string
  description: string
  apiReason: FlagReasonCode
  children: ReportSubReason[]
}

/** E-Boses / barangay taxonomy — same multi-step shape as Nextdoor samples */
export const REPORT_CATEGORIES: ReportCategory[] = [
  {
    id: "spam",
    title: "Spam or commercial content",
    description: "Ads, selling, scams, or repetitive posts",
    apiReason: "irrelevant",
    children: [
      {
        id: "ads",
        title: "Advertising or selling",
        description: "Promoting a product, service, or business",
      },
      {
        id: "spam",
        title: "Spam or repetitive content",
        description: "Same message posted repeatedly",
      },
      {
        id: "scam",
        title: "Scam or phishing",
        description: "Suspicious links, money requests, or fraud",
      },
    ],
  },
  {
    id: "false",
    title: "False or misleading information",
    description: "Untrue claims, wrong location, or deceptive media",
    apiReason: "false_info",
    children: [
      {
        id: "false_incident",
        title: "False information about an incident",
        description: "Claims that misrepresent what happened",
      },
      {
        id: "misleading_media",
        title: "Misleading photo or video",
        description: "Media that doesn't match the report",
      },
      {
        id: "wrong_location",
        title: "Wrong or fake location",
        description: "Pin or address that doesn't match the issue",
      },
    ],
  },
  {
    id: "offensive",
    title: "Offensive or abusive content",
    description: "Harassment, hate, threats, or personal attacks",
    apiReason: "abusive",
    children: [
      {
        id: "harassment",
        title: "Harassment or bullying",
        description: "Targeting a person with insults or intimidation",
      },
      {
        id: "hate",
        title: "Hate speech or discrimination",
        description: "Content attacking people based on identity",
      },
      {
        id: "threats",
        title: "Threats or violent language",
        description: "Threats of harm or calls to violence",
      },
      {
        id: "name_calling",
        title: "Name-calling or personal attacks",
        description: "Insults directed at a neighbor or official",
      },
    ],
  },
  {
    id: "sensitive",
    title: "Sensitive or unsafe content",
    description: "Graphic media, private data, or dangerous activity",
    apiReason: "sensitive",
    children: [
      {
        id: "graphic",
        title: "Graphic or disturbing content",
        description: "Images or descriptions that are too graphic",
      },
      {
        id: "privacy",
        title: "Personal information exposed",
        description: "Phone, address, ID, or private details shared",
      },
      {
        id: "danger",
        title: "Dangerous or illegal activity",
        description: "Content that could put people at risk",
      },
    ],
  },
  {
    id: "not_concern",
    title: "Not a community concern",
    description: "Outside the barangay, off-topic, or private dispute",
    apiReason: "irrelevant",
    children: [
      {
        id: "outside_area",
        title: "Outside Marikina Heights",
        description: "Issue is not in our barangay service area",
      },
      {
        id: "private_dispute",
        title: "Personal or private dispute",
        description: "Not a public community or barangay issue",
      },
      {
        id: "off_topic",
        title: "Off-topic for the community feed",
        description: "Doesn't relate to neighborhood concerns",
      },
    ],
  },
  {
    id: "other",
    title: "Something else",
    description: "Another reason not listed above",
    apiReason: "other",
    children: [],
  },
]
