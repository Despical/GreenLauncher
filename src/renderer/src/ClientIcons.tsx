import { createContext, useContext, useMemo, type ReactNode } from 'react'
import type { GameVersion } from '../../shared/types'
import fallback from '../assets/cracked-stone-bricks.svg'

const ClientIcons = createContext<ReadonlyMap<string, GameVersion>>(new Map())

export function ClientIconsProvider({ versions, children }: { versions: GameVersion[]; children: ReactNode }) {
  const clients = useMemo(() => new Map(versions.filter(version => version.custom).map(version => [version.id, version])), [versions])
  return <ClientIcons.Provider value={clients}>{children}</ClientIcons.Provider>
}

export function useCustomClient(versionId: string) { return useContext(ClientIcons).get(versionId) }

export function ClientIcon({ versionId }: { versionId?: string }) {
  const client = useCustomClient(versionId ?? '')
  return <img src={client?.icon ?? fallback} alt="" draggable={false} onError={event => {
    if (event.currentTarget.getAttribute('src') !== fallback) event.currentTarget.src = fallback
  }} />
}
