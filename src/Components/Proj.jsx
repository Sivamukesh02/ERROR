import React, { useEffect, useRef, useState } from "react";
import "../assets/Style/style.css";

/* ---------- timeline (ms) ---------- */
const PHASES = [
  ["sit", 1200], // robot idle, wires lying on the ground
  ["plug", 900], // wires hop up and plug into robot's two sides
  ["rise", 700], // robot floats up, weak current in wires
  ["shock", 1000], // strong current, shake, X eyes
  ["fall", 550], // drops down
  ["lie", 1700], // lying, wires pop off
  ["stand", 700], // gets up again
];
const TOTAL = PHASES.reduce((s, [, d]) => s + d, 0);

/* ---------- scene constants ---------- */
const PIVOT = { x: 300, y: 247 }; // robot's feet
const SOCK_L = { x: -30, y: -33 }; // left side socket (offset from pivot)
const SOCK_R = { x: 30, y: -33 }; // right side socket
const CORE = { x: 0, y: -33 };
const MONITOR_PORT = { x: 122, y: 180 };
const SERVER_PORT = { x: 480, y: 212 };
const LOOSE = { l: { x: 215, y: 243 }, r: { x: 385, y: 243 } }; // wire ends on the ground
const CABLE_LEN = 190;
const JUMP = 115;
const LIE_Y = -18;

const lerp = (a, b, t) => a + (b - a) * t;
const lerpPt = (a, b, t) => ({ x: lerp(a.x, b.x, t), y: lerp(a.y, b.y, t) });
const easeOut = (p) => 1 - Math.pow(1 - p, 3);
const easeInOut = (p) => (p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2);

/* local robot point -> world point (follows position + rotation) */
function toWorld(pose, o) {
  const r = (pose.rot * Math.PI) / 180;
  return {
    x: PIVOT.x + pose.x + o.x * Math.cos(r) - o.y * Math.sin(r),
    y: PIVOT.y + pose.y + o.x * Math.sin(r) + o.y * Math.cos(r),
  };
}

/* cable = quadratic curve whose sag depends on how much slack is left */
function cablePath(a, b) {
  const d = Math.hypot(b.x - a.x, b.y - a.y);
  const sag = Math.sqrt((3 * d * Math.max(0, CABLE_LEN - d)) / 8);
  const cx = (a.x + b.x) / 2;
  const cy = Math.min((a.y + b.y) / 2 + sag * 2, 245);
  return `M${a.x} ${a.y} Q${cx} ${cy} ${b.x} ${b.y}`;
}

/* random zig-zag lightning line */
function bolt(x0, y0, x1, y1, n = 5) {
  const pts = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const j = i === 0 || i === n ? 0 : (Math.random() - 0.5) * 16;
    pts.push(`${x0 + (x1 - x0) * t + j},${y0 + (y1 - y0) * t + j}`);
  }
  return pts.join(" ");
}

