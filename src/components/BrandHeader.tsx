import { Settings } from 'lucide-react'
import { FluentEmoji } from '../lib/emoji'

interface BrandHeaderProps {
  onToggleSettings?: () => void
}

export function BrandHeader({ onToggleSettings }: BrandHeaderProps) {
  return (
    <header className="top-bar">
      <div className="brand">
        <FluentEmoji name="receipt" fallback="🧾" className="brand-mark" />
        <div>
          <h1 className="brand-title">tong账本</h1>
          <p className="brand-subtitle">拍照计算</p>
        </div>
      </div>
      {onToggleSettings ? (
        <button className="icon-button" type="button" onClick={onToggleSettings} aria-label="打开设置">
          <Settings size={20} />
        </button>
      ) : null}
    </header>
  )
}
