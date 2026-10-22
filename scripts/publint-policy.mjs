/**
 * DSH serves `lib/client.js` through its browser module loader as a CJS
 * factory, not through Node's ESM loader. publint therefore reports the
 * package-level `"type": "module"` as a format mismatch even though the file
 * is a valid browser artifact.
 *
 * Keep this exemption narrow: only `FILE_INVALID_FORMAT` for the exact
 * `lib/client.js` entry is ignored. Node entries and every other publint
 * diagnostic remain fatal.
 */

const CLIENT_BUNDLE = /(^|\/)lib\/client\.js$/

export function isBrowserBundleFormatFalsePositive(message) {
  if (message?.code !== 'FILE_INVALID_FORMAT') return false
  const filePath = message.args?.actualFilePath
  return typeof filePath === 'string' && CLIENT_BUNDLE.test(filePath)
}

export function partitionPublintMessages(messages) {
  const ignored = []
  const reported = []
  for (const message of messages) {
    if (isBrowserBundleFormatFalsePositive(message)) ignored.push(message)
    else reported.push(message)
  }
  return { ignored, reported }
}
