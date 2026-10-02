/** Keep fractional GB readable, without overstating the configured MB. */
export function memoryGb(memoryMb: number): string {
  const value = Math.floor(memoryMb / 1024 * 100) / 100
  return Number.isInteger(value) ? String(value) : value.toFixed(2)
}
