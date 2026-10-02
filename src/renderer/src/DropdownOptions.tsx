import { useLayoutEffect, useRef, type ReactNode, type RefObject } from 'react'

// Keep the scrollbar outside the symmetric inset around menu options.
export function useMenuScrollbar(ref: RefObject<HTMLDivElement | null>) {
  useLayoutEffect(() => {
    const element = ref.current
    if (!element) return
    const measure = () => element.style.setProperty('--dropdown-scrollbar', `${element.offsetWidth - element.clientWidth}px`)
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    return () => observer.disconnect()
  })
}

export function DropdownOptions({ children, listRef }: { children: ReactNode; listRef?: RefObject<HTMLDivElement | null> }) {
  const local = useRef<HTMLDivElement>(null)
  const ref = listRef ?? local
  useMenuScrollbar(ref)
  return <div className="dropdown-options" ref={ref}>{children}</div>
}
