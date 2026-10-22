import { publint } from 'publint'
import { formatMessage } from 'publint/utils'
import { partitionPublintMessages } from './publint-policy.mjs'

try {
  const { messages, pkg } = await publint({ pack: 'pnpm' })
  const { ignored, reported } = partitionPublintMessages(messages)

  if (ignored.length > 0) {
    console.log(
      `publint: ignored ${ignored.length} browser-bundle format false positive`
      + ' (lib/client.js is a DSH browser script, not a Node ESM entry).',
    )
  }

  if (reported.length === 0) {
    console.log('publint: no issues')
  } else {
    for (const message of reported) {
      const text = formatMessage(message, pkg, { color: process.stdout.isTTY })
        ?? `${message.code} at ${message.path.join('.')}`
      console.error(`${message.type}: ${text}`)
    }
    process.exitCode = 1
  }
} catch (error) {
  console.error('publint: failed to inspect the package')
  console.error(error)
  process.exitCode = 1
}
