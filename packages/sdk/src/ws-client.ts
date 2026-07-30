import type { WsResponseMessage } from '@ai-workspace/types'

export type MessageHandler = (data: WsResponseMessage['data']) => void

export class WsClient {
  private ws: WebSocket | null = null
  private handlers = new Set<MessageHandler>()
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private shouldReconnect = true

  constructor(private url: string) {}

  connect() {
    if (this.ws?.readyState === WebSocket.OPEN) return
    this.shouldReconnect = true

    this.ws = new WebSocket(this.url)
    this.ws.onopen = () => console.log('[SDK] WebSocket connected')
    this.ws.onmessage = (event) => {
      try {
        const msg: WsResponseMessage = JSON.parse(event.data)
        if (msg.event === 'ai:response') {
          this.handlers.forEach((h) => h(msg.data))
        }
      } catch {
        // ignore parse errors
      }
    }
    this.ws.onclose = () => {
      if (this.shouldReconnect) {
        this.reconnectTimer = setTimeout(() => this.connect(), 3000)
      }
    }
    this.ws.onerror = () => this.ws?.close()
  }

  send(prompt: string, model: string) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ event: 'ai:prompt', data: { prompt, model } }))
    }
  }

  onMessage(handler: MessageHandler): () => void {
    this.handlers.add(handler)
    return () => this.handlers.delete(handler)
  }

  disconnect() {
    this.shouldReconnect = false
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer)
    this.ws?.close()
    this.ws = null
  }
}
