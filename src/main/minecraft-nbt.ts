// NBT parsing is only needed when reading or writing game data. Loading its
// protocol compiler during launcher startup delays the first window.
export function minecraftNbt(): typeof import('prismarine-nbt') {
  return require('prismarine-nbt')
}
