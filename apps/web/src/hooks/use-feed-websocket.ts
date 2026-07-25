import { useEffect, useRef, useState } from "react"

import { websocketTicket, websocketUrl } from "@/lib/api"

/**
 * WebSocket events that should trigger a feed refresh.
 * These are broadcast by the backend when concerns, announcements, or
 * other feed-relevant content changes.
 */
export type FeedEvent =
  | { type: "concern.created"; concern_id: number }
  | { type: "concern.updated"; concern_id: number }
  | { type: "concern.deleted"; concern_id: number }
  | { type: "announcement.created" }
  | { type: "announcement.updated" }
  | { type: "announcement.deleted" }
  | { type: "feed.updated"; concern_id?: number }
  | { type: "feed.mention"; concern_id?: number }

export type FeedConnectionState = "connecting" | "live" | "degraded"

interface UseFeedWebsocketOptions {
  /**
   * Callback fired when any feed-relevant event is received.
   * The hook handles reconnection internally; this callback is only
   * called for events that should trigger a UI refresh.
   */
  onEvent?: (event: FeedEvent) => void
  /**
   * Whether to connect immediately. Useful for components that only
   * need the connection when visible.
   */
  enabled?: boolean
}

/**
 * Connects to the notifications WebSocket and listens for feed-relevant
 * events. Replaces the 30s polling interval with real-time updates.
 *
 * The WebSocket endpoint is the same one used by NotificationProvider
 * for notifications — it broadcasts all event types, and this hook
 * filters for feed-related ones.
 *
 * @example
 * ```tsx
 * const { connectionState } = useFeedWebsocket({
 *   onEvent: () => refreshFeed(),
 * })
 * ```
 */
export function useFeedWebsocket({ onEvent, enabled = true }: UseFeedWebsocketOptions) {
  const [connectionState, setConnectionState] = useState<FeedConnectionState>(
    enabled ? "connecting" : "degraded",
  )
  const onEventRef = useRef(onEvent)
  const knownEventIdsRef = useRef(new Set<string>())
  const hasConnectedRef = useRef(false)

  // Keep the callback ref current
  useEffect(() => {
    onEventRef.current = onEvent
  })

  useEffect(() => {
    if (!enabled) return

    let socket: WebSocket | null = null
    let reconnectTimer: ReturnType<typeof setTimeout> | undefined
    let closedByComponent = false
    let reconnectAttempts = 0

    function handleMessage(event: MessageEvent) {
      try {
        const message = JSON.parse(event.data) as { type?: string; event_id?: string; payload?: Record<string, unknown> }
        if (!message.type) return
        if (message.event_id) {
          if (knownEventIdsRef.current.has(message.event_id)) return
          knownEventIdsRef.current.add(message.event_id)
          if (knownEventIdsRef.current.size > 250) {
            const oldest = knownEventIdsRef.current.values().next().value
            if (oldest) knownEventIdsRef.current.delete(oldest)
          }
        }

        // Map WebSocket event types to feed events
        let feedEvent: FeedEvent | null = null

        switch (message.type) {
          case "feed.updated":
            feedEvent = {
              type: "feed.updated",
              concern_id: typeof message.payload?.concern_id === "number" ? message.payload.concern_id : undefined,
            }
            break
          case "feed.mention":
            feedEvent = {
              type: "feed.mention",
              concern_id: typeof message.payload?.concern_id === "number" ? message.payload.concern_id : undefined,
            }
            break
          case "concern.created":
            feedEvent = { type: "concern.created", concern_id: typeof message.payload?.concern_id === "number" ? message.payload.concern_id : 0 }
            break
          case "concern.updated":
            feedEvent = { type: "concern.updated", concern_id: typeof message.payload?.concern_id === "number" ? message.payload.concern_id : 0 }
            break
          case "concern.deleted":
            feedEvent = { type: "concern.deleted", concern_id: typeof message.payload?.concern_id === "number" ? message.payload.concern_id : 0 }
            break
          case "announcement.created":
            feedEvent = { type: "announcement.created" }
            break
          case "announcement.updated":
            feedEvent = { type: "announcement.updated" }
            break
          case "announcement.deleted":
            feedEvent = { type: "announcement.deleted" }
            break
          default:
            // Not a feed-relevant event (e.g., notification.created)
            return
        }

        if (feedEvent) onEventRef.current?.(feedEvent)
      } catch {
        // Ignore malformed messages
      }
    }

    async function connect() {
      if (closedByComponent) return
      setConnectionState("connecting")
      try {
        const ticket = await websocketTicket()

        socket = new WebSocket(
          websocketUrl(`/ws/notifications/?ticket=${encodeURIComponent(ticket)}`),
        )

        socket.onopen = () => {
          const reconnected = hasConnectedRef.current
          hasConnectedRef.current = true
          setConnectionState("live")
          reconnectAttempts = 0
          if (reconnected) onEventRef.current?.({ type: "feed.updated" })
        }

        socket.onmessage = handleMessage

        socket.onclose = () => {
          setConnectionState("degraded")
          if (closedByComponent) return

          reconnectAttempts += 1
          const delay = Math.min(30_000, 1500 * 2 ** reconnectAttempts)
          reconnectTimer = setTimeout(() => void connect(), delay)
        }

        socket.onerror = () => {
          socket?.close()
        }
      } catch {
        setConnectionState("degraded")
        if (closedByComponent) return

        reconnectAttempts += 1
        const delay = Math.min(30_000, 1500 * 2 ** reconnectAttempts)
        reconnectTimer = setTimeout(() => void connect(), delay)
      }
    }

    const connectTimer = setTimeout(() => void connect(), 0)

    return () => {
      closedByComponent = true
      clearTimeout(connectTimer)
      if (reconnectTimer) clearTimeout(reconnectTimer)
      if (socket) {
        socket.close()
      }
    }
  }, [enabled])

  return { connectionState }
}
