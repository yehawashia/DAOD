import gsap from "gsap";

export class TimelineManager {
  private master: gsap.core.Timeline;
  private onCompleteCallback?: () => void;

  constructor() {
    this.master = gsap.timeline({ paused: true });
  }

  get timeline(): gsap.core.Timeline {
    return this.master;
  }

  play() {
    this.master.play();
  }

  pause() {
    this.master.pause();
  }

  resume() {
    this.master.resume();
  }

  seek(time: number) {
    this.master.seek(time);
  }

  progress(): number {
    return this.master.progress();
  }

  duration(): number {
    return this.master.duration();
  }

  isActive(): boolean {
    return this.master.isActive();
  }

  onComplete(cb: () => void) {
    this.onCompleteCallback = cb;
    this.master.eventCallback("onComplete", cb);
  }

  /**
   * Appends a pre-built GSAP timeline to the master, used for
   * interruption continuation steps. Plays immediately if the master
   * was already playing.
   */
  appendSteps(tl: gsap.core.Timeline) {
    const wasPlaying = this.master.isActive();
    this.master.add(tl);
    if (wasPlaying) {
      this.master.play();
    }
  }

  /**
   * Appends a raw callback to the end of the master timeline, useful
   * for scheduling step-level events (e.g. triggering TTS narration).
   */
  addLabel(label: string, position: number | string = "+=0") {
    this.master.addLabel(label, position);
  }

  addCallback(cb: () => void, position: number | string = "+=0") {
    this.master.call(cb, undefined, position);
  }

  kill() {
    this.master.kill();
  }

  reset() {
    this.master.kill();
    this.master = gsap.timeline({ paused: true });
    if (this.onCompleteCallback) {
      this.master.eventCallback("onComplete", this.onCompleteCallback);
    }
  }
}
