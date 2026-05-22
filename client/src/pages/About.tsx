/**
 * About page — Relative Notation Organ by Martin Kolář
 *
 * Design: dark background matching the instrument, readable prose,
 * DM Mono for technical terms, DM Sans for body text.
 */

import { useLocation } from "wouter";

export default function About() {
  const [, setLocation] = useLocation();

  return (
    <div
      style={{
        minHeight: "100vh",
        background: "#0a0c10",
        color: "#8ab4cc",
        fontFamily: "'DM Sans', sans-serif",
        overflowY: "auto",
        WebkitOverflowScrolling: "touch",
      }}
    >
      {/* Top bar */}
      <div
        style={{
          position: "sticky",
          top: 0,
          background: "#0a0c10",
          borderBottom: "1px solid #1e2a38",
          display: "flex",
          alignItems: "center",
          gap: 12,
          padding: "0 20px",
          height: 48,
          zIndex: 10,
        }}
      >
        <button
          onClick={() => setLocation("/")}
          style={{
            background: "#1e2a38",
            border: "1px solid #2a3a50",
            borderRadius: 4,
            color: "#9ab8cc",
            fontFamily: "'DM Sans', sans-serif",
            fontSize: 13,
            fontWeight: 600,
            padding: "4px 14px",
            cursor: "pointer",
            letterSpacing: "0.04em",
          }}
        >
          ← Play
        </button>
        <span
          style={{
            fontSize: 13,
            fontWeight: 500,
            color: "rgba(120,160,200,0.5)",
            letterSpacing: "0.05em",
          }}
        >
          Relative Notation Organ by Martin Kolář
        </span>
      </div>

      {/* Content */}
      <div
        style={{
          maxWidth: 680,
          margin: "0 auto",
          padding: "40px 24px 80px",
          lineHeight: 1.75,
          fontSize: 15,
        }}
      >
        <h1
          style={{
            fontFamily: "'DM Mono', monospace",
            fontSize: "clamp(20px, 4vw, 28px)",
            fontWeight: 600,
            color: "#c8dff0",
            marginBottom: 8,
            letterSpacing: "-0.01em",
          }}
        >
          Relative Notation Organ
        </h1>
        <p
          style={{
            fontSize: 13,
            color: "rgba(120,160,200,0.55)",
            marginBottom: 40,
            letterSpacing: "0.04em",
          }}
        >
          by Martin Kolář
        </p>

        <Section title="What it is">
          <p>
            The Relative Notation Organ is a polyphonic just-intonation
            instrument designed for multitouch screens. Every note you play is
            expressed as a <Mono>ratio</Mono> — a fraction of a reference
            frequency — so the relationships between notes are always exact
            integer proportions. There is no equal temperament, no cents of
            compromise: a fifth is always <Mono>3/2</Mono>, a major third is
            always <Mono>5/4</Mono>, and chords built from these ratios are
            acoustically beatless.
          </p>
          <p>
            The instrument takes its name from <em>relative notation</em>: every
            pitch is defined relative to a movable centre rather than to a fixed
            chromatic scale. The centre — called <Mono>MODE</Mono> — can be
            shifted to any just-intonation ratio of the base frequency, and all
            held notes transpose with it instantly.
          </p>
        </Section>

        <Section title="The two rows">
          <p>
            The screen is divided into two equal rows of pads, each spanning the
            same set of 19 ratios: nine descending on the left, <Mono>1/1</Mono>{" "}
            in the centre, nine ascending on the right.
          </p>
          <Table
            rows={[
              ["Top row — CHORD", "Hold to sustain a note. Each pad sounds at BASE × MODE × its ratio. You can hold as many pads as you have fingers."],
              ["Bottom row — NEXT", "Tap to multiply MODE by that pad's ratio. All held CHORD notes retune immediately to the new MODE. Release to keep the new MODE."],
            ]}
          />
          <p>
            The left half of each row contains ratios smaller than <Mono>1/1</Mono>{" "}
            (moving the pitch down), and the right half contains their
            reciprocals (moving the pitch up). The centre pad is always{" "}
            <Mono>1/1</Mono> — the unison of the current MODE.
          </p>
        </Section>

        <Section title="How to play">
          <p>
            <strong style={{ color: "#c8dff0" }}>Hold a chord.</strong> Press
            and hold one or more CHORD pads with your fingers. Each finger
            sustains a note for as long as it stays on the pad. Slide a finger
            to a neighbouring pad to glide to that note.
          </p>
          <p>
            <strong style={{ color: "#c8dff0" }}>Shift the mode.</strong> While
            holding a chord, tap a NEXT pad with a free finger. The MODE
            fraction multiplies by that pad's ratio, and every held note
            retuned to the new MODE in 30 ms — a smooth, click-free transpose.
            You can chain NEXT taps to move through a harmonic series or
            modulate to distant regions of just-intonation space.
          </p>
          <p>
            <strong style={{ color: "#c8dff0" }}>Reset.</strong> Tap{" "}
            <Mono>RESET</Mono> in the top-right corner to return MODE to{" "}
            <Mono>1/1</Mono> without stopping any held notes.
          </p>
          <p>
            <strong style={{ color: "#c8dff0" }}>Tune the base.</strong> Use the{" "}
            <Mono>−</Mono> and <Mono>+</Mono> buttons to shift the BASE
            frequency by 1 Hz per tap. The default is 220 Hz (A3). All
            frequencies recompute from integers on every change, so there is no
            accumulated tuning drift no matter how many steps you take.
          </p>
        </Section>

        <Section title="The ratio grid">
          <p>
            The 19 ratios on each row, from left to right:
          </p>
          <div
            style={{
              fontFamily: "'DM Mono', monospace",
              fontSize: 13,
              color: "#7aaabb",
              background: "#111620",
              border: "1px solid #1e2a38",
              borderRadius: 6,
              padding: "14px 18px",
              lineHeight: 2,
              letterSpacing: "0.04em",
              overflowX: "auto",
            }}
          >
            1/4 · 1/3 · 2/5 · 1/2 · 2/3 · 3/4 · 4/5 · 5/6 · 6/7 ·{" "}
            <span style={{ color: "#c8dff0", fontWeight: 600 }}>1/1</span> · 7/6
            · 6/5 · 5/4 · 4/3 · 3/2 · 5/3 · 7/4 · 2/1 · 3/1
          </div>
          <p>
            The left nine are sub-unison intervals (octave below, fifth below,
            minor third below, etc.). The right nine are their reciprocals
            (minor seventh above, major sixth above, major third above, etc.).
            The outermost pads (<Mono>1/4</Mono> and <Mono>3/1</Mono>) span two
            octaves below and nearly two octaves above the MODE.
          </p>
        </Section>

        <Section title="Audio design">
          <p>
            Each voice is a stack of sine-wave oscillators at integer multiples
            of the fundamental. Non-integer partials (such as a ×1.5 fifth)
            would beat against the partials of other just-tuned voices, so they
            are excluded entirely. Only <Mono>×1</Mono>, <Mono>×2</Mono>,{" "}
            <Mono>×3</Mono>, and <Mono>×4</Mono> are used.
          </p>
          <p>
            As the chord grows, the instrument automatically reduces the number
            of partials per voice to prevent inter-voice beating:
          </p>
          <Table
            rows={[
              ["1–2 notes", "×1 ×2 ×3 ×4 — full harmonic stack"],
              ["3 notes", "×1 ×2 only"],
              ["4+ notes", "Pure sine (×1) — no partials to collide"],
            ]}
          />
          <p>
            Every frequency is computed as{" "}
            <Mono>BASE × modeNum × padNum ÷ (modeDen × padDen)</Mono> — a
            single multiplication from integers with no floating-point
            accumulation. Tuning stays exact regardless of how many MODE shifts
            you make.
          </p>
        </Section>

        <Section title="Tips">
          <ul style={{ paddingLeft: 20, margin: 0 }}>
            {[
              "Start with a two-finger chord on 1/1 and 3/2 (the perfect fifth) to hear the instrument's beatless clarity.",
              "Tap NEXT on 3/2 repeatedly to move up by fifths — a just-intonation circle of fifths.",
              "Hold a dense chord (4+ fingers) and tap NEXT pads rapidly: the pure-sine voices let you hear the harmonic motion without any timbral clutter.",
              "Lower BASE to 55 Hz (A1) for deep, organ-like bass chords.",
              "The instrument works on desktop too — click and drag to test single-voice behaviour.",
            ].map((tip, i) => (
              <li key={i} style={{ marginBottom: 10 }}>
                {tip}
              </li>
            ))}
          </ul>
        </Section>

        <div
          style={{
            marginTop: 56,
            paddingTop: 24,
            borderTop: "1px solid #1e2a38",
            fontSize: 12,
            color: "rgba(120,160,200,0.35)",
            letterSpacing: "0.04em",
          }}
        >
          Relative Notation Organ · Martin Kolář · Built with the Web Audio API
        </div>
      </div>
    </div>
  );
}

