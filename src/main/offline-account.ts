import { createHash } from 'node:crypto'
import type { GameAccount } from '../shared/types'

export function offlineAccount(rawName: string): GameAccount {
  if (typeof rawName !== 'string') throw new Error('Oyuncu adı geçersiz.')
  const name = rawName.trim()
  if (!/^[A-Za-z0-9_]{3,16}$/.test(name)) throw new Error('Oyuncu adı 3-16 karakter olmalı; yalnızca harf, rakam ve alt çizgi kullanılabilir.')
  const hash = createHash('md5').update(`OfflinePlayer:${name}`, 'utf8').digest()
  hash[6] = (hash[6] & 0x0f) | 0x30
  hash[8] = (hash[8] & 0x3f) | 0x80
  const id = hash.toString('hex')
  return { id, name, homeAccountId: id, kind: 'offline' }
}
