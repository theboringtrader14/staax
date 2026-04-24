# LIFEX OS Typography Specification

## Font Families (3 only)
| Variable | Family | Use |
|----------|--------|-----|
| --font-display | Syne | Page titles, section headers, brand |
| --font-body | Space Grotesk | All body text, nav, buttons, inputs |
| --font-mono | JetBrains Mono | Prices, P&L, times, codes, labels, chips |

## Type Scale
| Token | Font | Size | Weight | Use |
|-------|------|------|--------|-----|
| page-title | Syne | 22px | 800 | h1 on every page |
| section-header | Syne | 13px | 700 | Group headers (NIFTY, BANKNIFTY) |
| card-title | Space Grotesk | 15px | 600 | Card headings, algo names |
| body | Space Grotesk | 13px | 400 | Default text, descriptions |
| body-sm | Space Grotesk | 12px | 400 | Secondary text |
| nav | Space Grotesk | 14px | 500 | Navigation links |
| button | Space Grotesk | 12px | 500 | Button labels |
| label | JetBrains Mono | 10px | 400 | Uppercase column headers, field labels |
| chip | JetBrains Mono | 9px | 600 | Status badges, category tags |
| price | JetBrains Mono | any | 600–700 | All prices, P&L values |
| time | JetBrains Mono | 11px | 400 | Entry/exit times |
| code | JetBrains Mono | 12px | 400 | Algo IDs, order codes |

## Rules
1. NEVER use Inter, DM Sans, Arial, Times, or any unlisted family
2. All prices and numeric data: JetBrains Mono always
3. body {} must always specify font-family: var(--font-body)
4. Same spec applies to all LIFEX modules: STAAX, INVEX, BUDGEX, TRAVEX
