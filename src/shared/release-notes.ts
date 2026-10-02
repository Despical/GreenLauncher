/** GitHub Atom notes are HTML; show inert text in the launcher, never markup. */
export function releaseNotesText(value: string): string {
  const entities: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '–', mdash: '—', lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”' }
  return value.slice(0, 32000)
    .replace(/<!--[^]*?(?:-->|$)/g, '')
    .replace(/<(script|style)\b[^>]*>[^]*?(?:<\/\1\s*>|$)/gi, '')
    .replace(/<h([1-6])\b[^>]*>/gi, (_tag, level: string) => `\n${'#'.repeat(Number(level))} `)
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

export type ReleaseNotesBlock = { kind: 'heading'; level: number; text: string } | { kind: 'paragraph'; text: string } | { kind: 'list'; items: string[] }

/** Interpret block structure as data. Remote notes never become executable HTML. */
export function releaseNotesBlocks(value: string): ReleaseNotesBlock[] {
  const blocks: ReleaseNotesBlock[] = []
  for (const line of releaseNotesText(value).split('\n')) {
    const text = line.trim()
    if (!text) { if (blocks.at(-1)?.kind !== 'list') blocks.push({ kind: 'paragraph', text: '' }); continue }
    const heading = /^(#{1,6})\s+(.+?)(?:\s+#+)?$/.exec(text)
    if (heading) { blocks.push({ kind: 'heading', level: heading[1].length, text: heading[2] }); continue }
    const item = /^(?:[-*+•]|\d+[.)])\s+(.+)$/.exec(text)
    const previous = blocks.at(-1)
    if (item) {
      if (previous?.kind === 'list') previous.items.push(item[1])
      else blocks.push({ kind: 'list', items: [item[1]] })
    } else if (previous?.kind === 'paragraph' && previous.text) previous.text += `\n${text}`
    else blocks.push({ kind: 'paragraph', text })
  }
  return blocks.filter(block => block.kind !== 'paragraph' || block.text)
}
