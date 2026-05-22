/**
 * Relative Notation Organ by Martin Kolář
 *
 * A just-intonation polyphonic instrument.
 * - CHORD row (top half): hold pads to sustain notes at MODE × ratio
 * - NEXT row (bottom half): tap to multiply MODE by that pad’s ratio; transposes held chord
 * - Top band: BASE / MODE display, RESET, BASE ±1 Hz controls, About link
 *
 * Audio: Web Audio API — harmonic-only partials, dynamic partial reduction by chord size.
 * State: all real-time data in useRef; only display fraction in useState.
 */

import { useEffect, useRef, useCallback, useState } from "react";
import { useLocation } from "wouter";

// ─── Ratios ───────────────────────────────────────────────────────────────────
// 19 entries: perfectly symmetric around centre (index 9 = 1/1).
// Left side (index 0–8) reads outward: each entry is the reciprocal of its
// mirror on the right (index 18–10). Pairs from centre outward:
//   6/7 ↔ 7/6 | 5/6 ↔ 6/5 | 4/5 ↔ 5/4 | 3/4 ↔ 4/3 | 2/3 ↔ 3/2
//   1/2 ↔ 2/1 | 1/3 ↔ 3/1 | 2/5 ↔ 5/2 | 1/4 ↔ 4/1
const RATIOS: [number, number][] = [
  // ← down (index 0–8), outermost first
  [1,5],[1,4],[1,3],[2,5],[1,2],[3,5],[2,3],[3,4],[4,5],
  // centre (index 9)
  [1,1],
  // up → (index 10–18), innermost first
  [5,4],[4,3],[3,2],[5,3],[2,1],[5,2],[3,1],[4,1],[5,1],
];

// ─── GCD ─────────────────────────────────────────────────────────────────────
function gcd(a: number, b: number): number {
  a = Math.abs(Math.round(a));
  b = Math.abs(Math.round(b));
  while (b) { const t = b; b = a % b; a = t; }
  return a;
}

// ─── Voice ────────────────────────────────────────────────────────────────────
// Partial stacks indexed by count (1 = pure sine, 2 = ×1+×2, 3 = ×1+×2+×3, 4 = full)
const PARTIAL_STACKS: { ratios: number[]; gains: number[] }[] = [
  { ratios: [1],       gains: [1] },                         // 1 partial
  { ratios: [1, 2],    gains: [1, 0.40] },                   // 2 partials
  { ratios: [1, 2, 3], gains: [1, 0.35, 0.15] },             // 3 partials
  { ratios: [1, 2, 3, 4], gains: [1, 0.35, 0.15, 0.07] },   // 4 partials
];

// How many partials to use given the current chord size
function partialsForChordSize(n: number): number {
  if (n >= 4) return 1; // pure sine — no partials to collide
  if (n === 3) return 2; // ×1 + ×2 only
  return 4;             // 1 or 2 notes: full stack
}

class Voice {
  masterGain: GainNode;
  filter: BiquadFilterNode;
  oscs: Array<{ osc: OscillatorNode; g: GainNode }> = [];

