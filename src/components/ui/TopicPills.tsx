'use client'
import React, { useState } from 'react'
interface TopicPillsProps {
  onSelect: (topic: string) => void
  disabled?: boolean
}
const TOPICS = [
  'What is a fraction?',
  'Explain Pythagoras theorem',
  'How does y = mx + c work?',
  'What is probability?',
  'Negative numbers',
  'Area of a circle',
]
export default function TopicPills({ onSelect, disabled = false }: TopicPillsProps) {
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null)
  const containerStyle: React.CSSProperties = {
    position: 'fixed', bottom: '96px', left: '50%',
    transform: 'translateX(-50%)', zIndex: 9999,
    width: '100%', maxWidth: '980px', display: 'flex',
    flexDirection: 'column', alignItems: 'center',
    pointerEvents: disabled ? 'none' : 'auto',
    opacity: disabled ? 0.3 : 1, boxSizing: 'border-box', padding: '0 16px',
  }
  const labelStyle: React.CSSProperties = {
    fontSize: 10, letterSpacing: '0.3em', textTransform: 'uppercase',
    color: 'rgba(240,237,230,0.35)', marginBottom: 8, userSelect: 'none',
  }
  const pillsWrapperStyle: React.CSSProperties = {
    display: 'flex', flexWrap: 'wrap', gap: 10,
    justifyContent: 'center', alignItems: 'center', width: '100%',
  }
  const basePill: React.CSSProperties = {
    borderRadius: 999, background: 'transparent',
    border: '1px solid rgba(255,255,255,0.18)',
    color: 'rgba(255,255,255,0.6)', fontFamily: 'Georgia, serif',
    fontSize: 12, padding: '7px 16px', cursor: 'pointer',
    transition: 'all 200ms ease', display: 'inline-flex',
    alignItems: 'center', justifyContent: 'center', userSelect: 'none',
  }
  return (
    <div style={containerStyle}>
      <div style={labelStyle}>or explore a topic</div>
      <div style={pillsWrapperStyle}>
        {TOPICS.map((topic, idx) => (
          <button key={topic} type="button"
            style={{ ...basePill, ...(hoveredIndex === idx ? { border: '1px solid rgba(255,255,255,0.45)', color: 'rgba(255,255,255,0.9)' } : {}) }}
            onMouseEnter={() => setHoveredIndex(idx)}
            onMouseLeave={() => setHoveredIndex(null)}
            onClick={() => onSelect(topic)}
            disabled={disabled}
          >{topic}</button>
        ))}
      </div>
    </div>
  )
}
