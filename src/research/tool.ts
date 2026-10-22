/** The `web_research` model tool. */

import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { Config } from '../config.ts'
import type { JsonValue } from '../core/types.ts'
import { runResearch, researchMeta, type ResearchArgs, type ResearchValue } from './pipeline.ts'
import { renderResearch } from './render.ts'

export const RESEARCH_TOOL_NAME = 'web_research'

/** Register the tool. The caller owns the returned disposer. */
export function applyResearchTool(ctx: Context, config: Config): () => void {
  return ctx.tools.register(defineTool({
    name: RESEARCH_TOOL_NAME,
    description: 'Search the web, fetch the top results, and return readable page content in one call. Use this when you need page content, not only source links.',
    parameters: {
      query: { type: 'string', required: true, description: 'Search query.' },
      max_results: { type: 'number', description: 'Number of sources to return (bounded by deployment config).' },
      fetch_top: { type: 'number', description: 'Number of top results to fetch; 0 returns sources only.' },
      max_chars: { type: 'number', description: 'Per-page character budget (bounded by deployment config).' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          query: { type: 'string', required: true },
          sources: {
            type: 'array',
            required: true,
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                url: { type: 'string', required: true },
                title: { type: 'string' },
                snippet: { type: 'string' },
                publishedAt: { type: 'string' },
              },
            },
          },
          fetched: {
            type: 'array',
            required: true,
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                url: { type: 'string', required: true },
                title: { type: 'string' },
                content: { type: 'string', required: true },
                truncated: { type: 'boolean', required: true },
                error: { type: 'string' },
              },
            },
          },
          truncated: { type: 'boolean', required: true },
        },
      },
      render: (_args, value) => [{ type: 'text', text: renderResearch(value as ResearchValue) }],
      presentationMeta: (_args, value) => researchMeta(value as ResearchValue) as JsonValue,
    },
    timeoutMs: 120_000,
    isConcurrencySafe: () => true,
    async execute(args, exec) {
      return await runResearch(ctx, config, args as ResearchArgs, exec.signal)
    },
  }))
}
