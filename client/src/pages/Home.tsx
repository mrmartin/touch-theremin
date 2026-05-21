/**
 * Touch Theremin — Home Page
 *
 * Design: Bioluminescent Deep Sea
 * - Deep ocean black (#060810) base with ambient blue-green glow
 * - Touch circles: luminous blobs with inner light source, full spectrum mapped to pitch
 * - Particle field: 50 drifting dots that scatter from touch points
 * - Ripple rings on touch start, spring-scale entrance, flash-fade on release
 * - Typography: DM Mono for note labels, DM Sans for UI hints
 *
 * Audio: Web Audio API
 * - X axis → pitch (C pentatonic, C3–C6)
 * - Y axis → volume (quiet top, loud bottom)
 * - Oscillator stack: sine + triangle + upper partials → warm theremin timbre
 */

import { useEffect, useRef, useCallback } from "react";

// ─── Music theory ────────────────────────────────────────────────────────────
const PENTATONIC_INTERVALS = [0, 2, 4, 7, 9];
const BASE_NOTE = 48; // C3
const TOP_NOTE = 84;  // C6
const NOTE_NAMES = ["C","C#","D","D#","E","F","F#","G","G#","A","A#","B"];

function midiToFreq(midi: number) {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

function xToFreq(x: number, w: number) {
  const totalSemitones = TOP_NOTE - BASE_NOTE;
  const raw = (x / w) * totalSemitones;
  const octave = Math.floor(raw / 12);
  const semInOct = raw % 12;
  let best = PENTATONIC_INTERVALS[0];
  let bestDist = Infinity;
  for (const iv of PENTATONIC_INTERVALS) {
    const d = Math.abs(semInOct - iv);
    if (d < bestDist) { bestDist = d; best = iv; }
  }
  const midi = Math.min(BASE_NOTE + octave * 12 + best, TOP_NOTE);
  return midiToFreq(midi);
}

function yToGain(y: number, h: number) {
  return 0.02 + (y / h) * 0.53;
}

function xToHue(x: number, w: number) {
  return Math.round((x / w) * 300);
}

function freqToName(freq: number) {
  const midi = Math.round(69 + 12 * Math.log2(freq / 440));
  const oct = Math.floor(midi / 12) - 1;
  return NOTE_NAMES[midi % 12] + oct;
}

// ─── Voice (Web Audio) ────────────────────────────────────────────────────────
class Voice {
  masterGain: GainNode;
  filter: BiquadFilterNode;
  oscs: Array<{ osc: OscillatorNode; g: GainNode }> = [];
  _freq = 0;

  constructor(private ctx: AudioContext, x: number, y: number, w: number, h: number) {
    this.masterGain = ctx.createGain();
    this.masterGain.gain.setValueAtTime(0.0001, ctx.currentTime);

    this.filter = ctx.createBiquadFilter();
    this.filter.type = "lowpass";
    this.filter.frequency.value = 4000;
    this.filter.Q.value = 1.2;
    this.filter.connect(this.masterGain);
    this.masterGain.connect(ctx.destination);

    const ratios = [1, 1.5, 2, 3];
    const gains  = [1, 0.35, 0.2, 0.08];
    const types: OscillatorType[] = ["sine", "triangle", "sine", "sine"];

    for (let i = 0; i < ratios.length; i++) {
      const osc = ctx.createOscillator();
      osc.type = types[i];
      const g = ctx.createGain();
      g.gain.value = gains[i];
      osc.connect(g);
      g.connect(this.filter);
      osc.start();
      this.oscs.push({ osc, g });
    }

    this.update(x, y, w, h, true);
  }

  update(x: number, y: number, w: number, h: number, instant = false) {
    const now = this.ctx.currentTime;
    const freq = xToFreq(x, w);
    const gain = yToGain(y, h);
    this._freq = freq;

    const ramp = instant ? 0 : 0.04;
    if (instant) {
      this.oscs[0].osc.frequency.setValueAtTime(freq, now);
      this.oscs[1].osc.frequency.setValueAtTime(freq * 1.5 + 0.5, now);
      this.oscs[2].osc.frequency.setValueAtTime(freq * 2.01, now);
      this.oscs[3].osc.frequency.setValueAtTime(freq * 3.02, now);
      this.masterGain.gain.setValueAtTime(gain, now);
    } else {
      this.oscs[0].osc.frequency.linearRampToValueAtTime(freq, now + ramp);
      this.oscs[1].osc.frequency.linearRampToValueAtTime(freq * 1.5 + 0.5, now + ramp);
      this.oscs[2].osc.frequency.linearRampToValueAtTime(freq * 2.01, now + ramp);
      this.oscs[3].osc.frequency.linearRampToValueAtTime(freq * 3.02, now + ramp);
      this.masterGain.gain.linearRampToValueAtTime(gain, now + ramp);
    }
  }

  stop() {
    const now = this.ctx.currentTime;
    this.masterGain.gain.linearRampToValueAtTime(0.0001, now + 0.12);
    setTimeout(() => {
      try {
        for (const { osc } of this.oscs) osc.stop();
        this.masterGain.disconnect();
      } catch (_) {}
    }, 200);
  }
}

// ─── Particle system ──────────────────────────────────────────────────────────
interface Particle {
  x: number; y: number;
  vx: number; vy: number;
  r: number; alpha: number;
}

function makeParticles(count: number, w: number, h: number): Particle[] {
  return Array.from({ length: count }, () => ({
    x: Math.random() * w,
    y: Math.random() * h,
    vx: (Math.random() - 0.5) * 0.3,
    vy: (Math.random() - 0.5) * 0.3,
    r: Math.random() * 1.5 + 0.5,
    alpha: Math.random() * 0.4 + 0.1,
  }));
}

// ─── Ripple ───────────────────────────────────────────────────────────────────
interface Ripple {
  x: number; y: number;
  r: number; maxR: number;
  hue: number; alpha: number;
  born: number;
}

// ─── Touch dot state ──────────────────────────────────────────────────────────
interface DotState {
  x: number; y: number;
  hue: number; size: number;
  note: string; scale: number;
  born: number;
}

// ─── Component ───────────────────────────────────────────────────────────────
export default function Home() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const ctxAudioRef = useRef<AudioContext | null>(null);
  const voicesRef = useRef<Map<string, Voice>>(new Map());
  const dotsRef = useRef<Map<string, DotState>>(new Map());
  const particlesRef = useRef<Particle[]>([]);
  const ripplesRef = useRef<Ripple[]>([]);
  const rafRef = useRef<number>(0);
  const hintAlphaRef = useRef(1);
  const hintTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Audio context (lazy, on first touch) ──
  function getAudioCtx() {
    if (!ctxAudioRef.current) {
      ctxAudioRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
    }
    if (ctxAudioRef.current.state === "suspended") ctxAudioRef.current.resume();
    return ctxAudioRef.current;
  }

  // ── Canvas draw loop ──
  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d")!;
    const W = canvas.width;
    const H = canvas.height;
    const now = performance.now();

    // Background
    ctx.fillStyle = "#060810";
    ctx.fillRect(0, 0, W, H);

    // Dot-grid
    ctx.fillStyle = "rgba(0,180,255,0.06)";
    const gs = 48;
    for (let gx = gs; gx < W; gx += gs) {
      for (let gy = gs; gy < H; gy += gs) {
        ctx.beginPath();
        ctx.arc(gx, gy, 1, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // Particles
    const touchPoints = Array.from(dotsRef.current.values());
    for (const p of particlesRef.current) {
      // Repel from touch points
      for (const dot of touchPoints) {
        const dx = p.x - dot.x;
        const dy = p.y - dot.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < 120 && dist > 0) {
          const force = (120 - dist) / 120 * 0.4;
          p.vx += (dx / dist) * force;
          p.vy += (dy / dist) * force;
        }
      }
      // Damping
      p.vx *= 0.97;
      p.vy *= 0.97;
      // Drift
      p.x += p.vx;
      p.y += p.vy;
      // Wrap
      if (p.x < 0) p.x = W;
      if (p.x > W) p.x = 0;
      if (p.y < 0) p.y = H;
      if (p.y > H) p.y = 0;

      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(80,200,255,${p.alpha})`;
      ctx.fill();
    }

    // Ripples
    ripplesRef.current = ripplesRef.current.filter(rp => {
      const age = (now - rp.born) / 600;
      if (age > 1) return false;
      rp.r = rp.maxR * age;
      rp.alpha = (1 - age) * 0.5;
      ctx.beginPath();
      ctx.arc(rp.x, rp.y, rp.r, 0, Math.PI * 2);
      ctx.strokeStyle = `hsla(${rp.hue},100%,70%,${rp.alpha})`;
      ctx.lineWidth = 1.5;
      ctx.stroke();
      return true;
    });

    // Touch circles
    for (const [, dot] of Array.from(dotsRef.current)) {
      const age = (now - dot.born) / 200;
      // Spring overshoot: 0.5 → 1.08 → 1.0
      let sc = dot.scale;
      if (age < 1) {
        const t = age;
        sc = 0.5 + 0.58 * t + 0.08 * Math.sin(t * Math.PI);
        dot.scale = sc;
      }

      const r = (dot.size / 2) * sc;
      const hue = dot.hue;

      // Outer glow
      const glow = ctx.createRadialGradient(dot.x, dot.y, 0, dot.x, dot.y, r * 2.2);
      glow.addColorStop(0, `hsla(${hue},100%,65%,0.18)`);
      glow.addColorStop(1, `hsla(${hue},100%,50%,0)`);
      ctx.beginPath();
      ctx.arc(dot.x, dot.y, r * 2.2, 0, Math.PI * 2);
      ctx.fillStyle = glow;
      ctx.fill();

      // Main blob
      const grad = ctx.createRadialGradient(dot.x - r * 0.3, dot.y - r * 0.3, r * 0.05, dot.x, dot.y, r);
      grad.addColorStop(0, `hsla(${hue},80%,92%,0.9)`);
      grad.addColorStop(0.35, `hsla(${hue},100%,65%,0.75)`);
      grad.addColorStop(1, `hsla(${hue},100%,40%,0.3)`);
      ctx.beginPath();
      ctx.arc(dot.x, dot.y, r, 0, Math.PI * 2);
      ctx.fillStyle = grad;
      ctx.fill();

      // Inner bright core
      const core = ctx.createRadialGradient(dot.x - r * 0.25, dot.y - r * 0.25, 0, dot.x, dot.y, r * 0.45);
      core.addColorStop(0, `rgba(255,255,255,0.85)`);
      core.addColorStop(1, `rgba(255,255,255,0)`);
      ctx.beginPath();
      ctx.arc(dot.x, dot.y, r * 0.45, 0, Math.PI * 2);
      ctx.fillStyle = core;
      ctx.fill();

      // Note label
      ctx.font = `600 12px 'DM Mono', monospace`;
      ctx.fillStyle = `hsla(${hue},60%,90%,0.85)`;
      ctx.textAlign = "center";
      ctx.fillText(dot.note, dot.x, dot.y + r + 18);
    }

    // Axis labels + hint
    ctx.font = `11px 'DM Sans', sans-serif`;
    ctx.letterSpacing = "0.1em";

    const axisAlpha = dotsRef.current.size > 0 ? 0.18 : 0.28;
    ctx.fillStyle = `rgba(0,200,255,${axisAlpha})`;
    ctx.textAlign = "left";
    ctx.fillText("◀ LOW PITCH", 16, H - 14);
    ctx.textAlign = "right";
    ctx.fillText("HIGH PITCH ▶", W - 16, H - 14);
    ctx.textAlign = "center";
    ctx.fillText("QUIET ▲", W / 2, 20);
    ctx.fillText("▼ LOUD", W / 2, H - 14);

    // Hint
    if (hintAlphaRef.current > 0) {
      ctx.font = `16px 'DM Sans', sans-serif`;
      ctx.fillStyle = `rgba(255,255,255,${hintAlphaRef.current * 0.22})`;
      ctx.textAlign = "center";
      ctx.fillText("Touch anywhere to play", W / 2, H / 2);
    }

    rafRef.current = requestAnimationFrame(draw);
  }, []);

  // ── Touch / mouse helpers ──
  const onStart = useCallback((id: string, x: number, y: number) => {
    const W = window.innerWidth;
    const H = window.innerHeight;
    const hue = xToHue(x, W);
    const gain = yToGain(y, H);
    const size = 70 + gain * 80;
    const freq = xToFreq(x, W);

    // Dot
    dotsRef.current.set(id, {
      x, y, hue, size,
      note: freqToName(freq),
      scale: 0.5,
      born: performance.now(),
    });

    // Ripple
    ripplesRef.current.push({ x, y, r: 0, maxR: size * 1.8, hue, alpha: 0.5, born: performance.now() });

    // Voice
    const ac = getAudioCtx();
    voicesRef.current.set(id, new Voice(ac, x, y, W, H));

    // Fade hint
    if (hintAlphaRef.current > 0) {
      hintAlphaRef.current = 0;
    }
  }, []);

  const onMove = useCallback((id: string, x: number, y: number) => {
    const W = window.innerWidth;
    const H = window.innerHeight;
    const dot = dotsRef.current.get(id);
    if (dot) {
      const hue = xToHue(x, W);
      const gain = yToGain(y, H);
      const size = 70 + gain * 80;
      const freq = xToFreq(x, W);
      dot.x = x; dot.y = y; dot.hue = hue; dot.size = size;
      dot.note = freqToName(freq);
    }
    const voice = voicesRef.current.get(id);
    if (voice) voice.update(x, y, W, H);
  }, []);

  const onEnd = useCallback((id: string) => {
    dotsRef.current.delete(id);
    const voice = voicesRef.current.get(id);
    if (voice) { voice.stop(); voicesRef.current.delete(id); }
    if (dotsRef.current.size === 0) {
      // Fade hint back in after 4s of silence
      if (hintTimerRef.current) clearTimeout(hintTimerRef.current);
      hintTimerRef.current = setTimeout(() => {
        hintAlphaRef.current = 1;
      }, 4000);
    }
  }, []);

  // ── Resize ──
  const resize = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    particlesRef.current = makeParticles(55, window.innerWidth, window.innerHeight);
  }, []);

  // ── Mount ──
  useEffect(() => {
    resize();
    window.addEventListener("resize", resize);

    rafRef.current = requestAnimationFrame(draw);

    // Touch events
    const onTouchStart = (e: TouchEvent) => {
      e.preventDefault();
      Array.from(e.changedTouches).forEach(t => onStart(String(t.identifier), t.clientX, t.clientY));
    };
    const onTouchMove = (e: TouchEvent) => {
      e.preventDefault();
      Array.from(e.changedTouches).forEach(t => onMove(String(t.identifier), t.clientX, t.clientY));
    };
    const onTouchEnd = (e: TouchEvent) => {
      e.preventDefault();
      Array.from(e.changedTouches).forEach(t => onEnd(String(t.identifier)));
    };

    window.addEventListener("touchstart",  onTouchStart,  { passive: false });
    window.addEventListener("touchmove",   onTouchMove,   { passive: false });
    window.addEventListener("touchend",    onTouchEnd,    { passive: false });
    window.addEventListener("touchcancel", onTouchEnd,    { passive: false });

    // Mouse fallback
    let mouseDown = false;
    const onMouseDown = (e: MouseEvent) => {
      mouseDown = true;
      onStart("mouse", e.clientX, e.clientY);
    };
    const onMouseMove = (e: MouseEvent) => {
      if (!mouseDown) return;
      onMove("mouse", e.clientX, e.clientY);
    };
    const onMouseUp = (e: MouseEvent) => {
      if (!mouseDown) return;
      mouseDown = false;
      onEnd("mouse");
    };

    window.addEventListener("mousedown", onMouseDown);
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup",   onMouseUp);

    return () => {
      cancelAnimationFrame(rafRef.current);
      window.removeEventListener("resize", resize);
      window.removeEventListener("touchstart",  onTouchStart);
      window.removeEventListener("touchmove",   onTouchMove);
      window.removeEventListener("touchend",    onTouchEnd);
      window.removeEventListener("touchcancel", onTouchEnd);
      window.removeEventListener("mousedown", onMouseDown);
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup",   onMouseUp);
      if (hintTimerRef.current) clearTimeout(hintTimerRef.current);
      // Stop all voices
      Array.from(voicesRef.current.values()).forEach(v => v.stop());
    };
  }, [resize, draw, onStart, onMove, onEnd]);

  return (
    <canvas
      ref={canvasRef}
      style={{
        display: "block",
        position: "fixed",
        inset: 0,
        touchAction: "none",
        cursor: "crosshair",
      }}
    />
  );
}
