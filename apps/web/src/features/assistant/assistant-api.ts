import { apiRequest } from "@/lib/api"

export interface AssistantChip {
  id: string
  label: string
  icon: string
}

export interface AssistantAnswer {
  reply: string
  suggestions: AssistantChip[]
  source: "rules" | "model" | "fallback"
}

export interface AssistantTopics {
  greeting: string
  topics: AssistantChip[]
}

export interface AssistantTurn {
  role: "user" | "assistant"
  content: string
}

const SESSION_KEY = "eboses_assistant_session"

export function assistantSessionId() {
  const stores = [localStorage, sessionStorage]
  for (const store of stores) {
    try {
      const stored = store.getItem(SESSION_KEY)
      if (stored) return stored
    } catch {
      continue
    }
  }
  const created = crypto.randomUUID()
  for (const store of stores) {
    try {
      store.setItem(SESSION_KEY, created)
      break
    } catch {
      continue
    }
  }
  return created
}

export function fetchAssistantTopics() {
  return apiRequest<AssistantTopics>(
    "/assistant/topics/",
    {},
    { auth: false, refreshOnUnauthorized: false },
  )
}

export function askAssistant(payload: {
  message?: string
  topicId?: string
  history?: AssistantTurn[]
}) {
  return apiRequest<AssistantAnswer>(
    "/assistant/ask/",
    {
      method: "POST",
      body: JSON.stringify({
        message: payload.message ?? "",
        topic_id: payload.topicId ?? "",
        history: payload.history ?? [],
        session_id: assistantSessionId(),
      }),
    },
    { auth: false, refreshOnUnauthorized: false, csrf: true },
  )
}
