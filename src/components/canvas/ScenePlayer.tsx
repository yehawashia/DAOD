"use client";

import {
  useRef,
  useState,
  useCallback,
  useEffect,
} from "react";
import MathCanvas, { MathCanvasHandle } from "./MathCanvas";
import type { DAOD, DAODStepType } from "@/lib/ai/schema";
import gsap from "gsap";
import { playNarration } from "@/lib/audio/player";

interface ScenePlayerProps {
  scene: DAOD | null;
  audioContext: AudioContext | null;
  onInterruptFail?: (reason: "limit" | "voice" | "interrupt") => void;
  onClose?: () => void;
}

export default function ScenePlayer({ scene, audioContext, onInterruptFail, onClose }: ScenePlayerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<MathCanvasHandle>(null);
  const subtitleRef = useRef<HTMLParagraphElement>(null);
  
  const [isPlaying, setIsPlaying] = useState(false);
  const [interruptText, setInterruptText] = useState("");
  const [showInterrupt, setShowInterrupt] = useState(false);
  const [isThinking, setIsThinking] = useState(false);
  const [currentNarration, setCurrentNarration] = useState("");
  const [currentStep, setCurrentStep] = useState(0);
  const [totalSteps, setTotalSteps] = useState(scene?.narration.length || 6);
  
  const isPlayingRef = useRef(false);
  
  useEffect(() => {
    isPlayingRef.current = isPlaying;
  }, [isPlaying]);

  // Handle slide up animation
  useEffect(() => {
    if (scene && containerRef.current) {
      gsap.fromTo(
        containerRef.current,
        { y: "100vh" },
        { y: 0, duration: 0.6, ease: "power3.out" }
      );
    }
  }, [scene]);

  // Internal narration playback logic binding
  const handleStepStart = useCallback(async (stepIndex: number, textLine?: string) => {
    setCurrentStep(stepIndex);
    const line = textLine || (scene ? scene.narration[stepIndex] : null);
    if (!line) return;

    setCurrentNarration(line);

    let durationInSecs = 0;
    if (audioContext) {
      durationInSecs = await playNarration(line, audioContext);
    } else {
      durationInSecs = 2.0; // fallback
    }

    if (subtitleRef.current) {
      const chars = subtitleRef.current.children;
      const staggerDelay = Math.max(0.05, durationInSecs / (chars.length || 1) * 0.8);
      gsap.fromTo(chars, 
        { opacity: 0, y: 5 },
        {
          opacity: 1,
          y: 0,
          duration: 0.2,
          stagger: staggerDelay,
          ease: "power1.out",
        }
      );
    }
  }, [scene, audioContext]);

  // Load and auto-play scene
  useEffect(() => {
    if (!scene) return;
    const canvas = canvasRef.current;
    if (!canvas) return;

    setTotalSteps(scene.narration.length);

    canvas.loadScene(scene, (stepIdx) => handleStepStart(stepIdx));
    canvas.play();
    setIsPlaying(true);
  }, [scene, handleStepStart]);

  const togglePlayPause = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    if (isPlayingRef.current) {
      canvas.pause();
      if (audioContext) audioContext.suspend();
      setIsPlaying(false);
    } else {
      canvas.getTimeline().resume();
      if (audioContext) audioContext.resume();
      setIsPlaying(true);
    }
  }, [audioContext]);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement) return;
      if (e.code === "Space") {
        e.preventDefault();
        togglePlayPause();
      } else if (e.key === "Escape") {
        onClose?.();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [togglePlayPause, onClose]);

  // Delayed interrupt
  useEffect(() => {
    let timeout: number;
    if (isPlaying && !hasInterruptedRef.current) {
      timeout = window.setTimeout(() => {
        setShowInterrupt(true);
      }, 3000);
    }
    return () => window.clearTimeout(timeout);
  }, [isPlaying]);

  const hasInterruptedRef = useRef(false);

  const handleInterruptSubmit = async () => {
    if (!interruptText.trim() || !scene || !canvasRef.current) return;
    const q = interruptText.trim();
    setInterruptText("");
    setIsThinking(true);
    hasInterruptedRef.current = true;
    
    // Pause everything
    canvasRef.current.pause();
    if (audioContext) audioContext.suspend();
    setIsPlaying(false);

    try {
      const currentState = canvasRef.current.getState().serializeState() ?? {};
      const completedSteps = scene.steps.slice(0, currentStep + 1);
      const remainingSteps = scene.steps.slice(currentStep + 1);
      const conversationHistory: string[] = []; // simple stub

      const res = await fetch("/api/interrupt", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          question: q,
          currentState,
          completedSteps,
          remainingSteps,
          conversationHistory,
        }),
      });

      if (res.status === 402) {
        onInterruptFail?.("interrupt");
        setIsThinking(false);
        return;
      }

      if (!res.ok) throw new Error("Interrupt fetch failed");

      const data = await res.json() as {
        narration: string[];
        steps: DAODStepType[];
      };

      // Append data natively to scene context (we're basically locally mutating the copy we hold)
      scene.steps.push(...data.steps);
      scene.narration.push(...data.narration);
      setTotalSteps(scene.narration.length);

      // Tell canvas to inject the new steps
      canvasRef.current.appendSteps(data.steps, (idx) => {
        handleStepStart(idx, scene.narration[idx]);
      }, currentStep + 1);

      // Resume
      canvasRef.current.getTimeline().resume();
      if (audioContext) audioContext.resume();
      setIsPlaying(true);
    } catch {
      // Fallback resume on fail
      canvasRef.current.getTimeline().resume();
      if (audioContext) audioContext.resume();
      setIsPlaying(true);
    } finally {
      setIsThinking(false);
    }
  };

  if (!scene) return null;

  const narrationWords = currentNarration.split(" ");
  const topicTitle = scene.topic || "Topic";

  return (
    <div ref={containerRef} className="fixed inset-0 z-40 bg-black flex flex-col font-serif">
      {/* Header */}
      <div className="absolute top-0 left-0 right-0 h-16 flex items-center justify-between px-6 z-10 pointer-events-none">
        <div className="text-white text-lg">{topicTitle}</div>
        <div className="flex gap-2 isolate pointer-events-auto">
          {Array.from({ length: totalSteps }).map((_, i) => (
            <div 
              key={i} 
              className={`w-1.5 h-1.5 rounded-full transition-colors duration-300 ${i <= currentStep ? 'bg-white' : 'bg-white/20'}`} 
            />
          ))}
        </div>
        <button onClick={onClose} className="text-white/40 hover:text-white pointer-events-auto text-xl leading-none px-2 py-1 transition-colors">
          ✕
        </button>
      </div>

      {/* Canvas Area */}
      <div className="flex-1 relative">
        <MathCanvas ref={canvasRef} className="w-full h-full" />
      </div>

      {/* Subtitle Bar */}
      {currentNarration && !isThinking && (
        <div className="absolute bottom-32 left-0 right-0 flex justify-center px-8 pointer-events-none">
          <p ref={subtitleRef} className="text-white text-xl text-center max-w-2xl leading-relaxed drop-shadow-lg flex flex-wrap justify-center overflow-hidden">
            {narrationWords.map((word, i) => (
              <span key={i} className="opacity-0 inline-block mr-1.5 isolate">
                {word}
              </span>
            ))}
          </p>
        </div>
      )}

      {/* Playback controls & Interrupt Input */}
      {isThinking ? (
        <div className="absolute bottom-0 left-0 right-0 h-24 bg-gradient-to-t from-black/80 to-transparent flex items-end justify-center pb-8 z-10">
           <div className="flex gap-2 items-center text-white/50">
             <span className="w-2 h-2 rounded-full bg-current animate-ping" />
             <span className="w-2 h-2 rounded-full bg-current animate-ping" style={{ animationDelay: '150ms' }} />
             <span className="w-2 h-2 rounded-full bg-current animate-ping" style={{ animationDelay: '300ms' }} />
           </div>
        </div>
      ) : showInterrupt ? (
        <div className="absolute bottom-0 left-0 right-0 bg-transparent flex items-end justify-center pb-8 px-4 isolate z-10">
          <div className="flex gap-3 w-full max-w-3xl bg-[#111] p-2 rounded-full border border-white/20">
            <input
              autoFocus
              value={interruptText}
              onChange={(e) => setInterruptText(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleInterruptSubmit()}
              placeholder="Ask a question..."
              className="flex-1 px-4 py-2 bg-transparent text-white placeholder-white/40 text-[15px] outline-none"
            />
            <button
              onClick={handleInterruptSubmit}
              className="px-6 py-2 rounded-full bg-white text-black font-semibold text-sm hover:bg-white/90 transition"
            >
              Ask
            </button>
          </div>
        </div>
      ) : (
        <div className="absolute bottom-8 left-0 right-0 flex justify-center z-10">
          <button
            onClick={togglePlayPause}
            className="px-6 py-2 rounded-full border border-white/20 hover:bg-white/10 text-white text-sm font-medium transition backdrop-blur-md"
          >
            {isPlaying ? "Pause" : "Play"}
          </button>
        </div>
      )}
    </div>
  );
}
