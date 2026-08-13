import { Bell, Bot, ChevronRight, FileUp, Settings, Sparkles } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router'

import {
  DEFAULT_MOBILE_PREFERENCES,
  MOBILE_CARD_IDS,
  type MobileCardId,
  type MobilePreferences,
  saveMobilePreferences
} from '../mobile-preferences'
import { AppHeader, DesktopDocumentLink } from '../ui/primitives'

const CARD_LABELS: Record<MobileCardId, string> = {
  connection: 'Desktop connection',
  continue: 'Continue conversation',
  notifications: 'Notifications',
  tasks: 'Task attention'
}

export function MoreScreen({ onPreferencesChange, preferences, profile }: {
  onPreferencesChange: (preferences: MobilePreferences) => void
  preferences: MobilePreferences
  profile: string
}) {
  const [expanded, setExpanded] = useState(false)
  const update = (next: MobilePreferences) => {
    saveMobilePreferences(profile, next)
    onPreferencesChange(next)
  }
  const move = (id: MobileCardId, direction: -1 | 1) => {
    const index = preferences.cardOrder.indexOf(id)
    const destination = index + direction
    if (destination < 0 || destination >= preferences.cardOrder.length) return
    const cardOrder = [...preferences.cardOrder]
    ;[cardOrder[index], cardOrder[destination]] = [cardOrder[destination], cardOrder[index]]
    update({ ...preferences, cardOrder })
  }
  const links = [
    { icon: Bell, label: 'Notifications', to: '/mobile/notifications' },
    { icon: Bell, label: 'Push notifications', to: '/mobile/push' },
    { icon: Bot, label: 'Model', to: '/mobile/models' },
    { icon: FileUp, label: 'Files', to: '/files' },
    { icon: Sparkles, label: 'Skills', to: '/skills' },
    { icon: Settings, label: 'Full dashboard', to: '/system' }
  ]
  return (
    <>
      <AppHeader detail="Desktop-level controls" />
      <main className="mobile-screen">
        <div className="mobile-page-heading"><div><p className="mobile-eyebrow">Power tools</p><h1>More</h1></div></div>
        <section className="mobile-preferences" aria-labelledby="mobile-preferences-title">
          <div className="mobile-section-heading"><h2 id="mobile-preferences-title">Mobile preferences</h2><button aria-expanded={expanded} onClick={() => setExpanded(current => !current)} type="button">{expanded ? 'Done' : 'Customize'}</button></div>
          {expanded && <>
            <fieldset><legend>Text size</legend>{(['normal', 'large'] as const).map(value => <button aria-pressed={preferences.textSize === value} key={value} onClick={() => update({ ...preferences, textSize: value })} type="button">{value === 'normal' ? 'Standard' : 'Large'}</button>)}</fieldset>
            <fieldset><legend>Card spacing</legend>{(['comfortable', 'compact'] as const).map(value => <button aria-pressed={preferences.density === value} key={value} onClick={() => update({ ...preferences, density: value })} type="button">{value === 'comfortable' ? 'Comfortable' : 'Compact'}</button>)}</fieldset>
            <div className="mobile-preference-cards">{preferences.cardOrder.map((id, index) => <div key={id}><label><input checked={!preferences.hiddenCards.includes(id)} onChange={() => update({ ...preferences, hiddenCards: preferences.hiddenCards.includes(id) ? preferences.hiddenCards.filter(card => card !== id) : [...preferences.hiddenCards, id] })} type="checkbox" />{CARD_LABELS[id]}</label><span><button aria-label={`Move ${CARD_LABELS[id]} earlier`} disabled={index === 0} onClick={() => move(id, -1)} type="button">↑</button><button aria-label={`Move ${CARD_LABELS[id]} later`} disabled={index === preferences.cardOrder.length - 1} onClick={() => move(id, 1)} type="button">↓</button></span></div>)}</div>
            <button className="mobile-preferences-reset" onClick={() => update({ ...DEFAULT_MOBILE_PREFERENCES, cardOrder: [...MOBILE_CARD_IDS] })} type="button">Reset mobile preferences</button>
          </>}
        </section>
        <div className="mobile-more-list">{links.map(item => { const Icon = item.icon; const content = <><Icon /><strong>{item.label}</strong><ChevronRight /></>; return item.to.startsWith('/mobile/') ? <Link key={item.to} to={item.to}>{content}</Link> : <DesktopDocumentLink key={item.to} to={item.to}>{content}</DesktopDocumentLink> })}</div>
      </main>
    </>
  )
}
