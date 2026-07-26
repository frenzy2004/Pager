# Mochi product contract

Mochi is a screenshot-driven form assistant presented as a small animated pet.
Clicking the hosted pet turns it into a temporary sidebar overlay. Users can
drag, paste, or upload up to eight screenshots; Mochi combines them with the visible
page, optionally researches missing public facts with Exa, and uses OpenAI
vision plus structured output to craft exactly three strategies.

The hosted release proves the workflow against a universal form with job, lead,
and general presets. It supports review, fill-only, and cancellable autopilot
modes. Review is the default. Provider secrets stay server-side, screenshots
remain in memory, personal facts are never fabricated, and demo behavior is
explicitly labeled when live providers are unavailable.

The Vercel product publishes a Manifest V3 connector for Chrome 116+. Its pet
appears on every eligible HTTP/HTTPS tab, while one global side panel and
`chrome.storage.session` tray follow the user between tabs. Capture page grabs
the visible viewport. Snip area hides the pet, captures once, displays that
exact frame as an opaque frozen surface, and crops the user’s drag. The tray
holds no more than eight bounded JPEG captures and uploads them only on Analyze.

Alibaba Page Agent is the production browser-action adapter. Its bundle is
injected only when Execute is pressed and routes OpenAI-compatible requests
through a fixed Vercel endpoint. Provider keys remain server-side. Review does
not mutate, Fill only cannot submit, and Autopilot waits through a cancellable
three-second countdown before allowing one submit. Execution is limited to 16
steps, sensitive fields are excluded, and undo restores the pre-fill snapshot.

Success means the production URL supports screenshot input, three ranked
strategies, all three action modes, form fill and undo, responsive overlay
behavior, honest provider status, a downloadable connector, cross-tab shared
capture state, frozen region snipping, Page Agent execution, and undo.
