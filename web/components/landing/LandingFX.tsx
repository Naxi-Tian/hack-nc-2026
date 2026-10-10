"use client";

import { useEffect } from "react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";

/*
 * Imperative effects for the landing page, ported from landing/index.html:
 * ticker tape, split-flap board, Estimate Desk, round page (fills, chart, quote),
 * WebGL halftone plate and the B1 scroll choreography.
 * Everything it creates is tagged data-gen and torn down in cleanup, so React
 * (including StrictMode double effects) and route changes stay safe.
 */

// Demo anchors from MEGA_PLAN §10 — illustrative only; not the server valuation model.
const ANCHOR = { IDEA: 100000, PROTOTYPE: 500000, LAUNCHED: 1000000, REVENUE: 2000000, GROWTH: 5000000 } as const;
type Stage = keyof typeof ANCHOR;

const fmt$ = (n: number, d = 0) => "$" + n.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
const $ = <T extends Element = HTMLElement>(id: string) => document.getElementById(id) as unknown as T;

export default function LandingFX() {
  useEffect(() => {
    const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
    const cleanups: (() => void)[] = [];
    const every = (fn: () => void, ms: number) => { const id = setInterval(fn, ms); cleanups.push(() => clearInterval(id)); };
    const later = (fn: () => void, ms: number) => { const id = setTimeout(fn, ms); cleanups.push(() => clearTimeout(id)); };
    document.querySelectorAll("[data-gen]").forEach((n) => n.remove());

    /* ── fixtures priced with the demo formula ── */
    const CO = ([
      { t: "MOTH", n: "MOTHLIGHT", s: "IDEA", score: 52, sub: 38 },
      { t: "DORM", n: "DORMFOLD", s: "IDEA", score: 38, sub: 12 },
      { t: "TIDE", n: "TIDEWATER SENSORS", s: "PROTOTYPE", score: 61, sub: 54 },
      { t: "BRKT", n: "BRACKET BIO", s: "PROTOTYPE", score: 44, sub: 27 },
      { t: "QUIL", n: "QUILLNOTE", s: "LAUNCHED", score: 63, sub: 91 },
      { t: "ORCH", n: "ORCHARD OS", s: "LAUNCHED", score: 47, sub: 66 },
      { t: "FERN", n: "FERNHILL ROBOTICS", s: "REVENUE", score: 68, sub: 61 },
      { t: "KILN", n: "KILN LABS", s: "GROWTH", score: 55, sub: 100 },
    ] as { t: string; n: string; s: Stage; score: number; sub: number }[])
      .map((c) => ({ ...c, p: Math.round((ANCHOR[c.s] * (0.5 + c.score / 100)) / 1e6 * 100) / 100 }));

    /* ── ticker tape ── */
    const tape = $("tape");
    const tapeHTML = CO.map((c) => {
      const full = c.sub >= 100;
      return `<span class="tape-item"><b>${c.t}</b>${fmt$(c.p, 2)} fixed &nbsp;<span class="${full ? "dn" : "up"}">${full ? "■ round full" : "▲ " + c.sub + "% subscribed"}</span></span>`;
    }).join("");
    tape.innerHTML = tapeHTML + tapeHTML;
    cleanups.push(() => { tape.innerHTML = ""; });

    /* ── split-flap board ── */
    const CHARS = " ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789$.%";
    const board = $("board");
    const flapGroup = (len: number, cls = "") => {
      const g = document.createElement("span");
      g.className = "flaps " + cls;
      for (let i = 0; i < len; i++) { const f = document.createElement("span"); f.className = "flap"; f.innerHTML = "<span>&nbsp;</span>"; g.appendChild(f); }
      return g;
    };
    const setFlaps = (g: HTMLElement, text: string, delay = 0) => {
      const cells = [...g.children] as HTMLElement[];
      text = text.padEnd(cells.length).slice(0, cells.length);
      cells.forEach((cell, i) => {
        const span = cell.firstChild as HTMLElement, target = text[i] === " " ? " " : text[i];
        if (reduce) { span.textContent = target; return; }
        const steps = 4 + ((i * 7) % 9); let k = 0;
        const tick = () => {
          cell.classList.remove("go"); void cell.offsetWidth; cell.classList.add("go");
          span.textContent = k >= steps ? target : CHARS[1 + ((Math.random() * (CHARS.length - 1)) | 0)];
          if (k++ < steps) later(tick, 55);
        };
        later(tick, delay + i * 28);
      });
    };
    const rows = CO.map((c) => {
      const row = document.createElement("div");
      row.className = "brow"; row.setAttribute("role", "row"); row.dataset.gen = "";
      const tk = flapGroup(4), nm = flapGroup(17), st = flapGroup(9), pr = flapGroup(5, "g");
      nm.classList.add("name");
      const sub = document.createElement("div"); sub.className = "subbar";
      sub.innerHTML = `<div class="bar${c.sub >= 100 ? " full" : ""}"><i style="width:0"></i></div><span class="pct">0%</span>`;
      row.append(tk, nm, st, pr, sub);
      board.appendChild(row);
      return { c, tk, nm, st, pr, sub };
    });
    const paintSub = (r: (typeof rows)[number]) => {
      const pct = r.sub.querySelector(".pct")!;
      r.sub.querySelector<HTMLElement>("i")!.style.width = Math.min(100, r.c.sub) + "%";
      pct.textContent = r.c.sub >= 100 ? "FULL" : r.c.sub + "%";
      if (r.c.sub >= 100) { r.sub.querySelector(".bar")!.classList.add("full"); pct.classList.add("dn"); }
    };
    const boardIO = new IntersectionObserver((es) => {
      if (!es[0].isIntersecting) return;
      boardIO.disconnect();
      rows.forEach((r, i) => {
        const d = i * 140;
        setFlaps(r.tk, r.c.t, d); setFlaps(r.nm, r.c.n, d + 60); setFlaps(r.st, r.c.s, d + 120); setFlaps(r.pr, fmt$(r.c.p, 2), d + 180);
        later(() => paintSub(r), d + 400);
      });
    }, { threshold: 0.25 });
    boardIO.observe(board);
    cleanups.push(() => boardIO.disconnect());
    if (!reduce) every(() => {
      const open = rows.filter((r) => r.c.sub < 100);
      if (!open.length) return;
      const r = open[(Math.random() * open.length) | 0];
      r.c.sub = Math.min(100, r.c.sub + 1);
      paintSub(r);
    }, 2600);

    /* ── estimate desk ── */
    const STAGES = Object.keys(ANCHOR) as Stage[];
    const CATS = [
      { k: "product", l: "Product", w: 0.3, h: ["No milestone evidence", "Milestone described", "Working demo for your stage", "Demo tested with intended users", "Repeated milestones, with evidence"] },
      { k: "traction", l: "Traction", w: 0.3, h: ["No validation yet", "Informal conversations", "Documented interviews or pilot", "Repeat use or committed pilots", "Multiple corroborated sources"] },
      { k: "team", l: "Team", w: 0.25, h: ["No information", "Roles and availability described", "Relevant experience, named owners", "Prior relevant delivery", "Complementary and fully committed"] },
      { k: "financial", l: "Financial readiness", w: 0.15, h: ["No usable inputs", "Business model described", "Consistent assumptions supplied", "Dated budget and runway", "Documented, with scenarios"] },
    ] as const;
    const state: { stage: Stage } & Record<(typeof CATS)[number]["k"], number> = { stage: "IDEA", product: 2, traction: 1, team: 2, financial: 1 };
    const stagesEl = $("stages"), slidersEl = $("sliders");
    STAGES.forEach((s) => {
      const b = document.createElement("button"); b.textContent = s; b.setAttribute("aria-pressed", String(s === state.stage)); b.dataset.gen = "";
      b.onclick = () => { state.stage = s; [...stagesEl.children].forEach((x) => x.setAttribute("aria-pressed", String(x === b))); calc(); };
      stagesEl.appendChild(b);
    });
    CATS.forEach((c) => {
      const d = document.createElement("div"); d.className = "sl"; d.dataset.gen = "";
      d.innerHTML = `<label for="r-${c.k}">${c.l} · ${Math.round(c.w * 100)}% <b id="v-${c.k}"></b></label><input type="range" id="r-${c.k}" min="0" max="4" step="1" value="${state[c.k]}"><div class="hint" id="h-${c.k}"></div>`;
      slidersEl.appendChild(d);
      d.querySelector("input")!.addEventListener("input", (e) => { state[c.k] = +(e.target as HTMLInputElement).value; calc(); });
    });
    let shown = 0, raf = 0;
    const tweenTo = (el: HTMLElement, to: number) => {
      cancelAnimationFrame(raf);
      const from = shown, t0 = performance.now(), dur = reduce ? 1 : 520;
      const step = (t: number) => {
        const k = Math.min(1, (t - t0) / dur), e = 1 - Math.pow(1 - k, 3);
        shown = from + (to - from) * e; el.textContent = fmt$(Math.round(shown / 1000) * 1000);
        if (k < 1) raf = requestAnimationFrame(step); else { shown = to; el.textContent = fmt$(to); }
      };
      raf = requestAnimationFrame(step);
    };
    cleanups.push(() => cancelAnimationFrame(raf));
    function calc() {
      let score = 0;
      CATS.forEach((c) => { const v = state[c.k] * 25; score += c.w * v; $("v-" + c.k).textContent = String(v); $("h-" + c.k).textContent = c.h[state[c.k]]; });
      const anchor = ANCHOR[state.stage] * (0.5 + score / 100), lo = anchor * 0.6, hi = anchor * 1.5;
      tweenTo($("est"), Math.round(anchor));
      $("score").textContent = score.toFixed(1);
      const unit = Math.round(anchor / 1e6 * 100) / 100;
      $("unit").textContent = fmt$(unit, 2);
      $("raise").textContent = fmt$(Math.round(unit * 100000));
      $("lo").textContent = "Low " + fmt$(Math.round(lo));
      $("hi").textContent = "High " + fmt$(Math.round(hi));
      const max = ANCHOR[state.stage] * 1.5 * 1.5, pc = (v: number) => (v / max * 100) + "%";
      const rng = $("rng"); rng.style.left = pc(lo); rng.style.width = `calc(${pc(hi)} - ${pc(lo)})`;
      $("est-pin").style.left = pc(anchor);
    }
    calc();

    /* ── round page: fills, chart, quote ── */
    const fills = $("fills");
    const seedFills: [string, number][] = [["14:22:07", 1000], ["14:21:40", 250], ["14:19:12", 4000], ["14:18:55", 100], ["14:16:03", 1500], ["14:12:47", 500], ["14:11:30", 2000], ["14:09:02", 300], ["14:06:18", 750], ["14:02:44", 1000], ["13:58:09", 120], ["13:55:31", 2500], ["13:51:20", 600], ["13:47:58", 1000], ["13:44:13", 200]];
    const fillRow = (t: string, u: number, isNew = false) => {
      const r = document.createElement("div"); r.className = "fr" + (isNew ? " new" : ""); r.dataset.gen = "";
      r.innerHTML = `<i style="width:${Math.max(4, u / 4000 * 100)}%"></i><span class="t">${t}</span><span class="u">${u.toLocaleString()}</span><span>${fmt$(u * 2.36, 2)}</span>`;
      return r;
    };
    seedFills.forEach(([t, u]) => fills.appendChild(fillRow(t, u)));
    if (!reduce) every(() => {
      const t = new Date().toTimeString().slice(0, 8), u = [100, 250, 500, 1000, 1200, 2000][(Math.random() * 6) | 0];
      fills.insertBefore(fillRow(t, u, true), fills.children[1]);
      if (fills.children.length > 16) fills.lastElementChild!.remove();
    }, 3400);

    const svg = $<SVGSVGElement>("chart");
    let cum = 0, seed = 7; const pts: number[] = [], vols: number[] = [];
    const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    for (let i = 0; i <= 72; i++) {
      const v = (i < 6 ? 2600 : 380 + rand() * 1100 * (i % 4 === 2 ? 2.4 : 1)) * (i > 60 ? 1.5 : 1);
      cum += v; pts.push(cum); vols.push(v);
    }
    const kk = 61400 / cum; pts.forEach((p, i) => (pts[i] = p * kk)); vols.forEach((v, i) => (vols[i] = v * kk));
    const MONO = 'style="font-family:var(--mono)"';
    const drawChart = () => {
      const W = Math.max(280, svg.clientWidth), Hh = svg.clientHeight || 330, padR = 64, padB = 26;
      svg.setAttribute("viewBox", `0 0 ${W} ${Hh}`);
      const yMax = 100000, cx = (i: number) => i / (pts.length - 1) * (W - padR), cy = (v: number) => (Hh - padB) - v / yMax * (Hh - padB - 16);
      let line = `M0 ${cy(0)}`; pts.forEach((p, i) => { line += ` H${cx(i).toFixed(1)} V${cy(p).toFixed(1)}`; });
      const vmax = Math.max(...vols), bw = Math.max(2, (W - padR) / pts.length * 0.55);
      let g = "";
      [0, 25000, 50000, 75000, 100000].forEach((v) => {
        g += `<line x1="0" x2="${W - padR}" y1="${cy(v)}" y2="${cy(v)}" stroke="${v === 100000 ? "#5a2a22" : "#1d1c19"}" stroke-dasharray="${v === 100000 ? "0" : "2 4"}"/>`;
        g += `<text x="${W - padR + 10}" y="${cy(v) + 4}" fill="#8A857A" font-size="11" ${MONO}>${v ? v / 1000 + "K" : "0"}</text>`;
      });
      g += `<text x="6" y="${cy(100000) - 6}" fill="#EF5A43" font-size="10.5" ${MONO} letter-spacing="1">CAP · 100,000 UNITS</text>`;
      vols.forEach((v, i) => { const h = v / vmax * Hh * 0.18; g += `<rect class="vb" x="${(cx(i) - bw / 2).toFixed(1)}" y="${(Hh - padB - h).toFixed(1)}" width="${bw.toFixed(1)}" height="${h.toFixed(1)}" fill="#5BD06A" opacity=".28"/>`; });
      g += `<path d="${line} V${cy(0)} Z" fill="url(#gfill)" class="area"/>`;
      g += `<path d="${line}" fill="none" stroke="#5BD06A" stroke-width="1.6" class="ln"/>`;
      const ly = cy(pts[pts.length - 1]);
      g += `<line x1="0" x2="${W - padR}" y1="${ly}" y2="${ly}" stroke="#5BD06A" stroke-dasharray="2 3" opacity=".6"/>`;
      g += `<rect x="${W - padR + 2}" y="${ly - 10}" width="${padR - 4}" height="20" fill="#5BD06A"/><text x="${W - padR + 8}" y="${ly + 4}" fill="#071208" font-size="11" font-weight="700" ${MONO}>61.4K</text>`;
      const labels = W < 500 ? ["Sep 22", "Sep 30", "Oct 8"] : ["Sep 22", "Sep 26", "Sep 30", "Oct 4", "Oct 8"];
      labels.forEach((l, i) => { g += `<text x="${i / (labels.length - 1) * (W - padR - 44) + 4}" y="${Hh - 6}" fill="#8A857A" font-size="11" ${MONO}>${l}</text>`; });
      svg.innerHTML = `<defs><linearGradient id="gfill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#5BD06A" stop-opacity=".22"/><stop offset="1" stop-color="#5BD06A" stop-opacity="0"/></linearGradient></defs>${g}`;
    };
    drawChart();
    let cw = svg.clientWidth;
    const onResizeChart = () => { if (Math.abs(svg.clientWidth - cw) > 2) { cw = svg.clientWidth; drawChart(); ScrollTrigger.refresh(); } };
    addEventListener("resize", onResizeChart);
    cleanups.push(() => { removeEventListener("resize", onResizeChart); svg.innerHTML = ""; });

    const qn = $("qn"), qt = $("qt"), qa = $("qa"), buy = $("buy"), chips = $("chips");
    const onChip = (e: Event) => {
      const b = (e.target as Element).closest("button") as HTMLButtonElement | null; if (!b) return;
      [...chips.children].forEach((x) => x.classList.toggle("on", x === b));
      const q = +b.dataset.q!;
      qn.textContent = q.toLocaleString(); qt.textContent = fmt$(q * 2.36, 2);
      qa.textContent = (q / 1100000 * 100).toFixed(4) + "%"; buy.textContent = `Buy ${q.toLocaleString()} units`;
    };
    chips.addEventListener("click", onChip);
    const onBuy = () => { buy.textContent = "Quote locked · demo"; later(() => (buy.textContent = `Buy ${qn.textContent} units`), 1600); };
    buy.addEventListener("click", onBuy);
    cleanups.push(() => { chips.removeEventListener("click", onChip); buy.removeEventListener("click", onBuy); });
    let left = 12 * 86400 + 4 * 3600 + 11 * 60 + 9;
    const cd = $("cd");
    every(() => {
      left--;
      const d = Math.floor(left / 86400), h = Math.floor(left % 86400 / 3600), m = Math.floor(left % 3600 / 60), s = left % 60;
      cd.textContent = `${d}d ${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
    }, 1000);

    /* ── halftone WebGL plate ── */
    cleanups.push(initHalftone($<HTMLCanvasElement>("halftone"), reduce));

    /* ── B1 scroll choreography: paper → product ── */
    if (!reduce) {
      gsap.registerPlugin(ScrollTrigger);
      const mm = gsap.matchMedia();
      mm.add("(min-width: 961px)", () => {
        const term = $("term");
        gsap.set(term, { borderColor: "rgba(43,41,37,0)" });
        gsap.set(".L .t-chrome", { opacity: 0 });
        gsap.set(".L .t-in", { opacity: 0, y: 14 });
        gsap.set("#fills", { clipPath: "inset(0 0 100% 0)" });
        gsap.set("#chart .ln", { strokeDasharray: 3000, strokeDashoffset: 3000 });
        gsap.set("#chart .area, #chart .vb", { opacity: 0 });
        gsap.timeline({ scrollTrigger: { trigger: "#stage", start: "top 8%", end: "+=1300", scrub: 0.6, pin: true } })
          .to("#paper .paper-head", { opacity: 0, y: -24, duration: 0.4 })
          .to("#paper > div:not(.paper-head) > *", { opacity: 0, y: -18, stagger: 0.04, duration: 0.5 }, "<.05")
          .to(term, { borderColor: "rgba(43,41,37,1)", duration: 0.4 }, "<.2")
          .to(".L .t-chrome", { opacity: 1, duration: 0.4, stagger: 0.05 }, "<")
          .to(".L .t-in", { opacity: 1, y: 0, stagger: 0.05, duration: 0.5 }, "<.1")
          .to("#fills", { clipPath: "inset(0 0 0% 0)", duration: 0.8, ease: "none" }, "<")
          .to("#chart .ln", { strokeDashoffset: 0, duration: 1.2, ease: "none" }, "<.1")
          .to("#chart .area", { opacity: 1, duration: 0.6 }, "<.4")
          .to("#chart .vb", { opacity: 0.28, stagger: 0.006, duration: 0.2 }, "<");
      });
      cleanups.push(() => mm.revert());
    }

    // Board rows and the B1 pin spacer are inserted after Next has already scrolled
    // to a hash target (e.g. /#desk from /news/), so re-align once layout settles.
    if (location.hash) {
      const target = document.getElementById(decodeURIComponent(location.hash.slice(1)));
      if (target) requestAnimationFrame(() => { ScrollTrigger.refresh(); target.scrollIntoView(); });
    }

    return () => {
      cleanups.reverse().forEach((fn) => fn());
      document.querySelectorAll("[data-gen]").forEach((n) => n.remove());
    };
  }, []);

  return null;
}

/** Two-pass WebGL: raymarched terrain luminance → rotated halftone dot screen. Returns cleanup. */
function initHalftone(cv: HTMLCanvasElement, reduce: boolean): () => void {
  const gl = cv.getContext("webgl", { antialias: false });
  if (!gl) return () => {};
  const VS = "attribute vec2 p;void main(){gl_Position=vec4(p,0.,1.);}";
  const FS1 = `precision highp float;
  uniform vec2 r;uniform float t;uniform vec2 m;
  float hh(vec2 p){p=fract(p*vec2(123.34,456.21));p+=dot(p,p+45.32);return fract(p.x*p.y);}
  float n(vec2 p){vec2 i=floor(p),f=fract(p);vec2 u=f*f*(3.-2.*f);
    return mix(mix(hh(i),hh(i+vec2(1,0)),u.x),mix(hh(i+vec2(0,1)),hh(i+vec2(1,1)),u.x),u.y);}
  float H(vec2 p){float a=0.,w=.55;mat2 R=mat2(.8,-.6,.6,.8);
    for(int i=0;i<6;i++){float v=1.-abs(n(p)*2.-1.);a+=w*v*v;p=R*p*2.02;w*=.48;}
    return a*a*2.3;}
  void main(){
    vec2 uv=(gl_FragCoord.xy-.5*r)/r.y;
    vec3 ro=vec3(.0,2.05,t*.32);
    vec3 rd=normalize(vec3(uv.x,uv.y-.13,1.2));
    vec3 sd=normalize(vec3(m.x*1.4-.55,.07+m.y*.10,1.));
    float sun=max(dot(rd,sd),0.);
    float haze=exp(-max(rd.y,0.)*26.);
    float sky=.012+.22*haze+pow(sun,1400.)*2.+pow(sun,60.)*.28;
    float d=.2,hit=-1.;
    for(int i=0;i<150;i++){vec3 p=ro+rd*d;float h=H(p.xz*.30)*.95;float dy=p.y-h;
      if(dy<.0025*d){hit=d;break;} d+=max(.02,dy*.5); if(d>48.)break;}
    float L=sky;
    if(hit>0.){vec3 p=ro+rd*hit;vec2 e=vec2(.03,0.);
      float h0=H(p.xz*.30)*.95;
      vec3 nn=normalize(vec3((H((p.xz+e.xy)*.30)*.95-h0),e.x,(H((p.xz+e.yx)*.30)*.95-h0)));
      float dif=max(dot(nn,normalize(vec3(sd.x,.42,sd.z))),0.);
      L=.01+pow(dif,1.4)*.92;
      L*=.3+.7*smoothstep(-.2,1.8,p.y);
      float fog=1.-exp(-hit*.06);
      L=mix(L,.03+.20*haze,fog);
    }
    gl_FragColor=vec4(clamp(L,0.,1.),0.,0.,1.);
  }`;
  const FS2 = `precision highp float;
  uniform sampler2D tx;uniform vec2 r;uniform float cell;uniform float amt;
  void main(){
    float a=.2618;float c=cos(a),s=sin(a);
    vec2 fc=gl_FragCoord.xy;
    vec2 q=vec2(c*fc.x-s*fc.y,s*fc.x+c*fc.y);
    vec2 ce=(floor(q/cell)+.5)*cell;
    vec2 sc=vec2(c*ce.x+s*ce.y,-s*ce.x+c*ce.y);
    float L=texture2D(tx,clamp(sc/r,0.,1.)).r;
    float wave=clamp(amt*1.6-(1.-sc.y/r.y)*.6,0.,1.);
    float rad=cell*.56*sqrt(L)*wave;
    float ink=1.-smoothstep(rad-.9,rad+.9,length(q-ce));
    vec3 bg=vec3(.024,.024,.02);
    vec3 paper=vec3(.925,.898,.827);
    vec3 green=vec3(.357,.816,.416);
    vec3 col=mix(paper,green,smoothstep(.78,.98,L));
    gl_FragColor=vec4(mix(bg,col,ink),1.);
  }`;
  const sh = (type: number, src: string) => { const s = gl.createShader(type)!; gl.shaderSource(s, src); gl.compileShader(s); return s; };
  const prog = (fs: string) => { const p = gl.createProgram()!; gl.attachShader(p, sh(gl.VERTEX_SHADER, VS)); gl.attachShader(p, sh(gl.FRAGMENT_SHADER, fs)); gl.linkProgram(p); return p; };
  const P1 = prog(FS1), P2 = prog(FS2);
  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  const tex = gl.createTexture(), fb = gl.createFramebuffer();
  let W2 = 0, H2 = 0, tw = 0, th = 0, cell = 6;
  const mouse = { x: 0.62, y: 0.5, tx: 0.62, ty: 0.5 };
  const resize = () => {
    const dpr = Math.min(devicePixelRatio || 1, 2);
    W2 = Math.round(cv.clientWidth * dpr); H2 = Math.round(cv.clientHeight * dpr);
    cv.width = W2; cv.height = H2;
    cell = (innerWidth < 700 ? 5 : 6.5) * dpr;
    tw = Math.ceil(W2 / cell * 2); th = Math.ceil(H2 / cell * 2);
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, tw, th, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
  };
  const t0 = performance.now();
  const draw = (now: number) => {
    const time = now - t0;
    mouse.x += (mouse.tx - mouse.x) * 0.05; mouse.y += (mouse.ty - mouse.y) * 0.05;
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb); gl.viewport(0, 0, tw, th); gl.useProgram(P1);
    let loc = gl.getAttribLocation(P1, "p"); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    gl.uniform2f(gl.getUniformLocation(P1, "r"), tw, th);
    gl.uniform1f(gl.getUniformLocation(P1, "t"), 40 + time * 0.001);
    gl.uniform2f(gl.getUniformLocation(P1, "m"), mouse.x, mouse.y);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.viewport(0, 0, W2, H2); gl.useProgram(P2);
    loc = gl.getAttribLocation(P2, "p"); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    gl.uniform2f(gl.getUniformLocation(P2, "r"), W2, H2);
    gl.uniform1f(gl.getUniformLocation(P2, "cell"), cell);
    gl.uniform1f(gl.getUniformLocation(P2, "amt"), reduce ? 1 : Math.min(1, Math.max(0, (time - 350) / 1900)));
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  };
  resize();
  addEventListener("resize", resize);
  const plate = cv.parentElement!;
  const onMove = (e: PointerEvent) => { const b = cv.getBoundingClientRect(); mouse.tx = (e.clientX - b.left) / b.width; mouse.ty = 1 - (e.clientY - b.top) / b.height; };
  plate.addEventListener("pointermove", onMove);
  let visible = true, raf = 0;
  const io = new IntersectionObserver((es) => (visible = es[0].isIntersecting));
  io.observe(cv);
  if (reduce) draw(t0 + 4000);
  else { const loop = (t: number) => { if (visible) draw(t); raf = requestAnimationFrame(loop); }; raf = requestAnimationFrame(loop); }
  return () => {
    cancelAnimationFrame(raf); io.disconnect();
    removeEventListener("resize", resize); plate.removeEventListener("pointermove", onMove);
  };
}
