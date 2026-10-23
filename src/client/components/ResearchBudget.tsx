/** Projected character budget for one web_research call. */

import type { ResearchConfig } from '../../shared/defaults.ts'
import type { Translate } from './Field.tsx'

export function ResearchBudget({ research, t }: { research: ResearchConfig; t: Translate }): React.ReactElement {
  const total = research.defaultFetchTop * research.maxCharsPerPage
  const totalPercent = Math.min(100, Math.round((total / Math.max(1, research.maxTotalChars)) * 100))
  const pagePercent = Math.min(100, Math.round((research.maxCharsPerPage / Math.max(1, research.maxTotalChars)) * 100))
  const tone = total > research.maxTotalChars ? 'error' : total > research.maxTotalChars * 0.85 ? 'warning' : undefined
  const remaining = Math.max(0, research.maxTotalChars - total)
  const format = new Intl.NumberFormat()
  return (
    <div className="dshst-budget">
      <div className="dshst-budget-row">
        <div className="dshst-budget-head">
          <span className="dshst-budget-label">{t('budgetPerPage')}</span>
          <span className="dshst-budget-value">{t('budgetShare', { n: pagePercent })}</span>
        </div>
        <div className="dshst-meter" aria-hidden="true">
          <div className="dshst-meter-fill" style={{ width: `${pagePercent}%` }} />
        </div>
      </div>
      <div className="dshst-budget-row">
        <div className="dshst-budget-head">
          <span className="dshst-budget-label">{t('budgetProjected')}</span>
          <span className="dshst-budget-value">{t('budgetProjectedValue', { used: format.format(total), total: format.format(research.maxTotalChars) })}</span>
        </div>
        <div
          className="dshst-meter"
          role="progressbar"
          aria-label={t('budgetProjected')}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={totalPercent}
        >
          <div className="dshst-meter-fill" data-tone={tone} style={{ width: `${totalPercent}%` }} />
        </div>
        <span className="dshst-budget-label">{t('budgetRemaining', { n: format.format(remaining) })}</span>
      </div>
    </div>
  )
}
