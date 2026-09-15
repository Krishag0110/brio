/** Conservative fresh-source opt-out check, independent of queued approval. */
export function hasContactOptOut(text: string): boolean {
  return /\b(?:(?:do\s+not|don['’]?t|stop|never)\s+(?:contact(?:ing)?|repl(?:y|ying)|respond(?:ing)?|messag(?:e|ing)|mention(?:ing)?|tag(?:ging)?)|opt[ -]?out|unsubscribe|leave\s+me\s+alone|no\s+(?:more\s+)?(?:replies|responses|bots))\b/i.test(text);
}
