/**
 * Prime Mover — Just-Intonation MODE/CHORD Instrument
 *
 * Design: minimal dark grid, two rows of 18 pads.
 * - CHORD row (top half): hold pads to sustain notes at MODE × ratio
 * - NEXT row (bottom half): tap to multiply MODE by that pad's ratio; transposes held chord
 * - Top band: BASE / MODE display, RESET button, BASE ±1 Hz controls
 *
 * Audio: Web Audio API
 * - Four-oscillator Voice (×1 sine, ×1.5 triangle, ×2 sine, ×3 sine) with decreasing gain
 * - 40 ms attack ramp, 120 ms release ramp — no clicks
 * - NEXT tap: 250 ms blip at new MODE frequency
 * - MODE change: 30 ms retune ramp on all held CHORD voices
 *
 * State: all real-time data in useRef; only display fraction in useState.
 */

import { useEffect, useRef, useCallback, useState } from "react";

// ─── Ratios ───────────────────────────────────────────────────────────────────
const RATIOS: [number, number][] = [
  [1,7],[1,6],[1,5],[1,4],[2,7],[1,3],[2,5],[3,7],[1,2],
  [4,7],[3,5],[2,3],[5,7],[3,4],[4,5],[5,6],[6,7],[1,1],
];

// ─── GCD ─────────────────────────────────────────────────────────────────────
function gcd(a: number, b: number): number {
  a = Math.abs(Math.round(a));
  b = Math.abs(Math.round(b));
  while (b) { const t = b; b = a % b; a = t; }
  return a;
}

// ─── Voice ────────────────────────────────────────────────────────────────────
class Voice {
  masterGain: GainNode;
  filter: BiquadFilterNode;
  oscs: Array<{ osc: OscillatorNode; g: GainNode }> = [];

  constructor(private ctx: AudioContext, freq: number) {
    this.masterGain = ctx.createGain();
    this.masterGain.gain.setValueAtTime(0.0001, ctx.currentTime);

    this.filter = ctx.createBiquadFilter();
    this.filter.type = "lowpass";
    this.filter.frequency.value = 5000;
    this.filter.Q.value = 0.8;
    this.filter.connect(this.masterGain);
    this.masterGain.connect(ctx.destination);

    const ratios  = [1, 1.5, 2, 3];
    const gains   = [1, 0.35, 0.2, 0.08];
    const types: OscillatorType[] = ["sine", "triangle", "sine", "sine"];

    for (let i = 0; i < ratios.length; i++) {
      const osc = ctx.createOscillator();
      osc.type = types[i];
      osc.frequency.setValueAtTime(freq * ratios[i], ctx.currentTime);
      const g = ctx.createGain();
      g.gain.value = gains[i];
      osc.connect(g);
      g.connect(this.filter);
      osc.start();
      this.oscs.push({ osc, g });
    }

    // Attack ramp
    this.masterGain.gain.linearRampToValueAtTime(0.55, ctx.currentTime + 0.04);
  }

  retune(freq: number, rampMs = 30) {
    const now = this.ctx.currentTime;
    const ramp = rampMs / 1000;
    const baseRatios = [1, 1.5, 2, 3];
    for (let i = 0; i < this.oscs.length; i++) {
      this.oscs[i].osc.frequency.linearRampToValueAtTime(freq * baseRatios[i], now + ramp);
    }
  }

  stop(decayMs = 120) {
    const now = this.ctx.currentTime;
    const decay = decayMs / 1000;
    this.masterGain.gain.linearRampToValueAtTime(0.0001, now + decay);
    setTimeout(() => {
      try {
        for (const { osc } of this.oscs) osc.stop();
        this.masterGain.disconnect();
      } catch (_) {}
    }, decayMs + 50);
  }
}

// ─── Pad geometry ─────────────────────────────────────────────────────────────
interface Pad {
  index: number;
  row: "chord" | "next";
  ratioIndex: number;
  x: number; y: number; w: number; h: number;
}

