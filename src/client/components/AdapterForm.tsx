/** Manifest-driven fields, optional groups, collapsed advanced settings, and write-only secrets. */

import { useId } from 'react'
import {
  Button, IconChevronDownOutlineRegular, Input, Tag,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type {
  AdapterField, AdapterIssue, AdapterManifest, JsonObject, JsonValue, LocalizedText,
} from '../../core/types.ts'
import { getPath, setPath } from '../../shared/path.ts'
import type { CredentialInfo } from '../credential-types.ts'
import { issueText } from '../issue-text.ts'
import { Field, type Translate } from './Field.tsx'
import { InstanceEditor, type InstanceTestResult, type InstanceValue } from './InstanceCard.tsx'

type SecretRef = NonNullable<AdapterManifest['secretRefs']>[number]

export interface ResolvedAdapterGroup {
  id: string
  label: string
  description?: string | undefined
  advanced: boolean
  fields: AdapterField[]
  secrets: SecretRef[]
}

/**
 * Resolve manifest groups without requiring every adapter to declare them.
 * Unknown group ids fall back to the first group; advanced fields without a
 * declared advanced group get a generated disclosure.
 */
export function resolveAdapterGroups(
  manifest: AdapterManifest,
  text: (value: LocalizedText) => string,
  t: Translate,
): ResolvedAdapterGroup[] {
  const declared = manifest.groups ?? []
  const groups: ResolvedAdapterGroup[] = declared.map(group => ({
    id: group.id,
    label: text(group.label),
    description: group.description === undefined ? undefined : text(group.description),
    advanced: group.advanced === true,
    fields: [],
    secrets: [],
  }))
  const fallbackId = '__configured'
  if (groups.length === 0) {
    groups.push({
      id: fallbackId,
      label: t('configuration'),
      description: undefined,
      advanced: false,
      fields: [],
      secrets: [],
    })
  }
  const firstId = groups[0]?.id ?? fallbackId
  const groupFor = (id: string | undefined, advanced: boolean | undefined): ResolvedAdapterGroup => {
    if (id !== undefined) {
      const found = groups.find(group => group.id === id)
      if (found !== undefined) return found
    }
    if (advanced === true) {
      const existing = groups.find(group => group.id === '__advanced' || group.advanced)
      if (existing !== undefined) return existing
      const created: ResolvedAdapterGroup = {
        id: '__advanced',
        label: t('advanced'),
        description: undefined,
        advanced: true,
        fields: [],
        secrets: [],
      }
      groups.push(created)
      return created
    }
    return groups.find(group => group.id === firstId) ?? groups[0] as ResolvedAdapterGroup
  }

  for (const field of manifest.fields) {
    groupFor(field.group, field.advanced).fields.push(field)
  }
  for (const secret of manifest.secretRefs ?? []) {
    groupFor(secret.group, secret.advanced).secrets.push(secret)
  }
  return groups.filter(group => group.fields.length > 0 || group.secrets.length > 0)
}

export function AdapterForm({
  manifest, config, errors, disabled, text, t, onTestInstance, testingInstanceUrl, instanceResults,
  secretInfo, secretDrafts, secretBusy, onSecretDraft, onSecretSave, onSecretClear, onChange,
}: {
  manifest: AdapterManifest
  config: JsonObject
  errors: readonly AdapterIssue[]
  disabled: boolean
  text: (value: LocalizedText) => string
  t: Translate
  onTestInstance?: ((instance: InstanceValue) => void) | undefined
  testingInstanceUrl?: string | undefined
  instanceResults?: Record<string, InstanceTestResult> | undefined
  secretInfo: Record<string, CredentialInfo>
  secretDrafts: Record<string, string>
  secretBusy: string | undefined
  onSecretDraft: (ref: string, value: string) => void
  onSecretSave: (ref: string) => void
  onSecretClear: (ref: string) => void
  onChange: (config: JsonObject) => void
}): React.ReactElement {
  const groups = resolveAdapterGroups(manifest, text, t)
  return (
    <div className="dshst-group-list">
      {groups.map(group => (
        <GroupBlock
          key={group.id}
          group={group}
          config={config}
          errors={errors}
          disabled={disabled}
          text={text}
          t={t}
          onTestInstance={onTestInstance}
          testingInstanceUrl={testingInstanceUrl}
          instanceResults={instanceResults}
          secretInfo={secretInfo}
          secretDrafts={secretDrafts}
          secretBusy={secretBusy}
          onSecretDraft={onSecretDraft}
          onSecretSave={onSecretSave}
          onSecretClear={onSecretClear}
          onChange={onChange}
        />
      ))}
    </div>
  )
}

function GroupBlock({
  group, config, errors, disabled, text, t, onTestInstance, testingInstanceUrl, instanceResults,
  secretInfo, secretDrafts, secretBusy, onSecretDraft, onSecretSave, onSecretClear, onChange,
}: {
  group: ResolvedAdapterGroup
  config: JsonObject
  errors: readonly AdapterIssue[]
  disabled: boolean
  text: (value: LocalizedText) => string
  t: Translate
  onTestInstance?: ((instance: InstanceValue) => void) | undefined
  testingInstanceUrl?: string | undefined
  instanceResults?: Record<string, InstanceTestResult> | undefined
  secretInfo: Record<string, CredentialInfo>
  secretDrafts: Record<string, string>
  secretBusy: string | undefined
  onSecretDraft: (ref: string, value: string) => void
  onSecretSave: (ref: string) => void
  onSecretClear: (ref: string) => void
  onChange: (config: JsonObject) => void
}): React.ReactElement {
  const body = (
    <>
      {group.fields.map((field) => {
        const issue = errors.find(entry => entry.path === field.key || entry.path.startsWith(`${field.key}[`))
        const error = issue === undefined ? undefined : issueText(issue, t)
        if (field.kind === 'instances') {
          return (
            <div className="dshst-field" key={field.key} data-kind="instances" data-invalid={error === undefined ? undefined : 'true'}>
              <div className="dshst-field-label">{text(field.label)}</div>
              <InstanceEditor
                value={getPath(config, field.key)}
                disabled={disabled}
                invalid={error !== undefined}
                t={t}
                onTest={onTestInstance}
                testingUrl={testingInstanceUrl}
                results={instanceResults}
                onChange={(instances) => onChange(setPath(config, field.key, instances as unknown as JsonValue))}
              />
              {field.description === undefined ? null : <p className="dshst-field-hint">{text(field.description)}</p>}
              {error === undefined ? null : <p className="dshst-field-error" role="alert">{error}</p>}
            </div>
          )
        }
        return (
          <Field
            key={field.key}
            field={field}
            value={getPath(config, field.key)}
            disabled={disabled}
            error={error}
            secretConfigured={secretConfiguredFor(field, config, secretInfo)}
            secretWritable={secretWritableFor(field, config, secretInfo)}
            text={text}
            t={t}
            onChange={(value) => onChange(setPath(config, field.key, value))}
          />
        )
      })}
      {group.secrets.map(secret => (
        <SecretField
          key={secret.ref}
          secret={secret}
          config={config}
          info={secretInfo[secret.ref]}
          draft={secretDrafts[secret.ref] ?? ''}
          busy={secretBusy === secret.ref}
          disabled={disabled}
          text={text}
          t={t}
          onDraft={onSecretDraft}
          onSave={onSecretSave}
          onClear={onSecretClear}
        />
      ))}
    </>
  )

  if (group.advanced) {
    return (
      <details className="dshst-disclosure" data-testid={`adapter-group-${group.id}`}>
        <summary>
          <span className="dshst-disclosure-chevron" aria-hidden="true"><IconChevronDownOutlineRegular size={14} /></span>
          <span className="dshst-disclosure-title">{group.label}</span>
          {group.description === undefined ? null : <span className="dshst-disclosure-desc">{group.description}</span>}
          <span className="dshst-disclosure-count">{t('fieldCount', { n: group.fields.length + group.secrets.length })}</span>
        </summary>
        <div className="dshst-disclosure-body">{body}</div>
      </details>
    )
  }

  return (
    <section className="dshst-group" data-testid={`adapter-group-${group.id}`}>
      <div className="dshst-group-head">
        <h4 className="dshst-group-title">{group.label}</h4>
        {group.description === undefined ? null : <p className="dshst-group-desc">{group.description}</p>}
      </div>
      <div className="dshst-group-body">{body}</div>
    </section>
  )
}

function SecretField({ secret, config, info, draft, busy, disabled, text, t, onDraft, onSave, onClear }: {
  secret: SecretRef
  config: JsonObject
  info: CredentialInfo | undefined
  draft: string
  busy: boolean
  disabled: boolean
  text: (value: LocalizedText) => string
  t: Translate
  onDraft: (ref: string, value: string) => void
  onSave: (ref: string) => void
  onClear: (ref: string) => void
}): React.ReactElement | null {
  const authType = getPath(config, 'auth.type')
  if (secret.authType !== undefined && secret.authType !== authType) return null
  const id = useId()
  const configured = info?.configured === true
  const writable = info?.writable !== false && !disabled
  return (
    <div className="dshst-field" data-kind="secret">
      <div className="dshst-field-head">
        <label className="dshst-field-label" htmlFor={`${id}-secret`}>{text(secret.label)}</label>
        <Tag tone={configured ? 'success' : 'outline'}>{configured ? t('secretConfigured') : t('secretUnset')}</Tag>
      </div>
      <Input
        id={`${id}-secret`}
        className="dshst-input"
        type="password"
        autoComplete="new-password"
        value={draft}
        disabled={!writable || busy}
        onChange={event => { onDraft(secret.ref, event.target.value) }}
      />
      <p className="dshst-field-hint">
        {configured ? t('secretConfiguredHint') : t('secretUnsetHint')}
        {info?.source === undefined ? '' : ` · ${t('secretSource', { source: info.source })}`}
        {' · '}
        {t('secretTestHint')}
      </p>
      {secret.description === undefined ? null : <p className="dshst-field-hint">{text(secret.description)}</p>}
      <div className="dshst-actions">
        <Button size="sm" variant="outline" disabled={!writable || busy || draft.length === 0} onClick={() => { onSave(secret.ref) }}>{t('saveSecret')}</Button>
        <Button size="sm" variant="ghost" disabled={!writable || busy || !configured} onClick={() => { onClear(secret.ref) }}>{t('clearSecret')}</Button>
      </div>
    </div>
  )
}

function secretConfiguredFor(
  field: AdapterField,
  _config: JsonObject,
  info: Record<string, CredentialInfo>,
): boolean | undefined {
  if (field.kind !== 'password' || field.secretRef === undefined) return undefined
  return info[field.secretRef]?.configured === true
}

function secretWritableFor(
  field: AdapterField,
  _config: JsonObject,
  info: Record<string, CredentialInfo>,
): boolean | undefined {
  if (field.kind !== 'password' || field.secretRef === undefined) return undefined
  return info[field.secretRef]?.writable !== false
}