/* pure function: time -> pose of robot + where the wire ends are */
function getPose(t) {
  let phase = "sit";
  let p = 0;
  let acc = 0;
  for (const [name, dur] of PHASES) {
    if (t < acc + dur) {
      phase = name;
      p = (t - acc) / dur;
      break;
    }
    acc += dur;
  }
  const local = t - acc;
  const pose = { phase, x: 0, y: 0, rot: 0, shock: false, current: 0 };

  /* 1) robot body motion */
  switch (phase) {
    case "sit":
    case "plug":
      pose.y = Math.sin(t / 380) * 0.8; // tiny idle bob
      break;
    case "rise":
      pose.y = -JUMP * easeOut(p);
      break;
    case "shock":
      pose.y = -JUMP + Math.sin(t / 45) * 3;
      pose.x = (Math.random() - 0.5) * 8;
      pose.rot = (Math.random() - 0.5) * 10;
      pose.shock = true;
      break;
    case "fall":
      pose.y = -JUMP + (JUMP + LIE_Y) * p * p; // gravity
      pose.rot = 90 * easeInOut(p);
      break;
    case "lie": {
      const bounce = 9 * Math.exp(-local / 180) * Math.abs(Math.sin(local / 60));
      pose.y = LIE_Y - bounce;
      pose.rot = 90;
      break;
    }
    case "stand":
      pose.y = LIE_Y * (1 - easeInOut(p));
      pose.rot = 90 * (1 - easeInOut(p));
      break;
    default:
  }

  /* 2) wire ends */
  const sock = { l: toWorld(pose, SOCK_L), r: toWorld(pose, SOCK_R) };
  pose.core = toWorld(pose, CORE);
  pose.ends = sock;

  switch (phase) {
    case "sit":
    case "stand":
      pose.ends = LOOSE;
      break;
    case "plug": {
      const e = easeInOut(p);
      const lift = Math.sin(Math.PI * p) * 38; // wire end hops up
      const l = lerpPt(LOOSE.l, sock.l, e);
      const r = lerpPt(LOOSE.r, sock.r, e);
      pose.ends = { l: { x: l.x, y: l.y - lift }, r: { x: r.x, y: r.y - lift } };
      pose.current = p > 0.85 ? 1 : 0;
      break;
    }
    case "rise":
    case "fall":
      pose.current = 1; // weak current
      break;
    case "shock":
      pose.current = 2; // strong current
      break;
    case "lie": {
      // wires get yanked off the sockets
      const s0 = {
        l: toWorld({ x: 0, y: LIE_Y, rot: 90 }, SOCK_L),
        r: toWorld({ x: 0, y: LIE_Y, rot: 90 }, SOCK_R),
      };
      const e = easeOut(Math.min(1, local / 350));
      pose.ends = { l: lerpPt(s0.l, LOOSE.l, e), r: lerpPt(s0.r, LOOSE.r, e) };
      break;
    }
    default:
  }
  return pose;
}