function buildPads(W: number, H: number): Pad[] {
  const topBand   = Math.round(H * 0.08);
  const rowH      = Math.round((H - topBand) / 2);
  const padW      = W / 18;
  const pads: Pad[] = [];
  const gap = 2;

  for (let i = 0; i < 18; i++) {
    pads.push({
      index: i,
      row: "chord",
      ratioIndex: i,
      x: i * padW + gap / 2,
      y: topBand + gap / 2,
      w: padW - gap,
      h: rowH - gap,
    });
  }
  for (let i = 0; i < 18; i++) {
    pads.push({
      index: i + 18,
      row: "next",
      ratioIndex: i,
      x: i * padW + gap / 2,
      y: topBand + rowH + gap / 2,
      w: padW - gap,
      h: rowH - gap,
    });
  }
  return pads;
}

function hitPad(pads: Pad[], px: number, py: number): Pad | null {
  for (const p of pads) {
    if (px >= p.x && px <= p.x + p.w && py >= p.y && py <= p.y + p.h) return p;
  }
  return null;
}

// ─── Rounded rect helper ──────────────────────────────────────────────────────
function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number, y: number, w: number, h: number, r: number
) {
  r = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.arcTo(x + w, y, x + w, y + r, r);
  ctx.lineTo(x + w, y + h - r);
  ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
  ctx.lineTo(x + r, y + h);
  ctx.arcTo(x, y + h, x, y + h - r, r);
  ctx.lineTo(x, y + r);
  ctx.arcTo(x, y, x + r, y, r);
  ctx.closePath();
}

// ─── Colours ──────────────────────────────────────────────────────────────────
const COLOR = {
  bg:          "#0d0f14",
  chordBase:   "#1a2a3a",
  chordLit:    "#2a7fff",
  chordBorder: "#1e3a5a",
  nextBase:    "#1a2e1a",
  nextLit:     "#22cc55",
  nextBorder:  "#1e4a1e",
  text:        "#8ab4cc",
  textBright:  "#d0e8f8",
  ratioText:   "#c8dce8",
  ratioTextLit:"#ffffff",
  topBg:       "#0a0c10",
  btnBg:       "#1e2a38",
  btnHover:    "#2a3a50",
  btnText:     "#9ab8cc",
};

// ─── Component ────────────────────────────────────────────────────────────────
interface DisplayState {
  base: number;
  modeNum: number;
  modeDen: number;
}

