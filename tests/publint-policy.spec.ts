import type { Message } from 'publint'
import { describe, expect, it } from 'vitest'
import {
  isBrowserBundleFormatFalsePositive,
  partitionPublintMessages,
} from '../scripts/publint-policy.mjs'

function message(actualFilePath: string, code: Message['code'] = 'FILE_INVALID_FORMAT'): Message {
  return {
    code,
    type: 'warning',
    args: {
      actualFormat: 'cjs',
      expectFormat: 'esm',
      actualExtension: '.js',
      expectExtension: '.mjs',
      actualFilePath,
    },
    path: ['./client'],
  } as Message
}

describe('publint browser-bundle policy', () => {
  it('ignores only the exact DSH client entry format verdict', () => {
    expect(isBrowserBundleFormatFalsePositive(message('package/lib/client.js'))).toBe(true)
  })

  it('does not hide Node entries or sibling chunks', () => {
    expect(isBrowserBundleFormatFalsePositive(message('package/lib/index.js'))).toBe(false)
    expect(isBrowserBundleFormatFalsePositive(message('package/lib/client.node.js'))).toBe(false)
  })

  it('does not hide other diagnostics for the client entry', () => {
    expect(isBrowserBundleFormatFalsePositive(message('package/lib/client.js', 'FILE_DOES_NOT_EXIST'))).toBe(false)
  })

  it('partitions ignored and reported messages without changing order', () => {
    const messages = [
      message('package/lib/client.js'),
      message('package/lib/index.js'),
      message('package/lib/client.js', 'FILE_DOES_NOT_EXIST'),
    ]
    const result = partitionPublintMessages(messages)
    expect(result.ignored).toEqual([messages[0]])
    expect(result.reported).toEqual([messages[1], messages[2]])
  })
})
