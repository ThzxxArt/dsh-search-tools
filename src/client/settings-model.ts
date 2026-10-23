/** Shared view model passed from SettingsPage to the five tab components. */

import type { AdapterIssue, AdapterListResponse, JsonObject, LocalizedText, StatusResponse } from '../core/types.ts'
import type { StoredConfig } from '../shared/defaults.ts'
import type { CredentialInfo } from './credential-types.ts'
import type { InstanceTestResult, InstanceValue } from './components/InstanceCard.tsx'
import type { Translate } from './components/Field.tsx'
import type { PreviewState } from './preview-types.ts'

export type Tab = 'overview' | 'search' | 'fetch' | 'research' | 'diagnostics'
export type Testing = 'search' | 'fetch' | undefined

export interface SettingsModel {
  t: Translate
  text: (value: LocalizedText) => string
  draft: StoredConfig
  adapters: AdapterListResponse
  status: StatusResponse | undefined
  currentSearch: string
  currentFetch: string
  preview: PreviewState | undefined
  query: string
  fetchUrl: string
  testing: Testing
  readOnly: boolean
  refreshingAdapters: boolean
  searchIssues: readonly AdapterIssue[]
  fetchIssues: readonly AdapterIssue[]
  researchIssues: readonly AdapterIssue[]
  instanceTesting: string | undefined
  instanceResults: Record<string, InstanceTestResult>
  credentialInfo: Record<string, CredentialInfo>
  secretDrafts: Record<string, string>
  secretBusy: string | undefined
  secretErrors: Record<string, string>
  conflict: boolean
  setQuery: (value: string) => void
  setFetchUrl: (value: string) => void
  edit: (next: StoredConfig) => void
  onOpenTab: (tab: Tab) => void
  onRefreshAdapters: () => Promise<void>
  onSelectAdapter: (kind: 'search' | 'fetch', id: string) => void
  onTestInstance: (instance: InstanceValue) => Promise<void>
  onSecretDraft: (ref: string, value: string) => void
  onSecretSave: (ref: string) => Promise<void>
  onSecretClear: (ref: string) => Promise<void>
  runSearchTest: () => Promise<boolean>
  runFetchTest: () => Promise<boolean>
  setProvider: (kind: 'search' | 'fetch', enabled: boolean) => Promise<void>
  copyDiagnostics: () => Promise<void>
  copyPath: () => Promise<void>
  clearCache: () => Promise<void>
  clearDiagnostics: () => Promise<void>
}

export interface AdapterEdit {
  adapter: string
  adapters: Record<string, JsonObject>
}
