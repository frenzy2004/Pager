# Mochi product contract

Mochi is a screenshot-driven form assistant presented as a small animated pet.
Clicking the pet turns it into a temporary sidebar overlay. Users can drag,
paste, or upload up to three screenshots; Mochi combines them with the visible
page, optionally researches missing public facts with Exa, and uses OpenAI
vision plus structured output to craft exactly three strategies.

The hosted release proves the workflow against a universal form with job, lead,
and general presets. It supports review, fill-only, and cancellable autopilot
modes. Review is the default. Provider secrets stay server-side, screenshots
remain in memory, personal facts are never fabricated, and demo behavior is
explicitly labeled when live providers are unavailable.

Page Agent is the production browser-action adapter. The hosted sandbox uses a
DOM driver through the same interface because it cannot control unrelated
browser tabs.

Success means the production URL supports screenshot input, three ranked
strategies, all three action modes, form fill and undo, responsive overlay
behavior, honest provider status, and a tested/documented extension seam.

