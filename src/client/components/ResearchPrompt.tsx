/** Read-only model-facing prompt preview with an explicit copy action. */

import { useState } from 'react'
import { Button, CodeBlock, IconCopyOutlineRegular, IconInfoOutlineRegular, IconSparkleRegular, Tag } from '@deepseek-ai/dsh-client-ui-primitives'
import type { ResearchConfig } from '../../shared/defaults.ts'
import { buildResearchPromptPreview } from '../../research/prompt.ts'
import { Notice } from './Feedback.tsx'
import type { Translate } from './Field.tsx'
import { SectionCard } from './SectionCard.tsx'

export function ResearchPrompt({ research, t }: { research: ResearchConfig; t: Translate }): React.ReactElement {
  const preview = buildResearchPromptPreview(research)
  const [copy, setCopy] = useState<'idle' | 'copied' | 'failed'>('idle')
  const copyPrompt = async (): Promise<void> => {
    try {
      if (navigator.clipboard === undefined) throw new Error('clipboard unavailable')
      await navigator.clipboard.writeText(preview.text)
      setCopy('copied')
    } catch {
      setCopy('failed')
    }
  }
  return (
    <SectionCard
      icon={<IconSparkleRegular size={16} />}
      title={t('researchPromptTitle')}
      description={t('researchPromptHint')}
      aside={(
        <Button
          size="sm"
          variant="ghost"
          className="dshst-copy-btn"
          icon={<IconCopyOutlineRegular size={13} />}
          disabled={!preview.enabled}
          onClick={() => { void copyPrompt() }}
        >{copy === 'copied' ? t('copiedPrompt') : copy === 'failed' ? t('copyFailed') : t('copyPrompt')}</Button>
      )}
    >
      {preview.enabled ? null : <Notice tone="warning" icon={<IconInfoOutlineRegular size={14} />}>{t('researchPromptDisabled')}</Notice>}
      <div className="dshst-code-head">
        <Tag tone="outline">{t('researchPromptEnglishShort')}</Tag>
      </div>
      <div className="dshst-codeblock" data-testid="research-prompt">
        <CodeBlock
          code={preview.text}
          lang="text"
          showHeader={false}
          className="dshst-prompt-code"
          copyLabel={t('copyPrompt')}
          copiedLabel={t('copiedPrompt')}
        />
      </div>
      <p className="dshst-field-hint">{t('researchPromptEnglish')}</p>
    </SectionCard>
  )
}
