import { dialog, nativeImage, type BrowserWindow } from 'electron'
import { statSync } from 'node:fs'
import { normalizeProfileIcon } from '../shared/profile-icons'

export async function chooseProfileIcon(window: BrowserWindow, title: string, imagesLabel: string): Promise<string | null> {
  const selection = await dialog.showOpenDialog(window, { title, properties: ['openFile'], filters: [{ name: imagesLabel, extensions: ['png', 'jpg', 'jpeg', 'webp', 'ico'] }] })
  if (selection.canceled || !selection.filePaths[0]) return null
  if (statSync(selection.filePaths[0]).size > 20000000) throw new Error('Profil ikonu geçersiz veya çok büyük.')
  const image = nativeImage.createFromPath(selection.filePaths[0])
  if (image.isEmpty()) throw new Error('İkon görseli açılamadı.')
  const { width, height } = image.getSize(), factor = Math.min(1, 128 / width, 128 / height)
  const thumbnail = image.resize({ width: Math.max(1, Math.round(width * factor)), height: Math.max(1, Math.round(height * factor)), quality: 'best' })
  const data = thumbnail.toDataURL()
  return normalizeProfileIcon({ enabled: true, type: 'custom', image: data }).image!
}
