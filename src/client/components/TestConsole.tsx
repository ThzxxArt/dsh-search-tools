/** Inline search/fetch test controls and the structured result reader. */

import { useEffect, useRef, useState } from 'react'
import {
  Button, CodeBlock, IconCopyOutlineRegular, IconPlayOutlineRegular, Input, Tag,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { PreviewState } from '../preview-types.ts'
import type { Translate } from './Field.tsx'

export function TestConsole({ t, kind, value, placeholder, label, testing, disabled, onChange, onTest }: {
  t: Translate
  kind: 'search' | 'fetch'
  value: string
  placeholder: string
  label: string
  testing: boolean
  disabled: boolean
  onChange: (value: string) => void
  onTest: () => void
}): React.ReactElement {
  return (
    <div className="dshst-console" data-kind={kind}>
      <div className="dshst-console-row">
        <Input
          className="dshst-input"
          aria-label={label}
          value={value}
          placeholder={placeholder}
          disabled={testing}
          onChange={event => { onChange(event.target.value) }}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !disabled) { event.preventDefault(); onTest() }
          }}
        />
        <Button
          className="dshst-console-btn"
          size="sm"
          variant="outline"
          icon={<IconPlayOutlineRegular size={13} />}
          aria-label={`${t('test')} ${label}`}
          disabled={disabled}
          onClick={onTest}
        >{testing ? t('testing') : t('test')}</Button>
      </div>
    </div>
  )
}

export function TestResult({ preview, t }: { preview: PreviewState | undefined; t: Translate }): React.ReactElement | null {
  const ref = useRef<HTMLDivElement>(null)
  const [contentOpen, setContentOpen] = useState(true)
  const [copy, setCopy] = useState<'idle' | 'copied' | 'failed'>('idle')

  useEffect(() => {
    if (preview === undefined) return
    setContentOpen(true)
    setCopy('idle')
    const node = ref.current
    if (node !== null && typeof node.scrollIntoView === 'function') node.scrollIntoView({ block: 'nearest' })
  }, [preview])

  if (preview === undefined) return null

  const copyContent = async (): Promise<void> => {
    try {
      if (navigator.clipboard === undefined || preview.content === undefined) throw new Error('clipboard unavailable')
      await navigator.clipboard.writeText(preview.content)
      setCopy('copied')
    } catch {
      setCopy('failed')
    }
  }

  return (
    <div className="dshst-test-result" ref={ref} aria-live="polite">
      <div className="dshst-test-head">
        <div className="dshst-test-title">{t('preview')}</div>
        <Tag tone={preview.ok ? 'success' : 'danger'}>{preview.ok ? t('testOk') : t('testFail')}</Tag>
        {preview.elapsedMs === undefined ? null : <span className="dshst-field-hint">{t('elapsedMs', { ms: preview.elapsedMs })}</span>}
      </div>
      {preview.message === undefined ? null : <p className="dshst-field-error">{preview.message}</p>}
      {preview.kind === 'search' ? (
        (preview.sources ?? []).length === 0 ? <p className="dshst-field-hint">{t('noResults')}</p> : (
          <ul className="dshst-source-list">
            {(preview.sources ?? []).map((source, index) => (
              <li className="dshst-source" key={`${source.url}:${index}`}>
                <a className="dshst-source-title" href={source.url} target="_blank" rel="noreferrer noopener">{source.title ?? source.url}</a>
                <div className="dshst-source-url">{source.url}</div>
                {source.snippet === undefined ? null : <p className="dshst-source-snippet">{source.snippet}</p>}
              </li>
            ))}
          </ul>
        )
      ) : (
        <div className="dshst-console">
          <p className="dshst-field-hint">
            {preview.url ?? ''}
            {preview.statusCode === undefined ? '' : ` · HTTP ${preview.statusCode}`}
            {preview.bodyKind === undefined ? '' : ` · ${preview.bodyKind}`}
            {preview.chars === undefined ? '' : ` · ${preview.chars} ${t('chars')}`}
            {preview.truncated === true ? ` · ${t('truncated')}` : ''}
          </p>
          {preview.content === undefined ? null : (
            <div className="dshst-reader">
              <div className="dshst-reader-bar">
                <span className="dshst-field-hint">{t('fetchReaderTitle')}</span>
                <div className="dshst-actions">
                  <Button
                    size="sm"
                    variant="ghost"
                    className="dshst-copy-btn"
                    icon={<IconCopyOutlineRegular size={13} />}
                    aria-label={t('copyContent')}
                    onClick={() => { void copyContent() }}
                  >{copy === 'copied' ? t('copiedContent') : copy === 'failed' ? t('copyFailed') : t('copyContent')}</Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    aria-expanded={contentOpen}
                    onClick={() => { setContentOpen(value => !value) }}
                  >{contentOpen ? t('hideContent') : t('showContent')}</Button>
                </div>
              </div>
              {contentOpen ? (
                <div className="dshst-codeblock dshst-fetch-code">
                  <CodeBlock
                    code={preview.content}
                    lang={preview.bodyKind === 'html' ? 'html' : 'text'}
                    showHeader={false}
                    copyLabel={t('copyContent')}
                    copiedLabel={t('copiedContent')}
                  />
                </div>
              ) : null}
            </div>
          )}
        </div>
      )}
      {preview.kind === 'search' && (preview.notes?.length ?? 0) > 0 ? (
        <div>
          <p className="dshst-field-hint">{t('searchNotes')}</p>
          <ul className="dshst-research-list">
            {(preview.notes ?? []).map(note => <li key={note}>{note}</li>)}
          </ul>
        </div>
      ) : null}
    </div>
  )
}