function Proj() {
  const reduced =
    typeof window !== "undefined" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  const [time, setTime] = useState(0);
  const boltRef = useRef({ slot: -1, lines: [] });

  useEffect(() => {
    if (reduced) return;
    let raf;
    const start = performance.now();
    const loop = (now) => {
      setTime((now - start) % TOTAL);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [reduced]);

  const pose = getPose(time);
  const { core, ends } = pose;
  const ko = pose.shock || pose.phase === "fall" || pose.phase === "lie";

  // refresh lightning every ~70ms while shocked
  if (pose.shock) {
    const slot = Math.floor(time / 70);
    if (boltRef.current.slot !== slot) {
      boltRef.current = {
        slot,
        lines: Array.from({ length: 4 }, () => {
          const a = Math.random() * Math.PI * 2;
          const r1 = 10 + Math.random() * 10;
          const r2 = 38 + Math.random() * 26;
          return bolt(
            core.x + Math.cos(a) * r1,
            core.y + Math.sin(a) * r1,
            core.x + Math.cos(a) * r2,
            core.y + Math.sin(a) * r2
          );
        }),
      };
    }
  }

  const flash = pose.shock && Math.floor(time / 60) % 2 === 0;
  const left = cablePath(MONITOR_PORT, ends.l); // current flows monitor -> robot
  const right = cablePath(SERVER_PORT, ends.r); // current flows server -> robot
  const currentClass = pose.current === 2 ? "current" : "current weak";

  return (
    <main className="e404">
      <h1 className="e404-code">404</h1>
      <p className="e404-label">ERROR</p>

      <svg className="e404-scene" viewBox="0 0 600 300" role="img"
        aria-label="A little robot plugs two wires into its sides, gets an electric shock and falls down">
        {/* ground */}
        <path d="M20 262 Q300 232 580 262 L580 268 L20 268 Z" className="ground" />

        {/* monitor */}
        <g className="monitor">
          <rect x="76" y="200" width="8" height="40" className="dark" />
          <ellipse cx="80" cy="243" rx="20" ry="5" className="dark" />
          <rect x="40" y="132" width="86" height="70" rx="8" className="mon-frame" />
          <rect x="48" y="140" width="70" height="54" rx="3" className="mon-screen" />
          <polyline points="54,178 66,158 76,172 88,150 98,168 110,152"
            className={pose.shock ? "graph bad" : "graph"} />
        </g>

        {/* server */}
        <g className="server">
          <rect x="480" y="105" width="62" height="142" rx="8" className="srv" />
          {[0, 1, 2].map((i) => (
            <g key={i}>
              <rect x="488" y={113 + i * 44} width="46" height="38" rx="5" className="srv-drawer" />
              <circle cx="500" cy={132 + i * 44} r="2.5" className={pose.shock ? "led on" : "led"} />
              <circle cx="520" cy={132 + i * 44} r="2.5" className={pose.shock ? "led on" : "led"} />
            </g>
          ))}
        </g>

        {/* cables */}
        <path d={left} className="cable" />
        <path d={right} className="cable" />
        {pose.current > 0 && (
          <>
            <path d={left} className={currentClass} />
            <path d={right} className={currentClass} />
          </>
        )}

        {/* robot */}
        <g transform={`translate(${pose.x} ${pose.y}) rotate(${pose.rot} ${PIVOT.x} ${PIVOT.y})`}
          className={flash ? "robot flash" : "robot"}>
          {/* antenna */}
          <line x1="300" y1="150" x2="300" y2="138" className="ant-stem" />
          <circle cx="300" cy="135" r="4.5" className={ko ? "ant bad" : "ant"} />
          {/* legs + feet */}
          <rect x="286" y="234" width="10" height="10" className="r-metal" />
          <rect x="304" y="234" width="10" height="10" className="r-metal" />
          <rect x="281" y="242" width="20" height="6" rx="3" className="r-feet" />
          <rect x="299" y="242" width="20" height="6" rx="3" className="r-feet" />
          {/* body */}
          <rect x="295" y="184" width="10" height="7" className="r-metal" />
          <rect x="276" y="190" width="48" height="45" rx="9" className="r-body" />
          <rect x="287" y="199" width="26" height="18" rx="3" className="r-panel" />
          <circle cx="294" cy="208" r="2.6" className={ko ? "r-light bad" : "r-light"} />
          <circle cx="300" cy="208" r="2.6" className="r-light" />
          <circle cx="306" cy="208" r="2.6" className={ko ? "r-light bad" : "r-light"} />
          <rect x="290" y="224" width="20" height="4" rx="2" className="r-metal" />
          {/* side arms with sockets (wires plug in here) */}
          <rect x="263" y="203" width="13" height="28" rx="6" className="r-arm" />
          <rect x="324" y="203" width="13" height="28" rx="6" className="r-arm" />
          <circle cx="270" cy="214" r="5" className="r-socket" />
          <circle cx="330" cy="214" r="5" className="r-socket" />
          {/* head */}
          <rect x="272" y="160" width="6" height="16" rx="2" className="r-metal" />
          <rect x="322" y="160" width="6" height="16" rx="2" className="r-metal" />
          <rect x="277" y="150" width="46" height="36" rx="10" className="r-head" />
          <rect x="283" y="157" width="34" height="20" rx="7" className="r-visor" />
          {ko ? (
            <g className="r-xeye">
              <path d="M288 163 l8 8 M296 163 l-8 8" />
              <path d="M304 163 l8 8 M312 163 l-8 8" />
            </g>
          ) : (
            <>
              <circle cx="293" cy="167" r="3.8" className="r-eye" />
              <circle cx="307" cy="167" r="3.8" className="r-eye" />
            </>
          )}
          <rect x="293" y="179" width="14" height="2.5" rx="1.2" className="r-metal" />
        </g>

        {/* plug heads on top of robot so they look attached */}
        <circle cx={ends.l.x} cy={ends.l.y} r="5.5" className="plug" />
        <circle cx={ends.r.x} cy={ends.r.y} r="5.5" className="plug" />

        {/* electricity */}
        {pose.shock && (
          <g className="bolts">
            <circle cx={core.x} cy={core.y} r="30" className="glow" />
            <circle cx={ends.l.x} cy={ends.l.y} r="12" className="glow" />
            <circle cx={ends.r.x} cy={ends.r.y} r="12" className="glow" />
            {boltRef.current.lines.map((pts, i) => (
              <polyline key={i} points={pts} />
            ))}
          </g>
        )}
      </svg>

      <h2 className="e404-title">Looks like you're lost</h2>
      <p className="e404-sub">The page you are looking for is not available!</p>
    </main>
  );
}

export default Proj;