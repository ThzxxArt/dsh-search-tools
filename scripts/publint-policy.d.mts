import type { Message } from 'publint'

export function isBrowserBundleFormatFalsePositive(message: Message): boolean

export function partitionPublintMessages(messages: readonly Message[]): {
  ignored: Message[]
  reported: Message[]
}
