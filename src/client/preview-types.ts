/** Structured adapter-test result shared by the page and the test console. */

export interface PreviewState {
  kind: 'search' | 'fetch'
  ok: boolean
  elapsedMs?: number
  sources?: Array<{ url: string; title?: string; snippet?: string }>
  notes?: string[]
  url?: string
  statusCode?: number
  bodyKind?: 'html' | 'text'
  content?: string
  chars?: number
  truncated?: boolean
  message?: string
}
