/**
 * Short-viewport sizing for the candidate interview gate cards (system check, consent,
 * integrity, start, questions, thanks). Same structure and order — only spacing, width,
 * logo and heading size tighten so the card fits laptop-height windows without scrolling.
 */
export const GATE_CARD_FIT =
  "[@media(max-height:820px)]:max-w-3xl [@media(max-height:820px)]:space-y-2 [@media(max-height:820px)]:p-5";

/** The logo PNG has built-in vertical padding; narrowing keeps the wordmark whole at h-10. */
export const GATE_LOGO_FIT =
  "[@media(max-height:820px)]:h-10 [@media(max-height:820px)]:w-72";

export const GATE_TITLE_FIT = "[@media(max-height:820px)]:text-2xl";
