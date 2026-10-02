const heads = new Map<string, Promise<string>>()

// Identical immutable texture data only needs one image decode and canvas crop.
export function skinHead(source: string): Promise<string> {
  const existing = heads.get(source)
  if (existing) {
    heads.delete(source)
    heads.set(source, existing)
    return existing
  }
  const request = createHead(source).catch(error => { heads.delete(source); throw error })
  heads.set(source, request)
  while (heads.size > 128) heads.delete(heads.keys().next().value!)
  return request
}

function createHead(source: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => {
      try {
        if (image.width < 48 || image.height < 16) { reject(new Error('Invalid skin texture')); return }
        const canvas = document.createElement('canvas')
        canvas.width = 8
        canvas.height = 8
        const context = canvas.getContext('2d')
        if (!context) { reject(new Error('Canvas unavailable')); return }
        context.imageSmoothingEnabled = false
        context.drawImage(image, 8, 8, 8, 8, 0, 0, 8, 8)
        // Legacy 64x32 textures may fill the unused hat region with opaque black.
        // Minecraft treats an entirely opaque upper-right region as no outer layer.
        let hasOverlay = true
        if (image.height === 32) {
          const layer = document.createElement('canvas')
          layer.width = layer.height = 32
          const layerContext = layer.getContext('2d')!
          layerContext.drawImage(image, 32, 0, 32, 32, 0, 0, 32, 32)
          const pixels = layerContext.getImageData(0, 0, 32, 32).data
          hasOverlay = pixels.some((value, index) => index % 4 === 3 && value < 128)
        }
        if (hasOverlay) context.drawImage(image, 40, 8, 8, 8, 0, 0, 8, 8)
        resolve(canvas.toDataURL('image/png'))
      } catch (error) { reject(error) }
    }
    image.onerror = () => reject(new Error('Skin texture unavailable'))
    image.src = source
  })
}
