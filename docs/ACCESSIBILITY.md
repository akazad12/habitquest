# Accessibility and responsive verification

Scope: engineering checks toward WCAG 2.2 AA alignment, not certification or a complete assistive-technology audit. Real synthetic demo data is used; no owner account is scanned.

## Automated checks

`npm run test:a11y` runs axe-core in Playwright Chromium against localhost only, with WCAG 2 A/AA, 2.1 A/AA and 2.2 AA tags. Fifteen states are scanned: login, registration, Today, Habits, Analytics, Rewards, purchase dialog, Profile, habit form, reward form, and five mobile main pages. The [raw report](verification/accessibility.json) retains incomplete results as well as violations.

Final result: **zero detected rule violations across all 15 states**. Incomplete contrast checks remain for gradients/chart rendering, and must not be interpreted as passed. The script additionally asserts forward/backward purchase-dialog focus wrapping and Escape dismissal. The browser context emulates reduced motion; chart animation is explicitly disabled and existing prefers-reduced-motion CSS remains. OS-level settings and screen-reader behavior were not independently certified.

To reproduce, deploy migrations to an isolated test database, run `npm run demo:seed` with the explicit fixture environment described in DEMO.md, then start the API on 3003 with WEB_ORIGIN=http://127.0.0.1:5175 and Vite on 5175 with VITE_API_URL=http://127.0.0.1:3003. Install the browser with `npx playwright install chromium`, then run `npm run test:a11y`. Linux CI installs browser system dependencies too. The generated credentials stay in ignored work/demo-account.json; the report contains no credentials.

## Issues found and fixed

| Finding                                                              | Change                                                             |
| -------------------------------------------------------------------- | ------------------------------------------------------------------ |
| Violet primary button contrast below 4.5:1, including hover          | Darker violet normal/hover states, verified by axe                 |
| Auth inline links distinguished only by color                        | Persistent underline                                               |
| Calendar intensity legend contrast                                   | Darker middle intensity background and larger labels               |
| Calendar targets only 14–15 px                                       | 24 px cells at desktop/mobile; intentional internal scrolling      |
| Mobile history table not keyboard-scrollable                         | Focusable labeled table-scroll regions with visible focus          |
| Zero-cell visible dot did not match accessible label                 | Actual zero count shown, with full date/session accessible label   |
| Native dialog Tab moved focus outside its controls in manual testing | Explicit forward/backward boundary wrap; Escape returns to trigger |
| SPA route changes lacked deliberate main focus/title                 | Main focus and route-aware document title                          |
| Authentication layout lacked a main landmark                         | Semantic main element                                              |

## Manual browser observations

At 1440px desktop and 390px mobile, the app shell and tested dashboard/analytics layouts had no page-level horizontal overflow. Mobile document scroll width measured 375px including the browser's viewport scrollbar layout; wide tables and the twelve-month calendar scroll internally. Calendar cells measured 24px. Labels, native form controls, focus rings, skip link, chart data tables and non-color completion counts were inspected.

Keyboard checks confirmed Tab stays between confirmation controls, Shift+Tab wraps back, Escape dismisses an unsubmitted purchase and restores its trigger, skip navigation focuses main, and calendar arrows move between real date cells. Keyboard completion persisted after reload and undo returned the habit to incomplete. The test session was signed out. A transient dev-server restart exercised the existing connection-error/retry view; it recovered after retry. This is not a production outage measurement.

Screenshots are in `docs/screenshots`: Today, Habits, Analytics, Rewards, Profile/achievements, plus Today and Analytics mobile. They show a dedicated non-sensitive account with real persisted fixture data.

## Remaining limitations

Axe's incomplete gradient/chart contrast cases need targeted visual/contrast review; SVG chart perception is supplemented by labeled data tables. VoiceOver/NVDA, speech input, high-contrast/forced-color modes, all browser engines, 200–400% zoom, localization and all error-state combinations have not received a formal manual audit. The small calendar is a dense control surface even after 24px sizing; keyboard navigation and internal scrolling are deliberate. Reduced-motion emulation was used in the automated context, but no OS-level review is claimed.

Future releases should retain these regression checks and add user/assistive-technology testing before claiming broad conformance.