// ─── Local helpers ────────────────────────────────────────────────────────────

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section style={{ marginBottom: 40 }}>
      <h2
        style={{
          fontFamily: "'DM Mono', monospace",
          fontSize: 13,
          fontWeight: 600,
          color: "#4a8aaa",
          textTransform: "uppercase",
          letterSpacing: "0.12em",
          marginBottom: 14,
          marginTop: 0,
        }}
      >
        {title}
      </h2>
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {children}
      </div>
    </section>
  );
}

function Mono({ children }: { children: React.ReactNode }) {
  return (
    <code
      style={{
        fontFamily: "'DM Mono', monospace",
        fontSize: "0.9em",
        color: "#7aaabb",
        background: "#111620",
        border: "1px solid #1e2a38",
        borderRadius: 3,
        padding: "1px 5px",
      }}
    >
      {children}
    </code>
  );
}

function Table({ rows }: { rows: [string, string][] }) {
  return (
    <table
      style={{
        width: "100%",
        borderCollapse: "collapse",
        fontSize: 14,
        marginTop: 4,
        marginBottom: 4,
      }}
    >
      <tbody>
        {rows.map(([label, desc], i) => (
          <tr
            key={i}
            style={{
              borderBottom: "1px solid #1e2a38",
            }}
          >
            <td
              style={{
                fontFamily: "'DM Mono', monospace",
                fontSize: 12,
                color: "#7aaabb",
                whiteSpace: "nowrap",
                padding: "10px 16px 10px 0",
                verticalAlign: "top",
                width: "30%",
              }}
            >
              {label}
            </td>
            <td
              style={{
                color: "#8ab4cc",
                padding: "10px 0",
                verticalAlign: "top",
              }}
            >
              {desc}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
