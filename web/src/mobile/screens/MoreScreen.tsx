import { Bell, Bot, ChevronRight, FileUp, Settings, Sparkles } from 'lucide-react'
import { Link } from 'react-router'

import { AppHeader, DesktopDocumentLink } from '../ui/primitives'

export function MoreScreen() {
  const links = [
    { icon: Bell, label: 'Notifications', to: '/mobile/notifications' },
    { icon: Bot, label: 'Models and capabilities', to: '/models' },
    { icon: FileUp, label: 'Files', to: '/files' },
    { icon: Sparkles, label: 'Skills', to: '/skills' },
    { icon: Settings, label: 'Full dashboard', to: '/system' }
  ]
  return (
    <>
      <AppHeader detail="Desktop-level controls" />
      <main className="mobile-screen">
        <div className="mobile-page-heading">
          <div>
            <p className="mobile-eyebrow">Power tools</p>
            <h1>More</h1>
          </div>
        </div>
        <div className="mobile-more-list">
          {links.map(item => {
            const Icon = item.icon
            const content = <><Icon /><strong>{item.label}</strong><ChevronRight /></>
            return item.to.startsWith('/mobile/') ? (
              <Link key={item.to} to={item.to}>{content}</Link>
            ) : (
              <DesktopDocumentLink key={item.to} to={item.to}>{content}</DesktopDocumentLink>
            )
          })}
        </div>
      </main>
    </>
  )
}
