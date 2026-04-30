"use client";

import { useEffect, useRef } from "react";
import gsap from "gsap";
import Image from "next/image";

interface VoidIntroProps {
  logoSrc: string;
  onComplete: () => void;
}

export default function VoidIntro({ logoSrc, onComplete }: VoidIntroProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const logoRef = useRef<HTMLImageElement>(null);
  const lettersRef = useRef<(HTMLSpanElement | null)[]>([]);
  const taglineRef = useRef<HTMLParagraphElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);

  // Setup Canvas Particles
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let animationFrameId: number;
    let width = window.innerWidth;
    let height = window.innerHeight;

    const resize = () => {
      width = window.innerWidth;
      height = window.innerHeight;
      canvas.width = width;
      canvas.height = height;
    };
    resize();
    window.addEventListener("resize", resize);

    const numDots = Math.floor(Math.random() * 21) + 60; // 60-80
    const dots = Array.from({ length: numDots }).map(() => ({
      x: Math.random() * width,
      y: Math.random() * height,
      vx: (Math.random() - 0.5) * 0.2,
      vy: (Math.random() - 0.5) * 0.2,
      o: Math.random() * 0.3 + 0.05, // 0.05 - 0.35
      r: Math.random() * 1.5 + 0.5,
    }));

    const render = () => {
      ctx.clearRect(0, 0, width, height);
      dots.forEach((dot) => {
        dot.x += dot.vx;
        dot.y += dot.vy;
        if (dot.x < 0) dot.x = width;
        if (dot.x > width) dot.x = 0;
        if (dot.y < 0) dot.y = height;
        if (dot.y > height) dot.y = 0;

        ctx.beginPath();
        ctx.arc(dot.x, dot.y, dot.r, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(240, 237, 230, ${dot.o})`;
        ctx.fill();
      });
      animationFrameId = requestAnimationFrame(render);
    };
    render();

    return () => {
      window.removeEventListener("resize", resize);
      cancelAnimationFrame(animationFrameId);
    };
  }, []);

  // Setup GSAP Timeline
  useEffect(() => {
    let tl: gsap.core.Timeline;

    document.fonts.ready.then(() => {
      tl = gsap.timeline({
        onComplete: () => {
          // Fire at exactly 5000ms relative to start
          onComplete();
        },
      });

      // We use absolute time positions in GSAP via the position parameter

      // t=0.3s logo fades in and begins spinning
      if (logoRef.current) {
        tl.to(logoRef.current, { opacity: 1, duration: 0.8, ease: "power2.out" }, 0.3);
        // Spin finishes exactly as the staggered text sequence concludes (t=2.1s)
        tl.to(logoRef.current, { rotation: 360, duration: 1.8, ease: "power2.inOut" }, 0.3);
      }

      // t=1.1s letters stagger in 140ms
      const validLetters = lettersRef.current.filter(Boolean);
      if (validLetters.length > 0) {
        tl.to(validLetters, {
          opacity: 1,
          y: 0,
          duration: 0.6,
          stagger: 0.14,
          ease: "power2.out",
        }, 1.1);
      }

      // t=2.1s tagline fades in
      if (taglineRef.current) {
        tl.to(taglineRef.current, { opacity: 1, duration: 1, ease: "power1.inOut" }, 2.1);
      }

      // t=3.6s black overlay fades in
      if (overlayRef.current) {
        tl.to(overlayRef.current, { opacity: 1, duration: 1.4, ease: "none" }, 3.6);
      }

      // Ghost grid visible after intro completes (fades in alongside overlay)
      if (gridRef.current) {
        tl.to(gridRef.current, { opacity: 1, duration: 1.4 }, 3.6);
      }

      // Ensure timeline reaches 5s exactly
      tl.to({}, { duration: 0 }, 5.0);
    });

    return () => {
      if (tl) tl.kill();
    };
  }, [onComplete]);

  return (
    <div ref={containerRef} className="fixed inset-0 z-[100] bg-black text-[#f0ede6] overflow-hidden">
      {/* Ghost Grid (persists in background conceptually, visible at end) */}
      <div
        ref={gridRef}
        className="absolute inset-0 pointer-events-none opacity-0 flex items-center justify-center"
      >
        <div className="absolute w-px h-full bg-white/[0.03] left-[20%]"></div>
        <div className="absolute w-px h-full bg-white/[0.03] right-[20%]"></div>
        <div className="absolute h-px w-full bg-white/[0.03] top-[30%]"></div>
        <div className="absolute h-px w-full bg-white/[0.03] bottom-[30%]"></div>
      </div>

      {/* Particle Canvas */}
      <canvas ref={canvasRef} className="absolute inset-0 pointer-events-none" />

      {/* Scanning Line */}
      <div className="absolute top-0 left-0 w-full h-px bg-gradient-to-r from-transparent via-white/20 to-transparent pointer-events-none animate-[scan_8s_linear_infinite]" />

      {/* Main Content Sequence */}
      <div className="relative w-full h-full flex flex-col items-center justify-center font-serif">

        {/* Logo */}
        <div className="mb-12 h-32 w-32 relative">
          <Image
            ref={logoRef}
            src={logoSrc || "/placeholder-logo.svg"}
            alt="DAOD Logo"
            fill
            sizes="128px"
            className="w-full h-full object-contain opacity-0"
          />
        </div>

        {/* Letters D A O D */}
        <div
          className="flex gap-4 mb-8"
          style={{
            fontFamily: "Thunder, sans-serif",
            fontSize: "clamp(72px, 12vw, 140px)",
            letterSpacing: "0.25em",
            fontWeight: "normal",
            color: "rgba(240, 237, 230, 0.92)",
          }}
        >
          {['D', 'A', 'O', 'D'].map((letter, i) => (
            <span
              key={i}
              ref={(el) => { lettersRef.current[i] = el; }}
              className="opacity-0 translate-y-4"
            >
              {letter}
            </span>
          ))}
        </div>

        {/* Tagline */}
        <p
          ref={taglineRef}
          className="uppercase opacity-0"
          style={{
            fontFamily: "LemonWide, serif",
            fontSize: "clamp(20px, 1.2vw, 35px)",
            letterSpacing: "0.4em",
            color: "rgba(243, 223, 178, 0.95)",
          }}
        >
          The void awaits
        </p>
      </div>

      {/* Final Blackout Overlay */}
      <div ref={overlayRef} className="absolute inset-0 bg-black opacity-0 pointer-events-none" />

      <style jsx>{`
        @keyframes scan {
          0% { transform: translateY(-10px); }
          100% { transform: translateY(100vh); }
        }
      `}</style>
    </div>
  );
}
