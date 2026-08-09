import { useEffect, useRef, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from 'react'

export interface MobileSheetProps {
  ariaLabel: string
  children: ReactNode
  className?: string
  onClose: () => void
}

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])'
].join(',')

export function MobileSheet({ ariaLabel, children, className = '', onClose }: MobileSheetProps) {
  const sheetRef = useRef<HTMLElement | null>(null)

  useEffect(() => {
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const previousOverflow = document.body.style.overflow
    const sheet = sheetRef.current
    document.body.style.overflow = 'hidden'
    const focusable = sheet?.querySelector<HTMLElement>(FOCUSABLE_SELECTOR)
    ;(focusable ?? sheet)?.focus()

    return () => {
      document.body.style.overflow = previousOverflow
      if (previouslyFocused?.isConnected) previouslyFocused.focus()
    }
  }, [])

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault()
      onClose()
      return
    }
    if (event.key !== 'Tab') return
    const focusable = Array.from(sheetRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR) ?? [])
    if (!focusable.length) {
      event.preventDefault()
      sheetRef.current?.focus()
      return
    }
    const first = focusable[0]
    const last = focusable[focusable.length - 1]
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault()
      last.focus()
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault()
      first.focus()
    }
  }

  return (
    <div className="mobile-sheet-backdrop" onClick={onClose}>
      <section
        aria-label={ariaLabel}
        aria-modal="true"
        className={`mobile-bottom-sheet ${className}`.trim()}
        onClick={event => event.stopPropagation()}
        onKeyDown={handleKeyDown}
        ref={sheetRef}
        role="dialog"
        tabIndex={-1}
      >
        {children}
      </section>
    </div>
  )
}
