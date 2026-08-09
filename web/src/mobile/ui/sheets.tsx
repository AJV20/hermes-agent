import type { ReactNode } from 'react'

export interface MobileSheetProps {
  ariaLabel: string
  children: ReactNode
  className?: string
  onClose: () => void
}

export function MobileSheet({ ariaLabel, children, className = '', onClose }: MobileSheetProps) {
  return (
    <div className="mobile-sheet-backdrop" onClick={onClose}>
      <section
        aria-label={ariaLabel}
        aria-modal="true"
        className={`mobile-bottom-sheet ${className}`.trim()}
        onClick={event => event.stopPropagation()}
        role="dialog"
      >
        {children}
      </section>
    </div>
  )
}
