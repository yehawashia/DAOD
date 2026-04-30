"use client";

import { useEffect, useRef } from "react";
import gsap from "gsap";

export type FreemiumReason = "limit" | "interrupt" | "voice";

interface FreemiumGateProps {
  reason: FreemiumReason;
  onUpgrade: () => void;
  onDismiss: () => void;
}

const COPY: Record<FreemiumReason, { headline: string; subtext: string }> = {
  limit: {
    headline: "You've explored 2 topics today.",
    subtext: "Come back tomorrow, or unlock unlimited learning.",
  },
  interrupt: {
    headline: "Steer the lesson — go paid.",
    subtext: "Interrupt and redirect any explanation, any time.",
  },
  voice: {
    headline: "Your voice, your pace.",
    subtext: "Speak your questions. Available on paid.",
  },
};

export default function FreemiumGate({
  reason,
  onUpgrade,
  onDismiss,
}: FreemiumGateProps) {
  const overlayRef = useRef<HTMLDivElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);

  const { headline, subtext } = COPY[reason];

  useEffect(() => {
    if (!overlayRef.current || !cardRef.current) return;

    gsap.set(overlayRef.current, { opacity: 0 });
    gsap.set(cardRef.current, { opacity: 0, y: 80 });

    gsap.to(overlayRef.current, { opacity: 1, duration: 0.25, ease: "none" });
    gsap.to(cardRef.current, {
      opacity: 1,
      y: 0,
      duration: 0.4,
      ease: "power2.out",
      delay: 0.05,
    });
  }, []);

  function dismiss() {
    if (!overlayRef.current || !cardRef.current) {
      onDismiss();
      return;
    }
    gsap.to(cardRef.current, { opacity: 0, y: 30, duration: 0.2, ease: "power2.in" });
    gsap.to(overlayRef.current, {
      opacity: 0,
      duration: 0.2,
      delay: 0.1,
      ease: "none",
      onComplete: onDismiss,
    });
  }

  function upgrade() {
    if (!overlayRef.current || !cardRef.current) {
      onUpgrade();
      return;
    }
    gsap.to(cardRef.current, { opacity: 0, y: -20, duration: 0.2, ease: "power2.in" });
    gsap.to(overlayRef.current, {
      opacity: 0,
      duration: 0.2,
      delay: 0.1,
      ease: "none",
      onComplete: onUpgrade,
    });
  }

  return (
    <div
      ref={overlayRef}
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ backgroundColor: "rgba(0,0,0,0.92)" }}
      onClick={(e) => {
        if (e.target === overlayRef.current) dismiss();
      }}
    >
      <div
        ref={cardRef}
        className="relative w-full max-w-sm mx-4 px-8 py-10 flex flex-col items-center gap-6"
        style={{ border: "1px solid rgba(255,255,255,0.15)" }}
      >
        {/* Close button */}
        <button
          onClick={dismiss}
          className="absolute top-4 right-4 text-white/30 hover:text-white/70 text-sm transition leading-none"
          aria-label="Dismiss"
        >
          ✕
        </button>

        {/* Copy */}
        <div className="text-center flex flex-col gap-3">
          <h2 className="text-white text-2xl font-serif font-normal leading-tight">
            {headline}
          </h2>
          <p className="text-white/50 text-sm leading-relaxed">{subtext}</p>
        </div>

        {/* Thin Rule */}
        <hr className="w-full border-t border-white/10 my-1" />

        {/* Actions */}
        <div className="w-full flex flex-row gap-3 mt-1">
          <button
            onClick={dismiss}
            className="flex-1 py-3 text-[13px] font-serif text-white/40 hover:text-white/70 transition"
          >
            Come back tomorrow
          </button>
          <button
            onClick={upgrade}
            className="flex-[1.2] py-3 text-[13px] font-serif text-white bg-transparent hover:text-black hover:bg-white transition"
            style={{ border: "1px solid rgba(255,255,255,0.8)" }}
          >
            Unlock everything - £4.99/month
          </button>
        </div>
      </div>
    </div>
  );
}
