/** The `web_research` model tool. */

import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { Config } from '../config.ts'
import type { JsonValue } from '../core/types.ts'
import { runResearch, researchMeta, type ResearchArgs, type ResearchValue } from './pipeline.ts'
import { RESEARCH_TOOL_DESCRIPTION, RESEARCH_TOOL_NAME, RESEARCH_TOOL_PARAMETERS } from './prompt.ts'
import { renderResearch } from './render.ts'

export { RESEARCH_TOOL_NAME } from './prompt.ts'

/** Register the tool. The caller owns the returned disposer. */
export function applyResearchTool(ctx: Context, config: Config): () => void {
  return ctx.tools.register(defineTool({
    name: RESEARCH_TOOL_NAME,
    description: RESEARCH_TOOL_DESCRIPTION,
    parameters: RESEARCH_TOOL_PARAMETERS,
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
