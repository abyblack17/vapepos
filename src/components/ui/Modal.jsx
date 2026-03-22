import React, { useEffect } from 'react'
import { createPortal } from 'react-dom'

export default function Modal({ title, onClose, children, size = 'md' }) {
  useEffect(() => {
    const original = document.body.style.overflow
    document.body.style.overflow = 'hidden'

    const handler = (e) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', handler)

    return () => {
      document.body.style.overflow = original
      window.removeEventListener('keydown', handler)
    }
  }, [onClose])

  const maxWidths = {
    sm: '384px',
    md: '512px',
    lg: '672px',
    xl: '896px',
  }

  const modal = (
    <div
      style={{
        position:        'fixed',
        inset:           0,
        zIndex:          9999,
        display:         'flex',
        alignItems:      'center',
        justifyContent:  'center',
        backgroundColor: 'rgba(0, 0, 0, 0.65)',
        backdropFilter:  'blur(4px)',
        padding:         '16px',
      }}
      onClick={onClose}
    >
      <div
        style={{
          background:    '#101c35',
          border:        '1px solid rgba(255,255,255,0.1)',
          borderRadius:  '16px',
          boxShadow:     '0 25px 60px rgba(0,0,0,0.5)',
          width:         '100%',
          maxWidth:      maxWidths[size] || '512px',
          maxHeight:     '85vh',
          display:       'flex',
          flexDirection: 'column',
          animation:     'modalScaleIn 0.15s ease-out',
        }}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div style={{
          display:        'flex',
          alignItems:     'center',
          justifyContent: 'space-between',
          padding:        '20px 24px',
          borderBottom:   '1px solid rgba(255,255,255,0.1)',
          flexShrink:     0,
        }}>
          <h2 style={{ fontWeight: 700, fontSize: '1.125rem', color: '#f1f5f9', margin: 0 }}>
            {title}
          </h2>
          <button
            onClick={onClose}
            style={{
              width:      '32px',
              height:     '32px',
              display:    'flex',
              alignItems: 'center',
              justifyContent: 'center',
              borderRadius: '8px',
              border:     'none',
              background: 'transparent',
              color:      '#94a3b8',
              cursor:     'pointer',
              fontSize:   '18px',
              lineHeight: 1,
            }}
            onMouseEnter={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.1)'; e.currentTarget.style.color = '#e2e8f0' }}
            onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = '#94a3b8' }}
          >
            ✕
          </button>
        </div>

        {/* Body con scroll interno */}
        <div style={{ padding: '20px 24px', overflowY: 'auto', flex: 1 }}>
          {children}
        </div>
      </div>

      <style>{`
        @keyframes modalScaleIn {
          from { opacity: 0; transform: scale(0.95) translateY(-8px); }
          to   { opacity: 1; transform: scale(1)    translateY(0); }
        }
      `}</style>
    </div>
  )

  return createPortal(modal, document.body)
}
