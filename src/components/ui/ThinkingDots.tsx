'use client'
import React from 'react'
interface ThinkingDotsProps { visible: boolean; message?: string }
export default function ThinkingDots({ visible, message }: ThinkingDotsProps) {
  const css = `@keyframes thinking-pulse {
    0%{opacity:0.3;transform:scale(1)}
    50%{opacity:1;transform:scale(1.3)}
    100%{opacity:0.3;transform:scale(1)}
  }`
  const dot = (delay: string): React.CSSProperties => ({
    width:6, height:6, borderRadius:'50%', background:'#fff',
    opacity:0.3, display:'inline-block', transformOrigin:'center',
    animationName:'thinking-pulse', animationDuration:'0.8s',
    animationTimingFunction:'ease-in-out', animationIterationCount:'infinite',
    animationDelay: delay, animationFillMode:'both',
  })
  return (
    <>
      <style dangerouslySetInnerHTML={{__html:css}}/>
      <div style={{display:'inline-flex',alignItems:'center',gap:8,
        transition:'opacity 200ms ease',opacity:visible?1:0,
        pointerEvents:visible?'auto':'none'}}>
        <div style={{display:'flex',gap:6,alignItems:'center'}}>
          <span style={dot('0s')}/><span style={dot('0.2s')}/><span style={dot('0.4s')}/>
        </div>
        {message && <div style={{color:'#fff',fontSize:13}}>{message}</div>}
      </div>
    </>
  )
}
