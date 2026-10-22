/** Model-facing contract for `web_research`, shared by the tool and settings preview. */

import type { ResearchConfig } from '../shared/defaults.ts'

export const RESEARCH_TOOL_NAME = 'web_research'

export const RESEARCH_TOOL_DESCRIPTION = 'Search the web, fetch the top results, and return readable page content in one call. Use this when you need page content, not only source links.'

/** Passed verbatim to `defineTool`; the preview uses the same names/descriptions. */
export const RESEARCH_TOOL_PARAMETERS = {
  query: { type: 'string', required: true, description: 'Search query.' },
  max_results: { type: 'number', description: 'Number of sources to return (bounded by deployment config).' },
  fetch_top: { type: 'number', description: 'Number of top results to fetch; 0 returns sources only.' },
  max_chars: { type: 'number', description: 'Per-page character budget (bounded by deployment config).' },
} as const

const PARAMETER_NAMES = ['query', 'max_results', 'fetch_top', 'max_chars'] as const

export interface ResearchPromptParameter {
  name: string
  type: 'string' | 'number'
  required?: boolean
  description: string
  /** Default and ceiling shown to the user, derived from the current draft. */
  effective: string
}

export interface ResearchPromptPreview {
  enabled: boolean
  name: string
  description: string
  parameters: readonly ResearchPromptParameter[]
  limits: readonly string[]
  text: string
}

/** Build the read-only preview from the same values that clamp the live tool. */
export function buildResearchPromptPreview(config: ResearchConfig): ResearchPromptPreview {
  const maxResults = Math.max(1, config.maxResults)
  const maxFetch = Math.max(1, config.maxFetch)
  const maxChars = Math.max(1_000, config.maxCharsPerPage)
  const parameters = PARAMETER_NAMES.map((name): ResearchPromptParameter => {
    const parameter = RESEARCH_TOOL_PARAMETERS[name]
    return {
      name,
      type: parameter.type,
      ...('required' in parameter ? { required: true } : {}),
      description: parameter.description,
      effective: effectiveValue(name, {
        maxResults,
        maxFetch,
        defaultFetchTop: Math.min(config.defaultFetchTop, maxFetch),
        maxChars,
      }),
    }
  })
  const limits = [
    `Total content budget: ${formatNumber(config.maxTotalChars)} characters`,
    `Fetch concurrency: ${config.concurrency}`,
    `Tool timeout: ${formatNumber(config.timeoutMs)} ms`,
  ]
  const text = [
    RESEARCH_TOOL_NAME,
    '',
    RESEARCH_TOOL_DESCRIPTION,
    '',
    'Parameters:',
    ...parameters.flatMap(parameter => [
      `- ${parameter.name} (${parameter.type}${parameter.required === true ? ', required' : ''}) — ${parameter.description}`,
      ...(parameter.effective.length === 0 ? [] : [`  ${parameter.effective}`]),
    ]),
    '',
    'Runtime limits:',
    ...limits.map(limit => `- ${limit}`),
  ].join('\n')
  return {
    enabled: config.enabled,
    name: RESEARCH_TOOL_NAME,
    description: RESEARCH_TOOL_DESCRIPTION,
    parameters,
    limits,
    text,
  }
}

function effectiveValue(
  name: string,
  values: { maxResults: number; maxFetch: number; defaultFetchTop: number; maxChars: number },
): string {
  if (name === 'max_results') return `Default ${values.maxResults}; range 1–${values.maxResults}.`
  if (name === 'fetch_top') return `Default ${values.defaultFetchTop}; range 0–${values.maxFetch}.`
  if (name === 'max_chars') return `Default ${formatNumber(values.maxChars)}; range 1,000–${formatNumber(values.maxChars)}.`
  return ''
}

function formatNumber(value: number): string {
  return value.toLocaleString('en-US')
}
