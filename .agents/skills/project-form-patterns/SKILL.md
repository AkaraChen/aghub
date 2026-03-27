---
name: project-form-patterns
description: Form implementation guidance for the aghub desktop app. Use when building or refactoring forms in `crates/desktop/src`, especially HeroUI v3 + React forms, RHF integration, validation, custom editors, and error presentation. Triggers: MCP forms, settings dialogs, create/edit panels, `TextField`, `FieldError`, `Select`, `react-hook-form`, key-value editors, validation behavior.
---

# AGHub Form Patterns

Follow these rules when building forms in this project.

## Source of Truth

- Check the official docs first, not memory and not bundled/local docs, when form behavior is in question.
- For HeroUI, prefer the official site:
  - `https://v3.heroui.com/docs/react/components/form`
  - `https://v3.heroui.com/docs/react/components/text-field`
  - `https://v3.heroui.com/docs/react/components/field-error`
  - `https://v3.heroui.com/docs/react/components/select`
- Use local skill docs only as a convenience after confirming the official API.

## Default Stack

- Prefer `react-hook-form` for non-trivial forms.
- Use `Controller` for HeroUI `Select` and any custom controlled widgets.
- Keep one form state. Do not create a second derived validation state unless there is a concrete need the form library cannot express.

## Validation Behavior

- When RHF controls validation, set HeroUI form fields to `validationBehavior="aria"`.
- Do not rely on HeroUI/native validation defaults together with RHF. Native validation can steal focus and submission flow while bypassing the error UI you expect from RHF.
- Let RHF own validation rules and submission blocking.

## Error Rendering

- For HeroUI text fields, use:
  - `isInvalid={Boolean(fieldState.error)}`
  - Conditionally render `<FieldError>{fieldState.error.message}</FieldError>` inside the same `TextField`.
- Do not invent unsupported props. In particular, do not assume `TextField` supports an `errorMessage` prop.
- Keep the official anatomy:

```tsx
<TextField isInvalid={Boolean(fieldState.error)} validationBehavior="aria">
	<Label>Name</Label>
	<Input {...inputProps} />
	{fieldState.error && (
		<FieldError>{fieldState.error.message}</FieldError>
	)}
</TextField>
```

- For non-form or custom composite controls, prefer HeroUI `ErrorMessage` instead of hand-rolled error text.
- Use `ErrorMessage` for collection-style or custom editors that are not true form fields, including key/value editors, tag selectors, and similar composite controls.

## Custom Editors

- Custom widgets like `AgentSelector`, `EnvEditor`, `HttpHeaderEditor`, and `KeyPairEditor` should still be registered in RHF through `Controller`.
- For custom editors that manage arrays or compound values, compute validation from the current field value and surface one aggregated error below the editor when possible.
- For that aggregated error, prefer HeroUI `ErrorMessage`.
- Do not inject per-row error UI into tight horizontal layouts unless the design explicitly calls for it.

## Key/Value Editors

- Keep row layout simple:
  - two inputs
  - one delete button
  - no extra wrappers that change flex behavior unless necessary
- Prefer aggregate error text below the whole editor over inline row errors. This avoids breaking spacing and alignment.
- Implement that aggregate error with HeroUI `ErrorMessage`, not a custom `<p>` block.
- If you must show row-level issues, redesign the layout first; do not bolt error blocks into a row that was designed as a single-line control.

## Practical Rules

- Prefer `onPress` for HeroUI buttons.
- Use `type="button"` for non-submit buttons inside forms.
- Preserve existing visual patterns in this repo; do not restyle forms while adding validation.
- After form changes, run `bun run build` in `crates/desktop` when possible and separate unrelated existing build failures from the changes you made.

## Anti-Patterns

- Do not mix RHF validation with a parallel `validationErrors` state for the same fields.
- Do not depend on HeroUI default native validation when you expect RHF errors to drive the UI.
- Do not push validation messages into each key/value row unless you intentionally redesign that editor.
- Do not trust remembered HeroUI APIs for forms without checking the official site first.
