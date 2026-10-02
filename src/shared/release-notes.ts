/** GitHub Atom notes are HTML; show inert text in the launcher, never markup. */
export function releaseNotesText(value: string): string {
  const entities: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '–', mdash: '—', lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”' }
  return value.slice(0, 32000)
    .replace(/<!--[^]*?(?:-->|$)/g, '')
    .replace(/<(script|style)\b[^>]*>[^]*?(?:<\/\1\s*>|$)/gi, '')
    .replace(/<li\b[^>]*>/gi, '\n• ')
    .replace(/<(?:br|hr)\b[^>]*>|<\/(?:p|div|ul|ol|li|h[1-6]|section|pre)>/gi, '\n')
    .replace(/<\/?[a-z][^>]*>/gi, '')
    .replace(/&(#x[\da-f]+|#\d+|[a-z]+);/gi, (original, entity: string) => {
      if (!entity.startsWith('#')) return entities[entity.toLowerCase()] ?? original
      const code = entity[1].toLowerCase() === 'x' ? parseInt(entity.slice(2), 16) : Number(entity.slice(1))
      return code > 0 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff) ? String.fromCodePoint(code) : ''
    })
    .replace(/\r\n?/g, '\n').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim()
}
