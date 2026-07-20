# 趣味部屋図書館 UI design system

## Direction

- Genre: atmospheric
- Application structure: Workbench
- Visual idea: 深夜の個人図書館。暗い紙面に、現在のテーマ色と琥珀の灯りを少量だけ置く。
- Preserve: 検索、本棚、結果、詳細モーダル、設定の情報設計と操作ロジック。

## Typography

- Display: `"Yu Mincho", "Hiragino Mincho ProN", "BIZ UDPMincho", "Noto Serif JP", serif`
- Body and controls: `system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", "Noto Sans JP", "Yu Gothic", "Hiragino Sans", sans-serif`
- Display type is limited to brand names, section headings, book titles, and shelf names. Inputs, buttons, labels, metadata, and numbers stay in the body face.
- Fonts are device-local only. No external font request is allowed in this iteration.
- Counts, prices, dates, and shelf statistics use tabular numerals.

## Color and surfaces

- Keep the four existing themes: 深碧、紅緋、紫紺、琥珀。
- One theme accent is active at a time. Warm amber is the secondary lantern color.
- Use semantic tokens from `tokens.css`; avoid new one-off color, shadow, spacing, or typography values.
- A surface is earned by function: the search workbench, a shelf group, a modal, or a persistent navigation rail.
- Do not use colored side stripes as decoration.
- Do not nest cards to express simple hierarchy. Use spacing, rules, type, and background changes instead.

## Layout

- Desktop landing state may use the two-column logo/workbench composition.
- Mobile landing state is top-biased and content-height. It must not vertically center the entire search experience in the viewport.
- Form labels, search state, details, and shelf metadata are left aligned.
- Button text may remain centered within the button.
- Shelf hierarchy is: group surface → level separated by a rule → books on a flat strip.

## Interaction

- Preserve existing focus, loading, empty, error, offline, modal, and reduced-motion states.
- Motion remains quiet: page reveal, modal transition, and direct hover/focus response only.
- Never rely on color alone for state.

## Responsive contract

- Verify at 320, 375, 414, and 768 CSS pixels, plus desktop.
- No horizontal page scrolling. Horizontal shelf and jump rails may scroll within their own bounded region.
- Primary labels and controls remain readable without truncating essential action text.

