"use client";

import React from 'react';

interface DemoButtonsProps {
  onSend?: () => void;
  onSpeak?: () => void;
}

export function DemoButtons({ onSend, onSpeak }: DemoButtonsProps) {
  return (
    <div className="flex gap-[16px]">
      <button className="demo-btn" onClick={onSend}>
        SEND
      </button>
      <button className="demo-btn" onClick={onSpeak}>
        SPEAK
      </button>

      <style jsx>{`
        .demo-btn {
          background: rgba(255, 255, 255, 0.06);
          border: 1px solid rgba(255, 255, 255, 0.18);
          border-radius: 999px;
          backdrop-filter: blur(12px);
          color: rgba(255, 255, 255, 0.85);
          font-family: 'Unica One', Georgia, sans-serif;
          letter-spacing: 0.2em;
          text-transform: uppercase;
          font-size: 12px;
          padding: 12px 32px;
          transition: all 200ms ease;
          cursor: pointer;
          outline: none;
        }
        .demo-btn:hover {
          border: 1px solid rgba(255, 255, 255, 0.45);
          background: rgba(255, 255, 255, 0.12);
        }
        .demo-btn:active {
          transform: scale(0.97);
          background: rgba(255, 255, 255, 0.18);
        }
      `}</style>
    </div>
  );
}
