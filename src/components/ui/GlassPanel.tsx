"use client";

import React, { useEffect, useState } from 'react';
import { DemoButtons } from './DemoButtons';
import { useTextResolver } from '@/hooks/useTextResolver';

interface GlassPanelProps {
  textToResolve?: string;
  onSend?: () => void;
  onSpeak?: () => void;
}

export function GlassPanel({
  textToResolve = "WHAT DO YOU WANT TO LEARN TODAY?",
  onSend,
  onSpeak
}: GlassPanelProps) {
  const { resolve } = useTextResolver();
  const [resolvedText, setResolvedText] = useState("");

  useEffect(() => {
    // Start resolving the target string
    const cleanup = resolve(
      textToResolve,
      (text) => setResolvedText(text),
      () => { }, // onComplete placeholder
      { timeout: 35, iterations: 12 } // Slower timeout for visual matrix effect
    );
    return cleanup;
  }, [textToResolve, resolve]);

  return (
    <div className="glass-panel">
      {/* Top zone */}
      <div className="flex-1 flex items-start justify-center pt-8 pointer-events-none">
        <div className="text-white/40 text-xs tracking-[0.2em] uppercase font-sans">
          DAOD SYSTEM
        </div>
      </div>

      {/* Middle zone (text resolver) */}
      <div className="flex-[2] flex items-center justify-center text-white text-3xl font-serif text-center px-12 pointer-events-none leading-relaxed tracking-wider">
        {resolvedText}
      </div>

      {/* Bottom zone (buttons) */}
      <div className="flex-1 flex items-end justify-center pb-8">
        <DemoButtons onSend={onSend} onSpeak={onSpeak} />
      </div>

      <style jsx>{`
         .glass-panel {
             margin: 0 auto;
             display: flex;
             flex-direction: column;
             justify-content: space-between;
             width: min(680px, 90vw);
             aspect-ratio: 16/11;
             background: linear-gradient(145deg, rgba(30, 30, 45, 0.6) 0%, rgba(8, 8, 18, 0.8) 100%);
             backdrop-filter: blur(28px) saturate(130%);
             /* Heavier top/left borders for stronger highlights */
             border: 1px solid rgba(255, 255, 255, 0.05);
             border-top: 2px solid rgba(255, 255, 255, 0.3);
             border-left: 2px solid rgba(255, 255, 255, 0.2);
             border-right: 1px solid rgba(0, 0, 0, 0.4);
             border-bottom: 1px solid rgba(0, 0, 0, 0.6);
             border-radius: 16px;
             box-shadow: 
               /* Deep inner bevel to simulate thick rim */
               inset 0 0 0 1px rgba(255, 255, 255, 0.1),
               inset 0 0 0 3px rgba(0, 0, 0, 0.4),
               inset 0 0 0 4px rgba(255, 255, 255, 0.05),
               inset 0 20px 40px rgba(255, 255, 255, 0.03),
               /* Solid downward extrusion for literal physical thickness */
               0 1px 0 rgba(255, 255, 255, 0.1),
               0 2px 0 rgba(20, 20, 35, 0.6),
               0 4px 0 rgba(15, 15, 25, 0.7),
               0 6px 0 rgba(10, 10, 15, 0.8),
               0 8px 0 rgba(0, 0, 0, 0.9),
               /* Heavy ambient drop shadows below the extrusion */
               0 32px 80px rgba(0, 0, 0, 0.95),
               0 16px 32px rgba(0, 0, 0, 0.8);
             position: relative;
             overflow: hidden;
         }
         .glass-panel::before {
             content: "";
             position: absolute;
             inset: 0;
             z-index: 0;
             pointer-events: none;
             opacity: 0.35;
             mix-blend-mode: overlay;
             background-image: url("data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noise'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.8' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noise)'/%3E%3C/svg%3E");
         }
         .glass-panel > div {
             position: relative;
             z-index: 10;
         }
      `}</style>
    </div>
  );
}
