/** Component-scoped styles injected by the client half. */

export const STYLES = `
.dshst-page { display: flex; flex-direction: column; gap: 16px; padding: 4px 2px 24px; color: var(--dsw-text-primary); }
.dshst-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; }
.dshst-title { margin: 0; font-size: 18px; font-weight: 600; }
.dshst-sub { margin: 4px 0 0; color: var(--dsw-text-secondary); font-size: 13px; }
.dshst-status { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; color: var(--dsw-text-secondary); font-size: 12px; }
.dshst-tabs { display: flex; flex-wrap: wrap; gap: 4px; border-bottom: 1px solid var(--dsw-border-subtle); overflow-x: auto; }
.dshst-tab { border: 0; background: transparent; color: var(--dsw-text-secondary); padding: 8px 12px; border-bottom: 2px solid transparent; cursor: pointer; font: inherit; white-space: nowrap; }
.dshst-tab[data-active="true"] { color: var(--dsw-text-primary); border-bottom-color: var(--dsw-accent); }
.dshst-card { border: 1px solid var(--dsw-border-subtle, rgba(127, 127, 127, 0.28)); border-radius: 10px; padding: 14px; display: flex; flex-direction: column; gap: 12px; background: var(--dsw-surface, rgba(127, 127, 127, 0.06)); min-width: 0; }
.dshst-activation { width: min(100%, 720px); margin: 0 auto; text-align: start; }
.dshst-row { display: grid; grid-template-columns: minmax(150px, 220px) minmax(0, 1fr); gap: 12px; align-items: start; }
.dshst-row > label { font-size: 13px; color: var(--dsw-text-secondary); padding-top: 8px; }
.dshst-row > div { min-width: 0; }
.dshst-card code { overflow-wrap: anywhere; }
.dshst-hint { color: var(--dsw-text-tertiary); font-size: 12px; margin: 2px 0 0; }
.dshst-instance { display: grid; grid-template-columns: minmax(0, 1fr); gap: 8px; align-items: start; padding: 8px 0; border-top: 1px solid var(--dsw-border-subtle); }
.dshst-instance:first-of-type { border-top: 0; }
.dshst-instance-main { display: grid; grid-template-columns: minmax(0, 1fr); gap: 8px; }
.dshst-actions { display: flex; gap: 6px; flex-wrap: wrap; align-items: center; }
.dshst-tags { display: flex; gap: 6px; flex-wrap: wrap; align-items: center; }
.dshst-error { color: var(--dsw-danger); font-size: 12px; margin: 2px 0 0; }
.dshst-notice { border: 1px solid var(--dsw-border-subtle); border-radius: 8px; padding: 10px 12px; font-size: 12px; color: var(--dsw-text-secondary); }
.dshst-save { display: flex; justify-content: space-between; align-items: center; gap: 12px; padding: 12px 0 4px; border-top: 1px solid var(--dsw-border-subtle); }
.dshst-pre { margin: 0; max-height: 280px; overflow: auto; white-space: pre-wrap; word-break: break-word; font-family: var(--dsw-font-mono); font-size: 12px; background: var(--dsw-surface-sunken); border-radius: 8px; padding: 10px; }
.dshst-preview-results { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 10px; }
.dshst-preview-results li { border-top: 1px solid var(--dsw-border-subtle); padding-top: 10px; }
.dshst-preview-results li:first-child { border-top: 0; padding-top: 0; }
.dshst-preview-results a { color: var(--dsw-accent); font-size: 13px; overflow-wrap: anywhere; }
.dshst-card-title { font-weight: 600; font-size: 14px; }
.dshst-card-desc { color: var(--dsw-text-secondary, rgba(127, 127, 127, 0.95)); font-size: 12px; margin: 2px 0 0; }
.dshst-picker { display: flex; flex-direction: column; gap: 8px; }
.dshst-picker-head { display: flex; justify-content: space-between; align-items: flex-start; gap: 10px; }
.dshst-picker-label { font-size: 13px; color: var(--dsw-text-secondary); }
.dshst-picker-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 8px; }
.dshst-adapter-card { display: grid; grid-template-columns: auto minmax(0, 1fr); gap: 8px; align-items: start; border: 1px solid var(--dsw-border-subtle, rgba(127, 127, 127, 0.28)); border-radius: 10px; padding: 10px; background: var(--dsw-surface, rgba(127, 127, 127, 0.04)); cursor: pointer; min-width: 0; }
.dshst-adapter-card:hover { border-color: var(--dsw-border-strong, var(--dsw-accent)); }
.dshst-adapter-card[data-selected="true"] { border-color: var(--dsw-accent); box-shadow: inset 0 0 0 1px var(--dsw-accent); }
.dshst-adapter-card:focus-within { outline: 2px solid var(--dsw-accent); outline-offset: 2px; }
.dshst-adapter-card input { margin: 3px 0 0; accent-color: var(--dsw-accent); }
.dshst-adapter-body, .dshst-adapter-head { display: flex; flex-direction: column; min-width: 0; }
.dshst-adapter-head { flex-direction: row; align-items: center; gap: 6px; flex-wrap: wrap; }
.dshst-adapter-name { font-size: 13px; font-weight: 600; overflow-wrap: anywhere; }
.dshst-adapter-desc { display: block; color: var(--dsw-text-secondary); font-size: 12px; margin-top: 3px; overflow-wrap: anywhere; }
.dshst-adapter-body .dshst-tags { margin-top: 6px; }
.dshst-prompt { max-height: 360px; }
.dshst-badge { display: inline-flex; align-items: center; gap: 6px; }
.dshst-grid2 { display: grid; grid-template-columns: repeat(auto-fit, minmax(360px, 1fr)); gap: 12px; }
.dshst-card-item { border: 1px solid var(--dsw-border-subtle); border-radius: 10px; padding: 12px; display: flex; flex-direction: column; gap: 8px; }
.dshst-card-item h4 { margin: 0; font-size: 13px; }
.dshst-card-item p { margin: 0; font-size: 12px; color: var(--dsw-text-secondary); }
.dshst-details { border-top: 1px solid var(--dsw-border-subtle); padding-top: 8px; margin-top: 8px; }
.dshst-details summary { cursor: pointer; color: var(--dsw-text-secondary); font-size: 12px; }
.dshst-research-head { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; font-size: 12px; color: var(--dsw-text-secondary); }
.dshst-research-list { margin: 6px 0 0; padding-left: 18px; font-size: 12px; }
.dshst-research-list li { margin: 2px 0; overflow-wrap: anywhere; }
@media (max-width: 720px) {
  .dshst-row { grid-template-columns: 1fr; }
  .dshst-row > label { padding-top: 0; }
  .dshst-instance { grid-template-columns: 1fr; }
  .dshst-instance-main { grid-template-columns: 1fr; }
  .dshst-grid2 { grid-template-columns: 1fr; }
}
`
