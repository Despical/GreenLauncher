import { useEffect, useState } from 'react'

export function useWindowActive(): boolean {
  const [active, setActive] = useState(() => !document.hidden && document.hasFocus())
  useEffect(() => {
    const update = () => {
      const foreground = !document.hidden && document.hasFocus()
      document.body.classList.toggle('launcher-backgrounded', !foreground)
      setActive(foreground)
    }
    update()
    document.addEventListener('visibilitychange', update)
    window.addEventListener('focus', update)
    window.addEventListener('blur', update)
    return () => {
      document.body.classList.remove('launcher-backgrounded')
      document.removeEventListener('visibilitychange', update)
      window.removeEventListener('focus', update)
      window.removeEventListener('blur', update)
    }
  }, [])
  return active
}