export default function Home() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // Audio
  const audioCtxRef   = useRef<AudioContext | null>(null);
  const modeRef       = useRef<number>(220);
  const baseRef       = useRef<number>(220);
  const modeNumRef    = useRef<number>(1);
  const modeDenRef    = useRef<number>(1);

  // Voices
  const chordVoicesRef = useRef<Map<number, Voice>>(new Map()); // padIndex → Voice
  const nextVoiceRef   = useRef<Voice | null>(null);
  const nextBlipTimer  = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Touch tracking: touch identifier → pad index (or null if off-pad)
  const touchMapRef = useRef<Map<number, number | null>>(new Map());

  // Pad flash state: padIndex → flash-until timestamp
  const flashRef = useRef<Map<number, number>>(new Map());

  // Lit CHORD pads: set of pad indices currently held
  const litChordRef = useRef<Set<number>>(new Set());

  // Geometry
  const padsRef = useRef<Pad[]>([]);

  // UI control hit areas (built each draw)
  const resetBtnRef   = useRef<{ x: number; y: number; w: number; h: number } | null>(null);
  const basePlusBtnRef  = useRef<{ x: number; y: number; w: number; h: number } | null>(null);
  const baseMinusBtnRef = useRef<{ x: number; y: number; w: number; h: number } | null>(null);

  // Display state (React — drives text re-render)
  const [display, setDisplay] = useState<DisplayState>({ base: 220, modeNum: 1, modeDen: 1 });

  // Portrait warning
  const [portrait, setPortrait] = useState(false);

  // RAF
  const rafRef = useRef<number>(0);

  // ── Audio context ──
  function getAC(): AudioContext {
    if (!audioCtxRef.current) {
      audioCtxRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
    }
    if (audioCtxRef.current.state === "suspended") audioCtxRef.current.resume();
    return audioCtxRef.current;
  }

  // ── Sync modeRef from fraction ──
  function syncMode() {
    modeRef.current = baseRef.current * modeNumRef.current / modeDenRef.current;
  }

  // ── Retune all held CHORD voices ──
  function retuneChord(rampMs = 30) {
    for (const [padIdx, voice] of Array.from(chordVoicesRef.current)) {
      const ri = padIdx; // chord pad index 0–17 == ratioIndex
      const [num, den] = RATIOS[ri];
      voice.retune(modeRef.current * (num / den), rampMs);
    }
  }

  // ── Update display state ──
  function pushDisplay() {
    setDisplay({
      base:    baseRef.current,
      modeNum: modeNumRef.current,
      modeDen: modeDenRef.current,
    });
  }

  // ── RESET ──
  const doReset = useCallback(() => {
    modeNumRef.current = 1;
    modeDenRef.current = 1;
    syncMode();
    retuneChord(30);
    pushDisplay();
  }, []);

  // ── BASE ±1 ──
  const doBaseChange = useCallback((delta: number) => {
    baseRef.current = Math.max(20, baseRef.current + delta);
    syncMode();
    retuneChord(30);
    pushDisplay();
  }, []);

  // ── Draw loop ──
  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d")!;
    const W = canvas.width;
    const H = canvas.height;
    const now = performance.now();
    const topBand = Math.round(H * 0.08);

    // Background
    ctx.fillStyle = COLOR.bg;
    ctx.fillRect(0, 0, W, H);

    // Top band background
    ctx.fillStyle = COLOR.topBg;
    ctx.fillRect(0, 0, W, topBand);

    // ── Draw pads ──
    const pads = padsRef.current;
    for (const pad of pads) {
      const isChord = pad.row === "chord";
      const isLit   = isChord
        ? litChordRef.current.has(pad.index)
        : (flashRef.current.get(pad.index) ?? 0) > now;

      const baseColor   = isChord ? COLOR.chordBase   : COLOR.nextBase;
      const litColor    = isChord ? COLOR.chordLit    : COLOR.nextLit;
      const borderColor = isChord ? COLOR.chordBorder : COLOR.nextBorder;

      roundRect(ctx, pad.x, pad.y, pad.w, pad.h, 5);
      ctx.fillStyle = isLit ? litColor : baseColor;
      ctx.fill();
      ctx.strokeStyle = borderColor;
      ctx.lineWidth = 1;
      ctx.stroke();

      // Ratio label
      const [num, den] = RATIOS[pad.ratioIndex];
      const label = `${num}/${den}`;
      const fontSize = Math.max(10, Math.min(14, pad.w * 0.38));
      ctx.font = `600 ${fontSize}px 'DM Mono', monospace`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillStyle = isLit ? COLOR.ratioTextLit : COLOR.ratioText;
      ctx.fillText(label, pad.x + pad.w / 2, pad.y + pad.h / 2);
    }

    // ── Row labels ──
    const labelFontSize = Math.max(9, Math.min(12, topBand * 0.5));
    ctx.font = `500 ${labelFontSize}px 'DM Sans', sans-serif`;
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.fillStyle = COLOR.text;
    if (pads.length > 0) {
      const cp = pads[0];
      ctx.fillText("CHORD", 6, cp.y + cp.h / 2);
      const np = pads[18];
      ctx.fillText("NEXT", 6, np.y + np.h / 2);
    }

    // ── Top band: controls ──
    const btnH    = Math.round(topBand * 0.62);
    const btnY    = Math.round((topBand - btnH) / 2);
    const btnR    = 4;
    const margin  = 8;

    // BASE label + value
    ctx.font = `500 ${Math.max(9, Math.min(11, topBand * 0.44))}px 'DM Mono', monospace`;
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.fillStyle = COLOR.text;
    ctx.fillText("BASE", margin, topBand / 2);
    const baseLabel = `${display.base} Hz`;
    ctx.fillStyle = COLOR.textBright;
    ctx.fillText(baseLabel, margin + 38, topBand / 2);

    // MODE label + fraction
    const modeX = margin + 38 + ctx.measureText(baseLabel).width + 24;
    ctx.fillStyle = COLOR.text;
    ctx.fillText("MODE", modeX, topBand / 2);
    ctx.fillStyle = COLOR.textBright;
    ctx.fillText(`${display.modeNum}/${display.modeDen}`, modeX + 42, topBand / 2);

    // Right-side controls: [−] [+] [RESET]
    const resetW  = 52;
    const arrowW  = 28;
    const spacing = 6;
    let rx = W - margin;

    // RESET
    rx -= resetW;
    const resetBtn = { x: rx, y: btnY, w: resetW, h: btnH };
    resetBtnRef.current = resetBtn;
    roundRect(ctx, resetBtn.x, resetBtn.y, resetBtn.w, resetBtn.h, btnR);
    ctx.fillStyle = COLOR.btnBg;
    ctx.fill();
    ctx.strokeStyle = "#2a3a50";
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.font = `600 ${Math.max(9, Math.min(11, topBand * 0.44))}px 'DM Sans', sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = COLOR.btnText;
    ctx.fillText("RESET", resetBtn.x + resetBtn.w / 2, resetBtn.y + resetBtn.h / 2);

    rx -= spacing;

    // BASE + button
    rx -= arrowW;
    const plusBtn = { x: rx, y: btnY, w: arrowW, h: btnH };
    basePlusBtnRef.current = plusBtn;
    roundRect(ctx, plusBtn.x, plusBtn.y, plusBtn.w, plusBtn.h, btnR);
    ctx.fillStyle = COLOR.btnBg;
    ctx.fill();
    ctx.strokeStyle = "#2a3a50";
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.font = `700 ${Math.max(11, Math.min(14, topBand * 0.55))}px 'DM Sans', sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = COLOR.btnText;
    ctx.fillText("+", plusBtn.x + plusBtn.w / 2, plusBtn.y + plusBtn.h / 2);

    rx -= spacing;

    // BASE − button
    rx -= arrowW;
    const minusBtn = { x: rx, y: btnY, w: arrowW, h: btnH };
    baseMinusBtnRef.current = minusBtn;
    roundRect(ctx, minusBtn.x, minusBtn.y, minusBtn.w, minusBtn.h, btnR);
    ctx.fillStyle = COLOR.btnBg;
    ctx.fill();
    ctx.strokeStyle = "#2a3a50";
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.font = `700 ${Math.max(11, Math.min(14, topBand * 0.55))}px 'DM Sans', sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = COLOR.btnText;
    ctx.fillText("−", minusBtn.x + minusBtn.w / 2, minusBtn.y + minusBtn.h / 2);

    rafRef.current = requestAnimationFrame(draw);
  }, [display]);

  // ── Hit test top-band buttons ──
  function hitBtn(
    btn: { x: number; y: number; w: number; h: number } | null,
    px: number, py: number
  ) {
    if (!btn) return false;
    return px >= btn.x && px <= btn.x + btn.w && py >= btn.y && py <= btn.y + btn.h;
  }

  // ── Touch / mouse unified handlers ──
  const handleStart = useCallback((id: number, px: number, py: number) => {
    // Check top-band buttons first
    if (hitBtn(resetBtnRef.current, px, py)) {
      doReset();
      touchMapRef.current.set(id, null);
      return;
    }
    if (hitBtn(basePlusBtnRef.current, px, py)) {
      doBaseChange(+1);
      touchMapRef.current.set(id, null);
      return;
    }
    if (hitBtn(baseMinusBtnRef.current, px, py)) {
      doBaseChange(-1);
      touchMapRef.current.set(id, null);
      return;
    }

    const pad = hitPad(padsRef.current, px, py);
    if (!pad) {
      touchMapRef.current.set(id, null);
      return;
    }

    touchMapRef.current.set(id, pad.index);

    if (pad.row === "chord") {
      // Sound the note
      const [num, den] = RATIOS[pad.ratioIndex];
      const freq = modeRef.current * (num / den);
      const ac = getAC();
      const voice = new Voice(ac, freq);
      chordVoicesRef.current.set(pad.index, voice);
      litChordRef.current.add(pad.index);

    } else {
      // NEXT: multiply MODE
      const [num, den] = RATIOS[pad.ratioIndex];
      modeNumRef.current *= num;
      modeDenRef.current *= den;
      const g = gcd(modeNumRef.current, modeDenRef.current);
      modeNumRef.current /= g;
      modeDenRef.current /= g;
      syncMode();
      pushDisplay();

      // Retune held chord
      retuneChord(30);

      // Flash
      flashRef.current.set(pad.index, performance.now() + 150);

      // Blip at new MODE
      if (nextVoiceRef.current) {
        nextVoiceRef.current.stop(80);
        nextVoiceRef.current = null;
      }
      if (nextBlipTimer.current) clearTimeout(nextBlipTimer.current);
      const ac = getAC();
      const blip = new Voice(ac, modeRef.current);
      nextVoiceRef.current = blip;
      nextBlipTimer.current = setTimeout(() => {
        blip.stop(120);
        nextVoiceRef.current = null;
      }, 250);
    }
  }, [doReset, doBaseChange]);

  const handleEnd = useCallback((id: number) => {
    const padIndex = touchMapRef.current.get(id);
    touchMapRef.current.delete(id);
    if (padIndex == null) return;

    if (padIndex < 18) {
      // CHORD pad
      const voice = chordVoicesRef.current.get(padIndex);
      if (voice) {
        voice.stop(120);
        chordVoicesRef.current.delete(padIndex);
      }
      litChordRef.current.delete(padIndex);
    }
    // NEXT pads: flash self-expires, nothing to release
  }, []);

  // ── Resize ──
  const resize = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.width  = window.innerWidth;
    canvas.height = window.innerHeight;
    padsRef.current = buildPads(canvas.width, canvas.height);
    setPortrait(window.innerHeight > window.innerWidth);
  }, []);

  // ── Mount ──
  useEffect(() => {
    resize();
    window.addEventListener("resize", resize);
    rafRef.current = requestAnimationFrame(draw);

    // Touch
    const onTouchStart = (e: TouchEvent) => {
      e.preventDefault();
      Array.from(e.changedTouches).forEach(t =>
        handleStart(t.identifier, t.clientX, t.clientY)
      );
    };
    const onTouchEnd = (e: TouchEvent) => {
      e.preventDefault();
      Array.from(e.changedTouches).forEach(t => handleEnd(t.identifier));
    };
    const onTouchMove = (e: TouchEvent) => { e.preventDefault(); };

    window.addEventListener("touchstart",  onTouchStart,  { passive: false });
    window.addEventListener("touchmove",   onTouchMove,   { passive: false });
    window.addEventListener("touchend",    onTouchEnd,    { passive: false });
    window.addEventListener("touchcancel", onTouchEnd,    { passive: false });

    // Mouse fallback
    const MOUSE_ID = -1;
    const onMouseDown = (e: MouseEvent) => handleStart(MOUSE_ID, e.clientX, e.clientY);
    const onMouseUp   = (e: MouseEvent) => handleEnd(MOUSE_ID);
    window.addEventListener("mousedown", onMouseDown);
    window.addEventListener("mouseup",   onMouseUp);

    return () => {
      cancelAnimationFrame(rafRef.current);
      window.removeEventListener("resize", resize);
      window.removeEventListener("touchstart",  onTouchStart);
      window.removeEventListener("touchmove",   onTouchMove);
      window.removeEventListener("touchend",    onTouchEnd);
      window.removeEventListener("touchcancel", onTouchEnd);
      window.removeEventListener("mousedown", onMouseDown);
      window.removeEventListener("mouseup",   onMouseUp);
      Array.from(chordVoicesRef.current.values()).forEach(v => v.stop(0));
      if (nextVoiceRef.current) nextVoiceRef.current.stop(0);
    };
  }, [resize, draw, handleStart, handleEnd]);

  // Re-start draw loop when display changes (so text updates)
  useEffect(() => {
    cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(draw);
  }, [draw]);

  return (
    <>
      <canvas
        ref={canvasRef}
        style={{
          display: "block",
          position: "fixed",
          inset: 0,
          touchAction: "none",
          cursor: "default",
        }}
      />
      {portrait && (
        <div style={{
          position: "fixed",
          inset: 0,
          background: "rgba(10,12,16,0.92)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: "#8ab4cc",
          fontFamily: "'DM Sans', sans-serif",
          fontSize: 16,
          letterSpacing: "0.05em",
          pointerEvents: "none",
          zIndex: 10,
        }}>
          Rotate device to landscape to play
        </div>
      )}
    </>
  );
}