  constructor(private ctx: AudioContext, freq: number, partialCount = 4) {
    this.masterGain = ctx.createGain();
    this.masterGain.gain.setValueAtTime(0.0001, ctx.currentTime);

    this.filter = ctx.createBiquadFilter();
    this.filter.type = "lowpass";
    this.filter.frequency.value = 5000;
    this.filter.Q.value = 0.8;
    this.filter.connect(this.masterGain);
    this.masterGain.connect(ctx.destination);

    const stack = PARTIAL_STACKS[Math.min(partialCount, 4) - 1];
    for (let i = 0; i < stack.ratios.length; i++) {
      const osc = ctx.createOscillator();
      osc.type = "sine";
      osc.frequency.setValueAtTime(freq * stack.ratios[i], ctx.currentTime);
      const g = ctx.createGain();
      g.gain.value = stack.gains[i];
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
    // baseRatios matches however many oscs were created
    const baseRatios = [1, 2, 3, 4];
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

const N_PADS = 19; // total pads per row
const CENTER_IDX = 9; // index of 1/1

// Staff occupies 1/3 of the playable area (below the top band).
// The two pad rows share the remaining 2/3.
function staffHeight(H: number): number {
  const topBand = Math.round(H * 0.08);
  return Math.round((H - topBand) / 3);
}

function buildPads(W: number, H: number): Pad[] {
  const topBand = Math.round(H * 0.08);
  const staffH  = staffHeight(H);
  const rowH    = Math.round((H - topBand - staffH) / 2);
  const padW    = W / N_PADS;
  const pads: Pad[] = [];
  const gap = 2;

  const chordY = topBand + staffH;
  const nextY  = chordY + rowH;

  for (let i = 0; i < N_PADS; i++) {
    pads.push({
      index: i,
      row: "chord",
      ratioIndex: i,
      x: i * padW + gap / 2,
      y: chordY + gap / 2,
      w: padW - gap,
      h: rowH - gap,
    });
  }
  for (let i = 0; i < N_PADS; i++) {
    pads.push({
      index: i + N_PADS,
      row: "next",
      ratioIndex: i,
      x: i * padW + gap / 2,
      y: nextY + gap / 2,
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

// ─── Ratio height → pad brightness [0..1] ───────────────────────────────────
// Height = max(num, den) after GCD reduction. Drives background brightness.
// Tier map (per spec):
//   height 1 → 1.00  (1/1 — brightest, home)
//   height 2 → 0.75  (1/2, 2/1 — octaves)
//   height 3 → 0.52  (1/3, 2/3, 3/2, 3/1 — fifths/fourths)
//   height 4 → 0.34  (1/4, 3/4, 4/3, 4/1)
//   height 5 → 0.18  (all prime-5 ratios — darkest)
function ratioBrightness(num: number, den: number): number {
  const g = gcd(num, den);
  const h = Math.max(num / g, den / g);
  if (h <= 1) return 1.00;
  if (h <= 2) return 0.75;
  if (h <= 3) return 0.52;
  if (h <= 4) return 0.34;
  return 0.18;
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
  bg:           "#0d0f14",
  // CHORD row
  chordBase:    "#1a2a3a",
  chordLit:     "#2a7fff",
  chordBorder:  "#1e3a5a",
  // CHORD centre (1/1)
  chordCenter:  "#1a2040",
  chordCenterBorder: "#3a4a7a",
  // NEXT row
  nextBase:     "#1a2e1a",
  nextLit:      "#22cc55",
  nextBorder:   "#1e4a1e",
  // NEXT centre (1/1)
  nextCenter:   "#1a2e20",
  nextCenterBorder: "#3a6a3a",
  text:         "#8ab4cc",
  textBright:   "#d0e8f8",
  ratioText:    "#c8dce8",
  ratioTextLit: "#ffffff",
  ratioTextCenter: "#aaccff",
  topBg:        "#0a0c10",
  btnBg:        "#1e2a38",
  btnHover:     "#2a3a50",
  btnText:      "#9ab8cc",
};

// ─── Staff / timeline ───────────────────────────────────────────────────────
// A note event records when a CHORD pad was pressed and released.
// endTime = -1 means the note is still held.
interface NoteEvent {
  ratioIndex: number;  // 0..18
  startTime:  number;  // performance.now() ms
  endTime:    number;  // ms, or -1 while held
}

// A NEXT event records a MODE-change tap: a vertical green line from 1/1 to the tapped ratio.
interface NextEvent {
  ratioIndex: number;  // 0..18 — the tapped NEXT pad
  time:       number;  // performance.now() ms
}

// ─── Recording / Playback ─────────────────────────────────────────────────────
// A recorded event is either a CHORD note (with start+end relative ms) or a NEXT tap.
type RecordedEvent =
  | { kind: "chord"; ratioIndex: number; startMs: number; endMs: number }
  | { kind: "next";  ratioIndex: number; timeMs:  number };

function eventsToCSV(events: RecordedEvent[]): string {
  const lines = ["type,ratioIndex,ratio,startMs,endMs"];
  for (const ev of events) {
    const [num, den] = RATIOS[ev.ratioIndex];
    if (ev.kind === "chord") {
      lines.push(`chord,${ev.ratioIndex},${num}/${den},${ev.startMs.toFixed(1)},${ev.endMs.toFixed(1)}`);
    } else {
      lines.push(`next,${ev.ratioIndex},${num}/${den},${ev.timeMs.toFixed(1)},`);
    }
  }
  return lines.join("\n");
}

function csvToEvents(csv: string): RecordedEvent[] {
  const events: RecordedEvent[] = [];
  for (const line of csv.split("\n").slice(1)) {
    const parts = line.trim().split(",");
    if (parts.length < 4) continue;
    const [kind, riStr, , startStr, endStr] = parts;
    const ri = parseInt(riStr, 10);
    if (isNaN(ri) || ri < 0 || ri >= RATIOS.length) continue;
    if (kind === "chord") {
      events.push({ kind: "chord", ratioIndex: ri, startMs: parseFloat(startStr), endMs: parseFloat(endStr) });
    } else if (kind === "next") {
      events.push({ kind: "next", ratioIndex: ri, timeMs: parseFloat(startStr) });
    }
  }
  return events;
}

function downloadCSV(csv: string) {
  const blob = new Blob([csv], { type: "text/csv" });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement("a");
  a.href     = url;
  a.download = `rno-recording-${Date.now()}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

// Pixels per millisecond — staff scroll speed.
// 100 px/s = 0.1 px/ms. One beat line per second = 100 px apart.
const SCROLL_PX_PER_MS = 0.1;

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
  const baseRef       = useRef<number>(432);
  const modeNumRef    = useRef<number>(1);
  const modeDenRef    = useRef<number>(1);

  // Voices keyed by TOUCH ID (not pad index) — prevents drone when two fingers share a pad
  const chordVoicesRef = useRef<Map<number, { voice: Voice; padIndex: number }>>(new Map());

  // Touch tracking: touch identifier → pad index (or null if off-pad)
  const touchMapRef = useRef<Map<number, number | null>>(new Map());

  // Pad flash state: padIndex → flash-until timestamp
  const flashRef = useRef<Map<number, number>>(new Map());

  // Lit CHORD pads: reference-counted by how many touch IDs are on each pad
  const padRefCountRef = useRef<Map<number, number>>(new Map());
  // Derived set for draw loop (padIndex → lit when refCount > 0)
  const litChordRef = useRef<Set<number>>(new Set());

  // Geometry
  const padsRef = useRef<Pad[]>([]);

  // UI control hit areas (built each draw)
  const resetBtnRef    = useRef<{ x: number; y: number; w: number; h: number } | null>(null);
  const basePlusBtnRef  = useRef<{ x: number; y: number; w: number; h: number } | null>(null);
  const baseMinusBtnRef = useRef<{ x: number; y: number; w: number; h: number } | null>(null);
  const aboutBtnRef      = useRef<{ x: number; y: number; w: number; h: number } | null>(null);
  const recordBtnRef     = useRef<{ x: number; y: number; w: number; h: number } | null>(null);
  const playFileBtnRef   = useRef<{ x: number; y: number; w: number; h: number } | null>(null);
  const playBtnRef       = useRef<{ x: number; y: number; w: number; h: number } | null>(null);

  // Display state (React — drives text re-render)
  const [display, setDisplay] = useState<DisplayState>({ base: 432, modeNum: 1, modeDen: 1 });

  // Portrait warning
  const [portrait, setPortrait] = useState(false);

  // Navigation
  const [, setLocation] = useLocation();

  // Staff / timeline: all note events (completed + active)
  const staffNotesRef = useRef<NoteEvent[]>([]);
  // Staff / timeline: NEXT tap events (vertical green lines)
  const staffNextRef  = useRef<NextEvent[]>([]);

  // ── Recording ──
  const isRecordingRef    = useRef(false);          // true while recording
  const recordStartRef    = useRef(0);              // performance.now() at record-start
  const recordedEventsRef = useRef<RecordedEvent[]>([]);
  // Open chord events during recording: touchId → { ratioIndex, startMs }
  const recOpenRef = useRef<Map<number, { ratioIndex: number; startMs: number }>>(new Map());

  // ── Playback ──
  const loadedEventsRef  = useRef<RecordedEvent[]>([]);  // parsed from file
  const isPlayingRef     = useRef(false);
  const playTimersRef    = useRef<ReturnType<typeof setTimeout>[]>([]);
  // Playback voices keyed by a synthetic ID (negative, to avoid clashing with real touch IDs)
  const playVoicesRef    = useRef<Map<number, { voice: Voice; ratioIndex: number }>>(new Map());
  let   playVoiceCounter = 0; // local counter, reset on each playback start

  // React state for button rendering
  const [isRecording, setIsRecording] = useState(false);
  const [isPlaying,   setIsPlaying]   = useState(false);
  const [hasFile,     setHasFile]     = useState(false);

  // DOM overlay positions for LOAD and PLAY buttons (updated each draw frame via state)
  const [loadBtnRect, setLoadBtnRect] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const [playBtnRect, setPlayBtnRect] = useState<{ x: number; y: number; w: number; h: number } | null>(null);

  // Hidden file input ref
  const fileInputRef = useRef<HTMLInputElement>(null);

  // RAF
  const rafRef = useRef<number>(0);

  // ── Audio context ──
  // Always resume — covers both the "suspended on creation" and "suspended after inactivity" cases.
  function getAC(): AudioContext {
    if (!audioCtxRef.current) {
      audioCtxRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
    }
    const ac = audioCtxRef.current;
    if (ac.state !== "running") ac.resume();
    return ac;
  }

  // ── Exact frequency from integers: base × (modeNum/modeDen) × (padNum/padDen) ──
  function exactFreq(padNum: number, padDen: number): number {
    return baseRef.current * modeNumRef.current * padNum
         / (modeDenRef.current * padDen);
  }

  // ── Retune all held CHORD voices from integers ──
  function retuneChord(rampMs = 30) {
    for (const { voice, padIndex } of Array.from(chordVoicesRef.current.values())) {
      const [pNum, pDen] = RATIOS[padIndex];
      voice.retune(exactFreq(pNum, pDen), rampMs);
    }
  }

  // ── Helpers: ref-count a pad in/out ──
  function padRefAdd(padIndex: number) {
    const c = (padRefCountRef.current.get(padIndex) ?? 0) + 1;
    padRefCountRef.current.set(padIndex, c);
    litChordRef.current.add(padIndex);
  }
  function padRefRemove(padIndex: number) {
    const c = (padRefCountRef.current.get(padIndex) ?? 1) - 1;
    if (c <= 0) {
      padRefCountRef.current.delete(padIndex);
      litChordRef.current.delete(padIndex);
    } else {
      padRefCountRef.current.set(padIndex, c);
    }
  }

  // ── Rebuild all chord voices with the correct partial count for current size ──
  // Unique pad count drives partial selection; each touch ID still owns its own Voice.
  function rebuildChord() {
    const ac = getAC();
    // Unique pads = unique padIndex values across all active touch entries
    const uniquePads = new Set(Array.from(chordVoicesRef.current.values()).map(e => e.padIndex));
    const pc = partialsForChordSize(uniquePads.size);
    for (const [touchId, entry] of Array.from(chordVoicesRef.current)) {
      const [pNum, pDen] = RATIOS[entry.padIndex];
      const freq = exactFreq(pNum, pDen);
      entry.voice.stop(40);
      const newVoice = new Voice(ac, freq, pc);
      chordVoicesRef.current.set(touchId, { voice: newVoice, padIndex: entry.padIndex });
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
    retuneChord(30);
    pushDisplay();
  }, []);

  // ── BASE ±1 ──
  const doBaseChange = useCallback((delta: number) => {
    baseRef.current = Math.max(20, baseRef.current + delta);
    retuneChord(30);
    pushDisplay();
  }, []);

  // ── Toggle RECORD ──
  const doToggleRecord = useCallback(() => {
    if (!isRecordingRef.current) {
      // Start recording
      isRecordingRef.current = true;
      recordStartRef.current = performance.now();
      recordedEventsRef.current = [];
      recOpenRef.current.clear();
      setIsRecording(true);
    } else {
      // Stop recording — close any still-open chord events
      const now = performance.now();
      for (const [, open] of Array.from(recOpenRef.current)) {
        recordedEventsRef.current.push({
          kind: "chord",
          ratioIndex: open.ratioIndex,
          startMs: open.startMs,
          endMs: now - recordStartRef.current,
        });
      }
      recOpenRef.current.clear();
      isRecordingRef.current = false;
      setIsRecording(false);
      // Export CSV
      if (recordedEventsRef.current.length > 0) {
        downloadCSV(eventsToCSV(recordedEventsRef.current));
      }
    }
  }, []);

  // ── Stop playback ──
  const doStopPlayback = useCallback(() => {
    isPlayingRef.current = false;
    setIsPlaying(false);
    // Cancel all pending timers
    for (const t of playTimersRef.current) clearTimeout(t);
    playTimersRef.current = [];
    // Stop all playback voices
    for (const { voice } of Array.from(playVoicesRef.current.values())) voice.stop(80);
    playVoicesRef.current.clear();
  }, []);

  // ── Start playback ──
  const doStartPlayback = useCallback(() => {
    const events = loadedEventsRef.current;
    if (events.length === 0) return;
    doStopPlayback();
    isPlayingRef.current = true;
    setIsPlaying(true);
    let counter = 0;

    for (const ev of events) {
      if (ev.kind === "chord") {
        const voiceId = -(++counter);
        // Note-on
        const tOn = playTimersRef.current.length;
        playTimersRef.current.push(setTimeout(() => {
          if (!isPlayingRef.current) return;
          const ac = getAC();
          const [pNum, pDen] = RATIOS[ev.ratioIndex];
          const freq = baseRef.current * modeNumRef.current * pNum / (modeDenRef.current * pDen);
          const voice = new Voice(ac, freq, 4);
          playVoicesRef.current.set(voiceId, { voice, ratioIndex: ev.ratioIndex });
          // Staff: open note
          staffNotesRef.current.push({ ratioIndex: ev.ratioIndex, startTime: performance.now(), endTime: -1 });
        }, ev.startMs));
        // Note-off
        playTimersRef.current.push(setTimeout(() => {
          if (!isPlayingRef.current) return;
          const entry = playVoicesRef.current.get(voiceId);
          if (entry) {
            entry.voice.stop(120);
            playVoicesRef.current.delete(voiceId);
          }
          // Staff: close note
          const notes = staffNotesRef.current;
          for (let i = notes.length - 1; i >= 0; i--) {
            if (notes[i].ratioIndex === ev.ratioIndex && notes[i].endTime === -1) {
              notes[i].endTime = performance.now();
              break;
            }
          }
        }, ev.endMs));
      } else {
        // NEXT event
        playTimersRef.current.push(setTimeout(() => {
          if (!isPlayingRef.current) return;
          const [num, den] = RATIOS[ev.ratioIndex];
          modeNumRef.current *= num;
          modeDenRef.current *= den;
          const g = gcd(modeNumRef.current, modeDenRef.current);
          modeNumRef.current /= g;
          modeDenRef.current /= g;
          pushDisplay();
          retuneChord(30);
          // Retune any playing playback voices too
          for (const { voice, ratioIndex } of Array.from(playVoicesRef.current.values())) {
            const [pNum, pDen] = RATIOS[ratioIndex];
            voice.retune(baseRef.current * modeNumRef.current * pNum / (modeDenRef.current * pDen), 30);
          }
          staffNextRef.current.push({ ratioIndex: ev.ratioIndex, time: performance.now() });
        }, ev.timeMs));
      }
    }

    // Auto-stop when last event has passed
    const lastTime = events.reduce((m, e) =>
      Math.max(m, e.kind === "chord" ? e.endMs : e.timeMs), 0);
    playTimersRef.current.push(setTimeout(() => {
      doStopPlayback();
    }, lastTime + 500));
  }, [doStopPlayback]);

  // ── Load file ──
  const doLoadFile = useCallback((file: File) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const text = e.target?.result as string;
      const events = csvToEvents(text);
      loadedEventsRef.current = events;
      setHasFile(events.length > 0);
    };
    reader.readAsText(file);
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

    // ── Draw scrolling staff ──
    {
      const staffH  = staffHeight(H);
      const staffY  = topBand;
      const laneH   = staffH / N_PADS;
      // Playhead is fixed at 80% from the left
      const playheadX = W * 0.80;
      // Scroll: how many px have elapsed since t=0 at this moment
      const scrollPx = now * SCROLL_PX_PER_MS;

      // Staff background
      ctx.fillStyle = "#0a0d12";
      ctx.fillRect(0, staffY, W, staffH);

      // Prune notes that have scrolled fully off the left edge
      // A note's right edge is at playheadX - (now - endTime) * SCROLL_PX_PER_MS
      // It's off-screen when that is < 0, i.e. endTime < now - playheadX / SCROLL_PX_PER_MS
      const offScreenMs = playheadX / SCROLL_PX_PER_MS;
      staffNotesRef.current = staffNotesRef.current.filter(n =>
        n.endTime === -1 || (now - n.endTime) * SCROLL_PX_PER_MS < playheadX
      );

      // Draw note bars
      for (const note of staffNotesRef.current) {
        const [num, den] = RATIOS[note.ratioIndex];
        const b = ratioBrightness(num, den);
        const isActive = note.endTime === -1;

        // X positions: time → pixels
        // The playhead represents "now". A moment T ms in the past is (now-T)*SCROLL_PX_PER_MS px to the left.
        const barRight = isActive
          ? playheadX
          : playheadX - (now - note.endTime) * SCROLL_PX_PER_MS;
        const barLeft  = playheadX - (now - note.startTime) * SCROLL_PX_PER_MS;
        const barW = Math.max(2, barRight - barLeft);
        if (barRight < 0) continue; // off screen

        // Lane Y: ratioIndex 0 = top lane, 18 = bottom lane
        const laneY = staffY + note.ratioIndex * laneH;
        const barH  = Math.max(2, laneH - 2);
        const barY  = laneY + (laneH - barH) / 2;

        // Colour: same brightness tiers as pad, blue family
        const alpha = isActive ? 0.85 : 0.55;
        const r  = Math.round(30  + b * (60  - 30));
        const g  = Math.round(90  + b * (160 - 90));
        const bv = Math.round(160 + b * (255 - 160));
        ctx.fillStyle = `rgba(${r},${g},${bv},${alpha})`;
        ctx.beginPath();
        ctx.roundRect(barLeft, barY, barW, barH, 3);
        ctx.fill();

        // Active glow
        if (isActive) {
          ctx.shadowColor = `rgba(${r},${g},${bv},0.6)`;
          ctx.shadowBlur  = 8;
          ctx.fill();
          ctx.shadowBlur  = 0;
        }
      }

      // Prune NEXT events that have scrolled off the left edge
      staffNextRef.current = staffNextRef.current.filter(n =>
        (now - n.time) * SCROLL_PX_PER_MS < playheadX
      );

      // Draw NEXT vertical lines (green, from 1/1 lane to tapped ratio lane)
      for (const ev of staffNextRef.current) {
        const lineX = playheadX - (now - ev.time) * SCROLL_PX_PER_MS;
        if (lineX < 0 || lineX > W) continue;

        const centerLaneY = staffY + CENTER_IDX * laneH + laneH / 2;
        const targetLaneY = staffY + ev.ratioIndex * laneH + laneH / 2;

        const topY    = Math.min(centerLaneY, targetLaneY);
        const bottomY = Math.max(centerLaneY, targetLaneY);
        const lineLen = bottomY - topY;

        // Fade as it scrolls left
        const age = (now - ev.time) * SCROLL_PX_PER_MS / playheadX; // 0..1
        const alpha = Math.max(0, 1 - age);

        // Vertical line
        ctx.strokeStyle = `rgba(60,220,120,${alpha * 0.85})`;
        ctx.lineWidth = 2.5;
        ctx.lineCap = "round";
        ctx.beginPath();
        ctx.moveTo(lineX, topY);
        ctx.lineTo(lineX, bottomY);
        ctx.stroke();

        // Dot at the tapped ratio end
        const dotR = Math.max(3, laneH * 0.35);
        ctx.fillStyle = `rgba(60,220,120,${alpha * 0.9})`;
        ctx.shadowColor = `rgba(60,220,120,${alpha * 0.5})`;
        ctx.shadowBlur  = 6;
        ctx.beginPath();
        ctx.arc(lineX, targetLaneY, dotR, 0, Math.PI * 2);
        ctx.fill();
        ctx.shadowBlur = 0;

        // Small dot at 1/1 end
        ctx.fillStyle = `rgba(60,220,120,${alpha * 0.6})`;
        ctx.beginPath();
        ctx.arc(lineX, centerLaneY, dotR * 0.6, 0, Math.PI * 2);
        ctx.fill();
      }

      // Lane divider lines
      ctx.strokeStyle = "rgba(255,255,255,0.05)";
      ctx.lineWidth = 1;
      for (let i = 0; i <= N_PADS; i++) {
        const ly = staffY + i * laneH;
        ctx.beginPath();
        ctx.moveTo(0, ly);
        ctx.lineTo(W, ly);
        ctx.stroke();
      }

      // Beat lines (one per second) — scrolling
      const beatIntervalPx = SCROLL_PX_PER_MS * 1000; // 100 px
      // First beat line to the right of x=0
      const firstBeatOffset = beatIntervalPx - (scrollPx % beatIntervalPx);
      ctx.strokeStyle = "rgba(255,255,255,0.12)";
      ctx.lineWidth = 1;
      for (let bx = firstBeatOffset; bx < W; bx += beatIntervalPx) {
        ctx.beginPath();
        ctx.moveTo(bx, staffY);
        ctx.lineTo(bx, staffY + staffH);
        ctx.stroke();
      }

      // Playhead line
      ctx.strokeStyle = "rgba(120,180,255,0.5)";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(playheadX, staffY);
      ctx.lineTo(playheadX, staffY + staffH);
      ctx.stroke();

      // Ratio labels on the left edge of each lane
      ctx.textAlign = "left";
      ctx.textBaseline = "middle";
      for (let i = 0; i < N_PADS; i++) {
        const [num, den] = RATIOS[i];
        const b = ratioBrightness(num, den);
        const lt = 0.30 + b * 0.45;
        ctx.fillStyle = `rgba(${Math.round(lt*200)},${Math.round(lt*220)},${Math.round(lt*232)},0.7)`;
        const fontSize = Math.max(7, Math.min(10, laneH * 0.65));
        ctx.font = `500 ${fontSize}px 'DM Mono', monospace`;
        ctx.fillText(`${num}/${den}`, 4, staffY + i * laneH + laneH / 2);
      }

      // Staff bottom border
      ctx.strokeStyle = "rgba(255,255,255,0.08)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(0, staffY + staffH);
      ctx.lineTo(W, staffY + staffH);
      ctx.stroke();
    }

    // ── Draw pads ──
    const pads = padsRef.current;
    for (const pad of pads) {
      const isChord  = pad.row === "chord";
      const isCenter = pad.ratioIndex === CENTER_IDX;
      const isLit    = isChord
        ? litChordRef.current.has(pad.index)
        : (flashRef.current.get(pad.index) ?? 0) > now;

      // Brightness drives the pad background fill
      const [num, den] = RATIOS[pad.ratioIndex];
      const b = ratioBrightness(num, den); // 0..1

      let baseColor: string;
      let borderColor: string;
      if (isLit) {
        // Lit: use row accent colour (unchanged)
        baseColor   = isChord ? COLOR.chordLit : COLOR.nextLit;
        borderColor = baseColor;
      } else if (isChord) {
        // CHORD unlit: interpolate from darkest (#0d1520) to brightest (#2a5080)
        const r  = Math.round(13  + b * (42  - 13));
        const g  = Math.round(21  + b * (80  - 21));
        const bv = Math.round(32  + b * (128 - 32));
        baseColor   = `rgb(${r},${g},${bv})`;
        // Border slightly brighter than fill
        const rb = Math.round(20  + b * (60  - 20));
        const gb = Math.round(40  + b * (120 - 40));
        const bb = Math.round(60  + b * (160 - 60));
        borderColor = `rgb(${rb},${gb},${bb})`;
      } else {
        // NEXT unlit: interpolate from darkest (#0d1a0d) to brightest (#1e4a1e)
        const r  = Math.round(13  + b * (30  - 13));
        const g  = Math.round(26  + b * (74  - 26));
        const bv = Math.round(13  + b * (30  - 13));
        baseColor   = `rgb(${r},${g},${bv})`;
        const rb = Math.round(20  + b * (50  - 20));
        const gb = Math.round(40  + b * (100 - 40));
        const bb = Math.round(20  + b * (50  - 20));
        borderColor = `rgb(${rb},${gb},${bb})`;
      }

      roundRect(ctx, pad.x, pad.y, pad.w, pad.h, 5);
      ctx.fillStyle = baseColor;
      ctx.fill();
      ctx.strokeStyle = borderColor;
      ctx.lineWidth = isCenter && !isLit ? 1.5 : 1;
      ctx.stroke();

      // Ratio label — always light enough to read; slightly brighter for simpler ratios
      const label = `${num}/${den}`;
      const fontSize = Math.max(9, Math.min(13, pad.w * 0.36));
      ctx.font = `600 ${fontSize}px 'DM Mono', monospace`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      if (isLit) {
        ctx.fillStyle = COLOR.ratioTextLit;
      } else {
        // Label brightness: dim floor 0.45, bright ceiling 1.0
        const lt = 0.45 + b * 0.55;
        const lr = Math.round(lt * 200);
        const lg = Math.round(lt * 220);
        const lb = Math.round(lt * 232);
        ctx.fillStyle = `rgb(${lr},${lg},${lb})`;
      }
      ctx.fillText(label, pad.x + pad.w / 2, pad.y + pad.h / 2);
    }

    // ── Direction markers below CHORD row, above NEXT row ──
    if (pads.length > 0) {
      const cp0  = pads[0];
      const cpC  = pads[CENTER_IDX];
      const midY = cpC.y + cpC.h + 1;
      const markerH = pads[N_PADS].y - midY - 1; // gap between rows
      if (markerH > 0) {
        // left arrow area
        ctx.fillStyle = "rgba(80,140,220,0.18)";
        ctx.fillRect(cp0.x, midY, cpC.x - cp0.x, markerH);
        // right arrow area
        const cpLast = pads[N_PADS - 1];
        ctx.fillStyle = "rgba(80,200,120,0.18)";
        ctx.fillRect(cpC.x + cpC.w, midY, (cpLast.x + cpLast.w) - (cpC.x + cpC.w), markerH);
      }
    }

    // ── Row labels — drawn vertically centred in each row, right-aligned after the last pad ──
    if (pads.length > 0) {
      const labelFontSize = Math.max(8, Math.min(11, topBand * 0.45));
      ctx.font = `500 ${labelFontSize}px 'DM Sans', sans-serif`;
      ctx.textAlign = "right";
      ctx.textBaseline = "middle";
      ctx.fillStyle = "rgba(138,180,204,0.45)";
      const lastChord = pads[N_PADS - 1];
      const lastNext  = pads[2 * N_PADS - 1];
      ctx.fillText("CHORD", W - 4, lastChord.y + lastChord.h / 2);
      ctx.fillText("NEXT",  W - 4, lastNext.y  + lastNext.h  / 2);
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

    // Instrument name — centred in the remaining space
    const titleFontSize = Math.max(9, Math.min(11, topBand * 0.40));
    ctx.font = `500 ${titleFontSize}px 'DM Sans', sans-serif`;
    ctx.textAlign = "center";
    ctx.fillStyle = "rgba(120,160,200,0.5)";
    ctx.fillText("Relative Notation Organ by Martin Kol\u00e1\u0159", W / 2, topBand / 2);

    // Right-side controls: [▶/■] [LOAD] [● REC] [?] [−] [+] [RESET]
    const resetW  = 52;
    const arrowW  = 28;
    const aboutW  = 28;
    const recW    = 52;
    const loadW   = 52;
    const playW   = 36;
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

    // ABOUT ? button
    rx -= aboutW;
    const aboutBtn = { x: rx, y: btnY, w: aboutW, h: btnH };
    aboutBtnRef.current = aboutBtn;
    roundRect(ctx, aboutBtn.x, aboutBtn.y, aboutBtn.w, aboutBtn.h, btnR);
    ctx.fillStyle = COLOR.btnBg;
    ctx.fill();
    ctx.strokeStyle = "#2a3a50";
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.font = `700 ${Math.max(11, Math.min(14, topBand * 0.55))}px 'DM Sans', sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = COLOR.btnText;
    ctx.fillText("?", aboutBtn.x + aboutBtn.w / 2, aboutBtn.y + aboutBtn.h / 2);

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

    rx -= spacing;

    // RECORD button
    rx -= recW;
    const recordBtn = { x: rx, y: btnY, w: recW, h: btnH };
    recordBtnRef.current = recordBtn;
    roundRect(ctx, recordBtn.x, recordBtn.y, recordBtn.w, recordBtn.h, btnR);
    ctx.fillStyle = isRecording ? "rgba(200,40,40,0.85)" : COLOR.btnBg;
    ctx.fill();
    ctx.strokeStyle = isRecording ? "#ff6060" : "#2a3a50";
    ctx.lineWidth = 1;
    ctx.stroke();
    const dotR2 = Math.max(3, btnH * 0.22);
    ctx.fillStyle = isRecording ? "#fff" : "#e05050";
    ctx.beginPath();
    ctx.arc(recordBtn.x + 10, recordBtn.y + btnH / 2, dotR2, 0, Math.PI * 2);
    ctx.fill();
    ctx.font = `600 ${Math.max(9, Math.min(10, topBand * 0.40))}px 'DM Sans', sans-serif`;
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.fillStyle = isRecording ? "#fff" : COLOR.btnText;
    ctx.fillText(isRecording ? "STOP" : "REC", recordBtn.x + 18, recordBtn.y + btnH / 2);

    rx -= spacing;

    // LOAD FILE button (canvas-drawn; real DOM button overlay handles the click)
    rx -= loadW;
    const playFileBtn = { x: rx, y: btnY, w: loadW, h: btnH };
    playFileBtnRef.current = playFileBtn;
    roundRect(ctx, playFileBtn.x, playFileBtn.y, playFileBtn.w, playFileBtn.h, btnR);
    ctx.fillStyle = COLOR.btnBg;
    ctx.fill();
    ctx.strokeStyle = hasFile ? "#40b080" : "#2a3a50";
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.font = `600 ${Math.max(9, Math.min(10, topBand * 0.40))}px 'DM Sans', sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = hasFile ? "#40d090" : COLOR.btnText;
    ctx.fillText("LOAD", playFileBtn.x + playFileBtn.w / 2, playFileBtn.y + playFileBtn.h / 2);
    // Sync DOM overlay position (only update state when position actually changes)
    setLoadBtnRect(prev =>
      prev && prev.x === playFileBtn.x && prev.y === playFileBtn.y ? prev
      : { x: playFileBtn.x, y: playFileBtn.y, w: playFileBtn.w, h: playFileBtn.h }
    );

    rx -= spacing;

    // PLAY / STOP button
    rx -= playW;
    const playBtn = { x: rx, y: btnY, w: playW, h: btnH };
    playBtnRef.current = playBtn;
    const playEnabled = hasFile || isPlaying;
    roundRect(ctx, playBtn.x, playBtn.y, playBtn.w, playBtn.h, btnR);
    ctx.fillStyle = isPlaying ? "rgba(40,160,80,0.85)" : (playEnabled ? "rgba(30,120,60,0.6)" : COLOR.btnBg);
    ctx.fill();
    ctx.strokeStyle = isPlaying ? "#60ff90" : (playEnabled ? "#40b070" : "#2a3a50");
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.fillStyle = playEnabled ? "#90ffb0" : "rgba(120,160,140,0.4)";
    ctx.font = `700 ${Math.max(11, Math.min(14, topBand * 0.55))}px 'DM Sans', sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(isPlaying ? "■" : "▶", playBtn.x + playBtn.w / 2, playBtn.y + playBtn.h / 2);
    setPlayBtnRect(prev =>
      prev && prev.x === playBtn.x && prev.y === playBtn.y ? prev
      : { x: playBtn.x, y: playBtn.y, w: playBtn.w, h: playBtn.h }
    );

    rafRef.current = requestAnimationFrame(draw);
  }, [display, isRecording, isPlaying, hasFile]);

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
    if (hitBtn(aboutBtnRef.current, px, py)) {
      setLocation("/about");
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
    if (hitBtn(recordBtnRef.current, px, py)) {
      doToggleRecord();
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
      // Each touch ID owns its own Voice — no collision when two fingers share a pad
      const [pNum, pDen] = RATIOS[pad.ratioIndex];
      const ac = getAC();
      // Insert placeholder keyed by touch ID so rebuildChord sees the correct size
      chordVoicesRef.current.set(id, { voice: new Voice(ac, exactFreq(pNum, pDen), 1), padIndex: pad.index });
      padRefAdd(pad.index);
      rebuildChord();
      // Record note-on for the staff
      staffNotesRef.current.push({ ratioIndex: pad.ratioIndex, startTime: performance.now(), endTime: -1 });
      // Recording: open a chord event keyed by touch ID
      if (isRecordingRef.current) {
        recOpenRef.current.set(id, {
          ratioIndex: pad.ratioIndex,
          startMs: performance.now() - recordStartRef.current,
        });
      }

    } else {
      // NEXT: multiply MODE
      const [num, den] = RATIOS[pad.ratioIndex];
      modeNumRef.current *= num;
      modeDenRef.current *= den;
      const g = gcd(modeNumRef.current, modeDenRef.current);
      modeNumRef.current /= g;
      modeDenRef.current /= g;
      pushDisplay();

      // Retune held chord — all frequencies recomputed from integers
      retuneChord(30);

      // Flash only — NEXT row is silent
      flashRef.current.set(pad.index, performance.now() + 150);
      // Record NEXT event for the staff (vertical green line)
      staffNextRef.current.push({ ratioIndex: pad.ratioIndex, time: performance.now() });
      // Recording: save NEXT event
      if (isRecordingRef.current) {
        recordedEventsRef.current.push({
          kind: "next",
          ratioIndex: pad.ratioIndex,
          timeMs: performance.now() - recordStartRef.current,
        });
      }
    }
  }, [doReset, doBaseChange]);

  const handleEnd = useCallback((id: number) => {
    const padIndex = touchMapRef.current.get(id);
    touchMapRef.current.delete(id);
    if (padIndex == null) return;

    if (padIndex < N_PADS) {
      // Stop this touch's own voice (keyed by touch ID, not pad index)
      const entry = chordVoicesRef.current.get(id);
      if (entry) {
        entry.voice.stop(120);
        chordVoicesRef.current.delete(id);
        // Close the most recent open staff event for this ratioIndex
        const notes = staffNotesRef.current;
        for (let i = notes.length - 1; i >= 0; i--) {
          if (notes[i].ratioIndex === entry.padIndex && notes[i].endTime === -1) {
            notes[i].endTime = performance.now();
            break;
          }
        }
        // Recording: close the chord event for this touch ID
        if (isRecordingRef.current) {
          const open = recOpenRef.current.get(id);
          if (open) {
            recordedEventsRef.current.push({
              kind: "chord",
              ratioIndex: open.ratioIndex,
              startMs: open.startMs,
              endMs: performance.now() - recordStartRef.current,
            });
            recOpenRef.current.delete(id);
          }
        }
      }
      padRefRemove(padIndex);
      // Rebuild remaining voices now that chord is smaller
      rebuildChord();
    }
    // NEXT pads: flash self-expires, nothing to release
  }, []);

  // ── Move: slide finger to a new pad ──
  const handleMove = useCallback((id: number, px: number, py: number) => {
    const prevIndex = touchMapRef.current.get(id);
    if (prevIndex === undefined) return; // touch not tracked

    const pad = hitPad(padsRef.current, px, py);
    const newIndex = pad ? pad.index : null;

    if (newIndex === prevIndex) return; // still on the same pad, nothing to do

    // Release the old pad if it was a CHORD pad
    if (prevIndex != null && prevIndex < N_PADS) {
      const entry = chordVoicesRef.current.get(id);
      if (entry) {
        entry.voice.stop(60);
        chordVoicesRef.current.delete(id);
        // Close the open staff event for this ratioIndex
        const notes = staffNotesRef.current;
        for (let i = notes.length - 1; i >= 0; i--) {
          if (notes[i].ratioIndex === entry.padIndex && notes[i].endTime === -1) {
            notes[i].endTime = performance.now();
            break;
          }
        }
        // Recording: close the chord event for this touch ID
        if (isRecordingRef.current) {
          const open = recOpenRef.current.get(id);
          if (open) {
            recordedEventsRef.current.push({
              kind: "chord",
              ratioIndex: open.ratioIndex,
              startMs: open.startMs,
              endMs: performance.now() - recordStartRef.current,
            });
            recOpenRef.current.delete(id);
          }
        }
      }
      padRefRemove(prevIndex);
    }

    touchMapRef.current.set(id, newIndex);

    if (newIndex == null || !pad) return;

    if (pad.row === "chord") {
      // Insert placeholder keyed by touch ID then rebuild
      const [pNum, pDen] = RATIOS[pad.ratioIndex];
      const ac = getAC();
      chordVoicesRef.current.set(id, { voice: new Voice(ac, exactFreq(pNum, pDen), 1), padIndex: pad.index });
      padRefAdd(pad.index);
      rebuildChord();
      // Record note-on for the staff
      staffNotesRef.current.push({ ratioIndex: pad.ratioIndex, startTime: performance.now(), endTime: -1 });
      // Recording: open a new chord event
      if (isRecordingRef.current) {
        recOpenRef.current.set(id, {
          ratioIndex: pad.ratioIndex,
          startMs: performance.now() - recordStartRef.current,
        });
      }
    } else {
      // Sliding into a NEXT pad fires it once — silent, flash only
      const [num, den] = RATIOS[pad.ratioIndex];
      modeNumRef.current *= num;
      modeDenRef.current *= den;
      const g = gcd(modeNumRef.current, modeDenRef.current);
      modeNumRef.current /= g;
      modeDenRef.current /= g;
      pushDisplay();
      retuneChord(30);
      flashRef.current.set(newIndex, performance.now() + 150);
      // Record NEXT event for the staff (vertical green line)
      staffNextRef.current.push({ ratioIndex: pad.ratioIndex, time: performance.now() });
      // Recording: save NEXT event
      if (isRecordingRef.current) {
        recordedEventsRef.current.push({
          kind: "next",
          ratioIndex: pad.ratioIndex,
          timeMs: performance.now() - recordStartRef.current,
        });
      }
    }
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

  // ── Mount: event listeners — run once only ──
  useEffect(() => {
    resize();
    window.addEventListener("resize", resize);

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
    const onTouchMove = (e: TouchEvent) => {
      e.preventDefault();
      Array.from(e.changedTouches).forEach(t =>
        handleMove(t.identifier, t.clientX, t.clientY)
      );
    };

    window.addEventListener("touchstart",  onTouchStart,  { passive: false });
    window.addEventListener("touchmove",   onTouchMove,   { passive: false });
    window.addEventListener("touchend",    onTouchEnd,    { passive: false });
    window.addEventListener("touchcancel", onTouchEnd,    { passive: false });

    // Mouse fallback
    const MOUSE_ID = -1;
    const onMouseDown = (e: MouseEvent) => handleStart(MOUSE_ID, e.clientX, e.clientY);
    const onMouseUp   = (e: MouseEvent) => handleEnd(MOUSE_ID);
    const onMouseMove = (e: MouseEvent) => { if (e.buttons & 1) handleMove(MOUSE_ID, e.clientX, e.clientY); };
    window.addEventListener("mousedown", onMouseDown);
    window.addEventListener("mouseup",   onMouseUp);
    window.addEventListener("mousemove", onMouseMove);

    // Cleanup only on true unmount — stop all voices
    return () => {
      window.removeEventListener("resize", resize);
      window.removeEventListener("touchstart",  onTouchStart);
      window.removeEventListener("touchmove",   onTouchMove);
      window.removeEventListener("touchend",    onTouchEnd);
      window.removeEventListener("touchcancel", onTouchEnd);
      window.removeEventListener("mousedown", onMouseDown);
      window.removeEventListener("mouseup",   onMouseUp);
      window.removeEventListener("mousemove", onMouseMove);
      Array.from(chordVoicesRef.current.values()).forEach(e => e.voice.stop(0));
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // intentionally empty — handlers use refs, never stale

  // ── RAF loop: restart whenever draw (or display) changes ──
  useEffect(() => {
    cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(draw);
    return () => { cancelAnimationFrame(rafRef.current); };
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
          overflow: "hidden",
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
      {/* Invisible DOM overlay for LOAD button — needed so browser allows file picker from a real gesture */}
      {loadBtnRect && (
        <button
          style={{
            position: "fixed",
            left: loadBtnRect.x,
            top:  loadBtnRect.y,
            width:  loadBtnRect.w,
            height: loadBtnRect.h,
            opacity: 0,
            cursor: "pointer",
            zIndex: 5,
            padding: 0,
            border: "none",
            background: "transparent",
          }}
          onClick={() => fileInputRef.current?.click()}
          aria-label="Load CSV file"
        />
      )}
      {/* Invisible DOM overlay for PLAY/STOP button */}
      {playBtnRect && (
        <button
          style={{
            position: "fixed",
            left: playBtnRect.x,
            top:  playBtnRect.y,
            width:  playBtnRect.w,
            height: playBtnRect.h,
            opacity: 0,
            cursor: "pointer",
            zIndex: 5,
            padding: 0,
            border: "none",
            background: "transparent",
          }}
          onClick={() => {
            if (isPlayingRef.current) {
              doStopPlayback();
            } else if (loadedEventsRef.current.length > 0) {
              doStartPlayback();
            }
          }}
          aria-label={isPlaying ? "Stop playback" : "Play"}
        />
      )}
      {/* Hidden file input for LOAD button */}
      <input
        ref={fileInputRef}
        type="file"
        accept=".csv,text/csv"
        style={{ display: "none" }}
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) doLoadFile(file);
          // Reset so the same file can be re-selected
          e.target.value = "";
        }}
      />
    </>
  );
}
