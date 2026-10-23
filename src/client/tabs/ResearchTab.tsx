/** Research tab: scope, character budget, execution, and model-facing prompt. */

import { IconBrowseOutlineRegular, IconGaugeOutlineRegular, IconSparkleRegular } from '@deepseek-ai/dsh-client-ui-primitives'
import type { SettingsModel } from '../settings-model.ts'
import { ResearchBudget } from '../components/ResearchBudget.tsx'
import { ResearchPrompt } from '../components/ResearchPrompt.tsx'
import { SectionCard } from '../components/SectionCard.tsx'
import { BooleanRow, NumberRow } from '../components/SettingRows.tsx'

export function ResearchTab({ model }: { model: SettingsModel }): React.ReactElement {
  const { t, draft, readOnly, edit } = model
  const research = draft.research
  return (
    <div className="dshst-stack">
      <SectionCard icon={<IconSparkleRegular size={16} />} title={t('researchScope')} description={t('researchHint')}>
        <div className="dshst-group-body">
          <BooleanRow
            t={t}
            label={t('researchEnabled')}
            hint={t('researchEnabledHint')}
            checked={research.enabled}
            disabled={readOnly}
            onChange={(value) => edit({ ...draft, research: { ...research, enabled: value } })}
          />
          <NumberRow label={t('researchMaxResults')} value={research.maxResults} min={1} max={20} disabled={readOnly} onChange={(value) => edit({ ...draft, research: { ...research, maxResults: value } })} />
          <NumberRow label={t('researchMaxFetch')} value={research.maxFetch} min={1} max={10} disabled={readOnly} onChange={(value) => edit({ ...draft, research: { ...research, maxFetch: value } })} />
          <NumberRow label={t('researchDefaultFetchTop')} value={research.defaultFetchTop} min={0} max={10} disabled={readOnly} onChange={(value) => edit({ ...draft, research: { ...research, defaultFetchTop: value } })} />
        </div>
      </SectionCard>
      <SectionCard icon={<IconBrowseOutlineRegular size={16} />} title={t('contentBudget')} description={t('contentBudgetHint')}>
        <div className="dshst-group-body">
          <NumberRow label={t('researchMaxCharsPerPage')} value={research.maxCharsPerPage} min={1000} max={200000} step={1000} unit={t('chars')} disabled={readOnly} onChange={(value) => edit({ ...draft, research: { ...research, maxCharsPerPage: value } })} />
          <NumberRow label={t('researchMaxTotalChars')} value={research.maxTotalChars} min={1000} max={500000} step={1000} unit={t('chars')} disabled={readOnly} onChange={(value) => edit({ ...draft, research: { ...research, maxTotalChars: value } })} />
          <div className="dshst-span2"><ResearchBudget research={research} t={t} /></div>
        </div>
      </SectionCard>
      <SectionCard icon={<IconGaugeOutlineRegular size={16} />} title={t('execution')} description={t('executionHint')}>
        <div className="dshst-group-body">
          <NumberRow label={t('researchConcurrency')} value={research.concurrency} min={1} max={8} disabled={readOnly} onChange={(value) => edit({ ...draft, research: { ...research, concurrency: value } })} />
          <NumberRow label={t('researchTimeout')} value={research.timeoutMs} min={5000} max={600000} step={1000} unit="ms" disabled={readOnly} onChange={(value) => edit({ ...draft, research: { ...research, timeoutMs: value } })} />
        </div>
      </SectionCard>
      <ResearchPrompt research={research} t={t} />
    </div>
  )
}
