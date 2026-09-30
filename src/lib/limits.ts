// Reject oversized prompts before retrieval/LLM call: cost control and a
// baseline defense against prompt stuffing. Both client and API route import this.
export const MAX_PROMPT_CHARS = 1000;
