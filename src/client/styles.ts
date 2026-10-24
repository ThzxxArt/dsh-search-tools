/** Component-scoped styles injected by the client half. */

export const STYLES = `
.dshst-page {
  --dshst-gap: 16px;
  --dshst-radius: var(--dsw-radius-xl);
  --dshst-radius-sm: var(--dsw-radius-lg);
  --dshst-stroke: var(--dsw-alias-settings-card-stroke);
  --dshst-card: var(--dsw-alias-settings-card-fill);
  --dshst-sunken: var(--dsw-alias-bg-layer-3);
  --dshst-muted: var(--dsw-alias-label-tertiary);
  --dshst-accent: var(--dsw-alias-state-business-primary);
  display: flex;
  flex-direction: column;
  gap: var(--dshst-gap);
  padding: 4px 2px 104px;
  color: var(--dsw-alias-label-primary);
  font-size: 13px;
  line-height: 20px;
  container-type: inline-size;
}
.dshst-page *, .dshst-page *::before, .dshst-page *::after { box-sizing: border-box; }
.dshst-page a { color: var(--dsw-alias-link); }
.dshst-sr-only {
  position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px;
  overflow: hidden; clip: rect(0, 0, 0, 0); white-space: nowrap; border: 0;
}

/* Hero ------------------------------------------------------------------ */
.dshst-hero {
  position: relative;
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  padding: 18px;
  overflow: hidden;
  border: 0.5px solid var(--dshst-stroke);
  border-radius: var(--dshst-radius);
  background:
    radial-gradient(120% 160% at 100% 0%, color-mix(in srgb, var(--dsw-alias-link) 12%, transparent), transparent 56%),
    var(--dshst-card);
}
.dshst-hero::after {
  content: "";
  position: absolute;
  inset: auto -30px -52px auto;
  width: 180px;
  height: 180px;
  border-radius: 999px;
  border: 28px solid color-mix(in srgb, var(--dsw-alias-link) 6%, transparent);
  pointer-events: none;
}
.dshst-hero-main { position: relative; z-index: 1; display: flex; align-items: flex-start; gap: 12px; min-width: 0; }
.dshst-hero-mark {
  display: inline-flex; flex: none; align-items: center; justify-content: center;
  width: 42px; height: 42px; border-radius: 14px;
  color: var(--dsw-alias-link);
  background: color-mix(in srgb, var(--dsw-alias-link) 13%, transparent);
  border: 0.5px solid color-mix(in srgb, var(--dsw-alias-link) 20%, transparent);
}
.dshst-hero-copy { min-width: 0; }
.dshst-title { margin: 0; font-size: 20px; line-height: 28px; font-weight: 650; letter-spacing: -0.01em; }
.dshst-sub { margin: 4px 0 0; max-width: 58ch; color: var(--dsw-alias-label-secondary); font-size: 13px; line-height: 20px; }
.dshst-hero-status { position: relative; z-index: 1; display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 6px; max-width: 100%; }
.dshst-status-chip {
  display: inline-flex; align-items: center; gap: 5px;
  min-height: 24px; padding: 2px 9px;
  border: 0.5px solid var(--dsw-alias-border-l2);
  border-radius: 999px;
  background: color-mix(in srgb, var(--dshst-card) 72%, transparent);
  color: var(--dsw-alias-label-secondary);
  font-size: 11px; line-height: 18px; white-space: nowrap;
}
.dshst-status-chip[data-tone="success"] { color: var(--dsw-alias-state-success-primary); border-color: color-mix(in srgb, var(--dsw-alias-state-success-primary) 24%, transparent); }
.dshst-status-chip[data-tone="warning"] { color: var(--dsw-alias-state-warn-primary); border-color: color-mix(in srgb, var(--dsw-alias-state-warn-primary) 26%, transparent); }
.dshst-status-chip[data-tone="error"] { color: var(--dsw-alias-state-error-primary); border-color: color-mix(in srgb, var(--dsw-alias-state-error-primary) 26%, transparent); }

/* Tabs ------------------------------------------------------------------ */
.dshst-tabs { width: 100%; }
.dshst-tabs [role="tab"] { min-width: 0; padding: 0 8px; font-size: 13px; white-space: nowrap; }
.dshst-tabs [role="tab"]:focus-visible { text-underline-offset: 3px; }
.dshst-subtabs {
  align-self: flex-start;
  width: min(100%, 320px);
  margin: 2px 0 4px;
}
.dshst-subtabs [role="tab"] { height: 30px; padding: 0 10px; font-size: 12px; }

/* Notices --------------------------------------------------------------- */
.dshst-notice-stack { display: flex; flex-direction: column; gap: 8px; }
.dshst-notice {
  display: flex; align-items: flex-start; gap: 9px;
  padding: 10px 12px;
  border: 0.5px solid var(--dsw-alias-border-l2);
  border-radius: var(--dshst-radius-sm);
  background: var(--dshst-sunken);
  color: var(--dsw-alias-label-secondary);
  font-size: 12px; line-height: 18px;
}
.dshst-notice[data-tone="error"] {
  color: var(--dsw-alias-label-primary);
  border-color: color-mix(in srgb, var(--dsw-alias-state-error-primary) 28%, transparent);
  background: color-mix(in srgb, var(--dsw-alias-state-error-primary) 8%, var(--dshst-sunken));
}
.dshst-notice[data-tone="warning"] {
  color: var(--dsw-alias-label-primary);
  border-color: color-mix(in srgb, var(--dsw-alias-state-warn-primary) 28%, transparent);
  background: color-mix(in srgb, var(--dsw-alias-state-warn-primary) 8%, var(--dshst-sunken));
}
.dshst-notice-icon { flex: none; display: inline-flex; margin-top: 1px; color: var(--dsw-alias-label-tertiary); }
.dshst-notice[data-tone="error"] .dshst-notice-icon { color: var(--dsw-alias-state-error-primary); }
.dshst-notice[data-tone="warning"] .dshst-notice-icon { color: var(--dsw-alias-state-warn-primary); }
.dshst-notice-copy { min-width: 0; }
.dshst-notice-copy p { margin: 0; }
.dshst-notice-list { margin: 4px 0 0; padding-left: 18px; }
.dshst-notice-list li { margin: 2px 0; overflow-wrap: anywhere; }

/* Layout ---------------------------------------------------------------- */
.dshst-stack { display: flex; flex-direction: column; gap: var(--dshst-gap); min-width: 0; }
.dshst-grid2 { display: grid; grid-template-columns: minmax(0, 1fr); gap: var(--dshst-gap); min-width: 0; }
@container (min-width: 520px) {
  .dshst-grid2 { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .dshst-span2 { grid-column: 1 / -1; }
}

/* Cards ----------------------------------------------------------------- */
.dshst-card {
  display: flex; flex-direction: column; gap: 12px;
  min-width: 0; padding: 16px;
  border: 0.5px solid var(--dshst-stroke);
  border-radius: var(--dshst-radius);
  background: var(--dshst-card);
}
.dshst-card-head { display: flex; align-items: flex-start; gap: 10px; min-width: 0; }
.dshst-card-icon {
  display: inline-flex; flex: none; align-items: center; justify-content: center;
  width: 30px; height: 30px; border-radius: 10px;
  color: var(--dsw-alias-label-secondary);
  background: var(--dsw-alias-bg-module-platform);
}
.dshst-card-copy { flex: 1; min-width: 0; }
.dshst-card-title { margin: 0; font-size: 14px; line-height: 20px; font-weight: 600; }
.dshst-card-desc { margin: 3px 0 0; color: var(--dsw-alias-label-tertiary); font-size: 12px; line-height: 18px; }
.dshst-card-aside { flex: none; display: flex; align-items: center; gap: 6px; }
.dshst-card-body { display: flex; flex-direction: column; gap: 12px; min-width: 0; }
.dshst-activation { width: min(100%, 720px); margin: 0 auto; text-align: start; }

/* Grouping -------------------------------------------------------------- */
.dshst-group-list { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
.dshst-group { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.dshst-group + .dshst-group { margin-top: 4px; padding-top: 14px; border-top: 0.5px solid var(--dsw-alias-border-l2); }
.dshst-group-head { display: flex; flex-direction: column; gap: 2px; padding-bottom: 4px; }
.dshst-group-title { margin: 0; font-size: 13px; line-height: 20px; font-weight: 600; color: var(--dsw-alias-label-primary); }
.dshst-group-desc { margin: 0; color: var(--dshst-muted); font-size: 12px; line-height: 18px; }
.dshst-group-body { display: grid; grid-template-columns: minmax(0, 1fr); align-items: start; min-width: 0; }
@container (min-width: 520px) {
  .dshst-group-body { grid-template-columns: repeat(2, minmax(0, 1fr)); column-gap: 18px; }
  .dshst-group-body > .dshst-field[data-kind="instances"],
  .dshst-group-body > .dshst-field[data-kind="tags"],
  .dshst-group-body > .dshst-field[data-kind="checkboxes"],
  .dshst-group-body > .dshst-field[data-kind="secret"] { grid-column: 1 / -1; }
}

/* Fields ---------------------------------------------------------------- */
.dshst-field { display: flex; flex-direction: column; gap: 6px; min-width: 0; padding: 8px 0; }
.dshst-field-copy { min-width: 0; }
.dshst-field-head { display: flex; align-items: center; gap: 8px; min-width: 0; }
.dshst-field-label { color: var(--dsw-alias-label-primary); font-size: 13px; line-height: 20px; font-weight: 500; }
.dshst-field-hint { margin: 0; color: var(--dshst-muted); font-size: 12px; line-height: 18px; }
.dshst-field-error { margin: 0; color: var(--dsw-alias-state-error-primary); font-size: 12px; line-height: 18px; }
.dshst-field[data-kind="switch"] { flex-direction: row; align-items: center; justify-content: space-between; gap: 14px; }
.dshst-field[data-kind="switch"] .dshst-field-copy { min-width: 0; }
.dshst-switch-line { display: flex; flex: none; align-items: center; gap: 8px; }
.dshst-switch-state { color: var(--dshst-muted); font-size: 11px; line-height: 18px; min-width: 18px; text-align: end; }
.dshst-input { display: flex; width: 100%; }
.dshst-input input { width: 100%; }
.dshst-field[data-invalid="true"] .dshst-input { border-color: var(--dsw-alias-state-error-primary); }
.dshst-select {
  width: 100%; height: 32px; padding: 0 10px;
  border: 0.5px solid var(--dsw-alias-border-l4);
  border-radius: var(--dsw-radius-md);
  background: var(--dsw-alias-bg-layer-1);
  color: var(--dsw-alias-label-primary);
  font: inherit; font-size: 13px; line-height: 20px;
  color-scheme: light dark;
}
.dshst-select:focus-visible { outline: none; border-color: var(--dsw-alias-state-business-primary); }
.dshst-select:disabled { color: var(--dsw-alias-label-tertiary); cursor: default; }
.dshst-field[data-invalid="true"] .dshst-select { border-color: var(--dsw-alias-state-error-primary); }
.dshst-checkbox-fieldset { min-width: 0; margin: 0; padding: 0; border: 0; }
.dshst-checkbox-fieldset legend { padding: 0; }
.dshst-checkbox-list { display: flex; flex-wrap: wrap; gap: 6px 14px; padding-top: 3px; }
.dshst-checkbox-list label {
  display: inline-flex; align-items: center; gap: 6px;
  min-height: 28px; color: var(--dsw-alias-label-secondary); font-size: 12px;
}
.dshst-checkbox-list input { width: 15px; height: 15px; margin: 0; accent-color: var(--dsw-alias-state-business-primary); }
.dshst-checkbox-list input:focus-visible { outline: var(--dsw-focus-ring-width) solid var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary)); outline-offset: 2px; }
.dshst-field[data-invalid="true"] .dshst-checkbox-fieldset { color: var(--dsw-alias-state-error-primary); }
.dshst-unit-wrap { display: flex; align-items: center; gap: 8px; }
.dshst-unit-wrap .dshst-input { flex: 1; }
.dshst-unit { flex: none; color: var(--dshst-muted); font-size: 12px; }

/* Tags ------------------------------------------------------------------ */
.dshst-tags { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }
.dshst-tag-chip { display: inline-flex; align-items: center; gap: 2px; }
.dshst-tag-remove {
  display: inline-flex; align-items: center; justify-content: center;
  width: 22px; height: 22px; padding: 0;
  border: 0; border-radius: 999px;
  background: transparent; color: var(--dsw-alias-label-tertiary);
  cursor: pointer;
}
.dshst-tag-remove:hover { background: var(--dsw-alias-interactive-bg-hover); color: var(--dsw-alias-label-primary); }
.dshst-tag-remove:focus-visible { outline: var(--dsw-focus-ring-width) solid var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary)); outline-offset: 1px; }
.dshst-tag-add { display: flex; align-items: center; gap: 8px; }
.dshst-tag-add .dshst-input { flex: 1; }

/* Provider picker ------------------------------------------------------- */
.dshst-backend-summary {
  display: flex; align-items: center; justify-content: space-between; gap: 10px;
  padding: 8px 10px; border: 0.5px solid var(--dsw-alias-border-l2);
  border-radius: var(--dshst-radius-sm); background: var(--dshst-sunken);
}
.dshst-backend-current { display: flex; align-items: baseline; gap: 8px; min-width: 0; flex-wrap: wrap; }
.dshst-backend-current strong { font-size: 13px; font-weight: 600; overflow-wrap: anywhere; }
.dshst-picker { display: flex; flex-direction: column; gap: 10px; min-width: 0; }
.dshst-picker-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 10px; flex-wrap: wrap; }
.dshst-picker-label { font-size: 13px; line-height: 20px; font-weight: 500; }
.dshst-picker-grid { display: grid; grid-template-columns: minmax(0, 1fr); gap: 8px; }
@container (min-width: 520px) { .dshst-picker-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
.dshst-adapter-card {
  display: grid; grid-template-columns: auto minmax(0, 1fr); gap: 9px; align-items: start;
  min-width: 0; padding: 12px; cursor: pointer;
  border: 0.5px solid var(--dsw-alias-border-l2);
  border-radius: var(--dshst-radius-sm);
  background: var(--dshst-sunken);
  transition: border-color 160ms ease, background-color 160ms ease;
}
.dshst-adapter-card:hover { border-color: var(--dsw-alias-border-l4); }
.dshst-adapter-card[data-selected="true"] {
  border-color: color-mix(in srgb, var(--dshst-accent) 58%, var(--dsw-alias-border-l2));
  background: color-mix(in srgb, var(--dshst-accent) 6%, var(--dshst-sunken));
  box-shadow: inset 0 0 0 0.5px color-mix(in srgb, var(--dshst-accent) 42%, transparent);
}
.dshst-adapter-card:focus-within {
  outline: var(--dsw-focus-ring-width) solid var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary));
  outline-offset: 2px;
}
.dshst-adapter-card input { flex: none; margin: 3px 0 0; accent-color: var(--dsw-alias-brand-primary); }
.dshst-adapter-body { display: flex; flex-direction: column; min-width: 0; }
.dshst-adapter-head { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
.dshst-adapter-name { font-size: 13px; line-height: 20px; font-weight: 600; overflow-wrap: anywhere; }
.dshst-adapter-desc { color: var(--dsw-alias-label-secondary); font-size: 12px; line-height: 18px; margin-top: 2px; overflow-wrap: anywhere; }
.dshst-adapter-tags { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 7px; }
.dshst-capability { color: var(--dshst-muted); font-size: 10px; line-height: 16px; letter-spacing: 0.01em; }
.dshst-capability + .dshst-capability::before { content: "·"; margin-right: 4px; color: var(--dsw-alias-label-dimmed); }

/* Instances ------------------------------------------------------------- */
.dshst-instances { display: flex; flex-direction: column; gap: 8px; min-width: 0; }
.dshst-instance-card {
  display: flex; flex-direction: column; gap: 10px;
  min-width: 0; padding: 12px;
  border: 0.5px solid var(--dsw-alias-border-l2);
  border-radius: var(--dshst-radius-sm);
  background: var(--dshst-sunken);
}
.dshst-instance-card[data-invalid="true"] { border-color: color-mix(in srgb, var(--dsw-alias-state-error-primary) 40%, transparent); }
.dshst-instance-head { display: flex; align-items: center; gap: 8px; min-width: 0; }
.dshst-instance-number {
  display: inline-flex; flex: none; align-items: center; justify-content: center;
  width: 24px; height: 24px; border-radius: 8px;
  background: var(--dsw-alias-bg-module-platform);
  color: var(--dshst-muted); font-size: 10px; font-weight: 600; font-variant-numeric: tabular-nums;
}
.dshst-instance-name { flex: 1; min-width: 0; font-size: 13px; font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dshst-instance-fields { display: grid; grid-template-columns: minmax(0, 1fr); gap: 8px; }
@container (min-width: 520px) { .dshst-instance-fields { grid-template-columns: minmax(0, 1.7fr) minmax(0, 1fr); } }
.dshst-instance-field { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
.dshst-instance-field-label { color: var(--dshst-muted); font-size: 11px; line-height: 16px; }
.dshst-instance-foot { display: flex; align-items: center; justify-content: space-between; gap: 8px; flex-wrap: wrap; }
.dshst-instance-actions { display: flex; align-items: center; gap: 4px; flex-wrap: wrap; }
.dshst-instance-state { display: inline-flex; align-items: center; gap: 6px; color: var(--dshst-muted); font-size: 11px; }
.dshst-instance-state-dot { width: 6px; height: 6px; border-radius: 999px; background: var(--dsw-alias-state-idle-primary); }
.dshst-instance-card[data-enabled="true"] .dshst-instance-state-dot { background: var(--dsw-alias-state-success-primary); }
.dshst-icon-danger { color: var(--dsw-alias-state-error-primary); }
.dshst-add-instance {
  display: flex; align-items: center; justify-content: center; gap: 6px;
  width: 100%; min-height: 36px; padding: 8px 12px;
  border: 1px dashed var(--dsw-alias-border-l4);
  border-radius: var(--dshst-radius-sm);
  background: transparent; color: var(--dsw-alias-label-secondary);
  font: inherit; font-size: 12px; cursor: pointer;
}
.dshst-add-instance:hover { background: var(--dsw-alias-interactive-bg-hover); color: var(--dsw-alias-label-primary); }
.dshst-add-instance:focus-visible { outline: var(--dsw-focus-ring-width) solid var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary)); outline-offset: 2px; }
.dshst-add-instance:disabled { opacity: 0.4; cursor: not-allowed; }

/* Disclosure ------------------------------------------------------------ */
.dshst-disclosure {
  border: 0.5px solid var(--dsw-alias-border-l2);
  border-radius: var(--dshst-radius-sm);
  background: var(--dshst-sunken);
  overflow: clip;
}
.dshst-disclosure > summary {
  display: flex; align-items: center; gap: 8px;
  min-height: 44px; padding: 10px 12px;
  cursor: pointer; list-style: none;
  color: var(--dsw-alias-label-primary);
}
.dshst-disclosure > summary::-webkit-details-marker { display: none; }
.dshst-disclosure > summary:focus-visible { outline: var(--dsw-focus-ring-width) solid var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary)); outline-offset: -2px; }
.dshst-disclosure-title { font-size: 13px; font-weight: 600; }
.dshst-disclosure-desc { color: var(--dshst-muted); font-size: 12px; }
.dshst-disclosure-count { margin-left: auto; color: var(--dshst-muted); font-size: 11px; white-space: nowrap; }
.dshst-disclosure-chevron { display: inline-flex; color: var(--dshst-muted); transition: transform 160ms ease; }
.dshst-disclosure[open] .dshst-disclosure-chevron { transform: rotate(180deg); }
.dshst-disclosure-body { display: grid; grid-template-columns: minmax(0, 1fr); align-items: start; padding: 0 12px 10px; border-top: 0.5px solid var(--dsw-alias-border-l2); }
@container (min-width: 520px) {
  .dshst-disclosure-body { grid-template-columns: repeat(2, minmax(0, 1fr)); column-gap: 18px; }
  .dshst-disclosure-body > .dshst-field[data-kind="instances"],
  .dshst-disclosure-body > .dshst-field[data-kind="tags"],
  .dshst-disclosure-body > .dshst-field[data-kind="checkboxes"],
  .dshst-disclosure-body > .dshst-field[data-kind="secret"] { grid-column: 1 / -1; }
}
.dshst-details { border-top: 0.5px solid var(--dsw-alias-border-l2); padding-top: 8px; margin-top: 8px; }
.dshst-details summary { cursor: pointer; color: var(--dsw-alias-label-secondary); font-size: 12px; }

/* Empty state ----------------------------------------------------------- */
.dshst-empty {
  display: flex; align-items: flex-start; gap: 12px;
  padding: 16px;
  border: 1px dashed var(--dsw-alias-border-l4);
  border-radius: var(--dshst-radius);
  background: color-mix(in srgb, var(--dshst-card) 65%, transparent);
}
.dshst-empty-icon { display: inline-flex; flex: none; color: var(--dsw-alias-link); }
.dshst-empty-copy { min-width: 0; flex: 1; }
.dshst-empty-title { margin: 0; font-size: 14px; font-weight: 600; }
.dshst-empty-desc { margin: 3px 0 10px; color: var(--dsw-alias-label-secondary); font-size: 12px; line-height: 18px; }

/* Stats ----------------------------------------------------------------- */
.dshst-stat-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(110px, 1fr)); gap: 8px; }
.dshst-stat {
  display: flex; flex-direction: column; gap: 2px;
  min-width: 0; padding: 11px 12px;
  border: 0.5px solid var(--dsw-alias-border-l2);
  border-radius: var(--dshst-radius-sm);
  background: var(--dshst-sunken);
}
.dshst-stat-label { color: var(--dshst-muted); font-size: 11px; line-height: 16px; }
.dshst-stat-value { font-size: 18px; line-height: 24px; font-weight: 600; font-variant-numeric: tabular-nums; overflow-wrap: anywhere; }
.dshst-stat-meta { color: var(--dshst-muted); font-size: 11px; line-height: 16px; }

/* Takeover power cards -------------------------------------------------- */
.dshst-power { gap: 12px; }
.dshst-power[data-active="true"] {
  border-color: color-mix(in srgb, var(--dsw-alias-link) 34%, var(--dshst-stroke));
  background:
    linear-gradient(135deg, color-mix(in srgb, var(--dsw-alias-link) 6%, transparent), transparent 60%),
    var(--dshst-card);
}
.dshst-power-head { display: flex; align-items: flex-start; gap: 10px; }
.dshst-power-mark {
  display: inline-flex; flex: none; align-items: center; justify-content: center;
  width: 30px; height: 30px; border-radius: 10px;
  color: var(--dsw-alias-label-secondary);
  background: var(--dsw-alias-bg-module-platform);
}
.dshst-power[data-active="true"] .dshst-power-mark { color: var(--dsw-alias-link); background: color-mix(in srgb, var(--dsw-alias-link) 12%, transparent); }
.dshst-power-copy { flex: 1; min-width: 0; }
.dshst-power-meta { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
.dshst-power-label { color: var(--dshst-muted); font-size: 11px; }
.dshst-code, .dshst-code-inline {
  font-family: var(--ds-font-family-code);
  font-size: 11px; line-height: 18px;
  color: var(--dsw-alias-label-secondary);
  background: var(--dsw-alias-bg-module-platform);
  border: 0.5px solid var(--dsw-alias-border-l2);
  border-radius: var(--dsw-radius-sm);
  padding: 1px 6px;
  overflow-wrap: anywhere;
}
.dshst-code-inline { white-space: nowrap; }
.dshst-power-actions { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }

/* Console / tests ------------------------------------------------------- */
.dshst-console { display: flex; flex-direction: column; gap: 10px; min-width: 0; }
.dshst-probe-bar { display: flex; align-items: center; gap: 9px; flex-wrap: wrap; padding-bottom: 2px; }
.dshst-probe-result {
  display: flex; flex-direction: column; gap: 7px;
  padding: 9px 10px;
  border: 0.5px solid var(--dsw-alias-border-l2);
  border-radius: var(--dshst-radius-sm);
  background: var(--dshst-sunken);
}
.dshst-probe-result[data-ok="false"] { border-color: color-mix(in srgb, var(--dsw-alias-state-error-primary) 28%, transparent); }
.dshst-probe-head { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.dshst-probe-engines { display: flex; flex-wrap: wrap; gap: 5px; }
.dshst-console-row { display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: center; gap: 8px; }
.dshst-console-row .dshst-input { min-width: 0; }
.dshst-console-btn { height: 32px; padding: 0 12px; border-radius: var(--dsw-radius-md); }
.dshst-test-result { display: flex; flex-direction: column; gap: 8px; padding-top: 10px; border-top: 0.5px solid var(--dsw-alias-border-l2); min-width: 0; }
.dshst-test-head { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
.dshst-test-title { margin: 0; font-size: 12px; font-weight: 600; }
.dshst-source-list { display: flex; flex-direction: column; gap: 0; list-style: none; margin: 0; padding: 0; }
.dshst-source { padding: 9px 0; border-top: 0.5px solid var(--dsw-alias-border-l2); }
.dshst-source:first-child { border-top: 0; padding-top: 2px; }
.dshst-source-title { display: inline-block; color: var(--dsw-alias-link); font-size: 13px; line-height: 20px; font-weight: 500; overflow-wrap: anywhere; }
.dshst-source-url { color: var(--dshst-muted); font-size: 11px; line-height: 16px; overflow-wrap: anywhere; }
.dshst-source-snippet { margin: 2px 0 0; color: var(--dsw-alias-label-secondary); font-size: 12px; line-height: 18px; }
.dshst-pre {
  margin: 0; max-height: 280px; overflow: auto;
  white-space: pre-wrap; word-break: break-word;
  font-family: var(--ds-font-family-code);
  font-size: 12px; line-height: 18px;
  color: var(--dsw-alias-label-primary);
  background: var(--dsw-alias-bg-layer-1);
  border: 0.5px solid var(--dsw-alias-border-l2);
  border-radius: var(--dshst-radius-sm);
  padding: 12px;
}
.dshst-code-frame { display: flex; flex-direction: column; gap: 8px; min-width: 0; }
.dshst-reader {
  display: flex; flex-direction: column; gap: 8px; min-width: 0;
  padding: 10px; border: 0.5px solid var(--dsw-alias-border-l2);
  border-radius: var(--dshst-radius-sm); background: var(--dshst-sunken);
}
.dshst-reader-bar { display: flex; align-items: center; justify-content: space-between; gap: 8px; flex-wrap: wrap; }
.dshst-fetch-code { max-height: 280px; }
.dshst-fetch-code > div { max-height: 280px; }
.dshst-codeblock { min-width: 0; max-height: 360px; overflow: auto; border-radius: var(--dshst-radius-sm); }
.dshst-codeblock > div { max-height: 360px; }
.dshst-codeblock pre {
  white-space: pre-wrap !important;
  word-break: normal !important;
  overflow-wrap: anywhere;
}
.dshst-code-head { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.dshst-code-head .dshst-card-title { flex: 1; }
.dshst-copy-btn { height: 26px; padding: 0 9px; font-size: 11px; border-radius: var(--dsw-radius-sm); }
.dshst-prompt-code { max-height: 360px; }
.dshst-prompt-code > div { max-height: 360px; }

/* Research budget ------------------------------------------------------- */
.dshst-budget { display: flex; flex-direction: column; gap: 12px; min-width: 0; }
.dshst-budget-row { display: flex; flex-direction: column; gap: 5px; min-width: 0; }
.dshst-budget-head { display: flex; align-items: baseline; justify-content: space-between; gap: 8px; flex-wrap: wrap; }
.dshst-budget-label { color: var(--dsw-alias-label-secondary); font-size: 12px; }
.dshst-budget-value { color: var(--dsw-alias-label-primary); font-size: 12px; font-weight: 500; font-variant-numeric: tabular-nums; }
.dshst-meter { height: 6px; border-radius: 999px; background: var(--dsw-alias-bg-module-platform); overflow: hidden; }
.dshst-meter-fill { height: 100%; border-radius: inherit; background: var(--dsw-alias-state-business-primary); }
.dshst-meter-fill[data-tone="warning"] { background: var(--dsw-alias-state-warn-primary); }
.dshst-meter-fill[data-tone="error"] { background: var(--dsw-alias-state-error-primary); }

/* Diagnostics ----------------------------------------------------------- */
.dshst-diag { display: flex; flex-direction: column; gap: 12px; min-width: 0; }
.dshst-path-row { display: flex; align-items: center; gap: 8px; min-width: 0; }
.dshst-path-row .dshst-path { flex: 1; min-width: 0; }
.dshst-error-list { display: flex; flex-direction: column; gap: 0; list-style: none; margin: 0; padding: 0; }
.dshst-error-item { display: flex; align-items: flex-start; gap: 8px; padding: 8px 0; border-top: 0.5px solid var(--dsw-alias-border-l2); font-size: 12px; line-height: 18px; }
.dshst-error-item:first-child { border-top: 0; padding-top: 0; }
.dshst-error-dot { flex: none; width: 6px; height: 6px; margin-top: 6px; border-radius: 999px; background: var(--dsw-alias-state-error-primary); }
.dshst-error-meta { color: var(--dshst-muted); font-size: 11px; }
.dshst-error-message { color: var(--dsw-alias-label-secondary); overflow-wrap: anywhere; }

/* Auxiliary plugin surfaces --------------------------------------------- */
.dshst-actions { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
.dshst-hint { margin: 2px 0 0; color: var(--dshst-muted); font-size: 12px; line-height: 18px; }
.dshst-error { color: var(--dsw-alias-state-error-primary); font-size: 12px; line-height: 18px; }
.dshst-research-head { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; font-size: 12px; color: var(--dsw-alias-label-secondary); }
.dshst-research-list { margin: 6px 0 0; padding-left: 18px; font-size: 12px; line-height: 18px; }
.dshst-research-list li { margin: 2px 0; overflow-wrap: anywhere; }

/* Action bar ------------------------------------------------------------ */
.dshst-actionbar {
  position: sticky; bottom: 0; z-index: 4;
  display: flex; align-items: center; justify-content: space-between; gap: 10px; flex-wrap: wrap;
  margin-top: 2px; padding: 10px 0 8px;
  border-top: 0.5px solid var(--dsw-alias-border-l2);
  background: var(--dsw-alias-bg-layer-2);
}
.dshst-actionbar-status { display: flex; align-items: center; gap: 6px; min-width: 0; color: var(--dshst-muted); font-size: 12px; line-height: 18px; }
.dshst-actionbar-status[data-dirty="true"] { color: var(--dsw-alias-label-secondary); }
.dshst-actionbar-actions { display: flex; align-items: center; gap: 6px; }
.dshst-dirty-dot { width: 6px; height: 6px; border-radius: 999px; background: var(--dsw-alias-state-warn-primary); }

@container (max-width: 620px) {
  .dshst-hero { flex-direction: column; }
  .dshst-hero-status { justify-content: flex-start; }
}

@container (max-width: 440px) {
  .dshst-hero { flex-direction: column; padding: 16px; }
  .dshst-hero-status { justify-content: flex-start; }
  .dshst-card { padding: 14px; }
  .dshst-card-head { gap: 8px; }
  .dshst-tabs [role="tab"] { padding: 0 4px; font-size: 12px; }
  .dshst-actionbar { align-items: flex-start; }
  .dshst-actionbar-actions { width: 100%; justify-content: flex-end; }
}

@media (prefers-reduced-motion: reduce) {
  .dshst-adapter-card, .dshst-disclosure-chevron { transition: none; }
}
`
