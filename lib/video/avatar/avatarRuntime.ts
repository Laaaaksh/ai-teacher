import type { TeacherPersona } from "./personas";

/**
 * A 2D SVG presenter, not a "frozen portrait": idle blink + head-bob motion
 * plus an amplitude-driven viseme approximation for the mouth (no forced
 * phoneme alignment is available from Sarvam TTS, so lip-sync is amplitude
 * bucketed into four mouth shapes rather than true per-phoneme visemes — see
 * docs/VIDEO.md). All motion is a deterministic function of scene time so
 * re-rendering the same scene captures identical frames.
 */
export function renderAvatarSvg(persona: TeacherPersona): string {
  const hair =
    persona.hairStyle === "bun"
      ? `<circle cx="160" cy="70" r="26" fill="${persona.hairColor}"/><path d="M96 150 Q100 60 160 56 Q220 60 224 150 Q224 100 160 96 Q96 100 96 150 Z" fill="${persona.hairColor}"/>`
      : persona.hairStyle === "flow"
        ? `<path d="M84 210 Q76 90 160 76 Q244 90 236 210 Q236 130 160 118 Q84 130 84 210 Z" fill="${persona.hairColor}"/>`
        : `<path d="M100 140 Q104 70 160 66 Q216 70 220 140 Q220 96 160 92 Q100 96 100 140 Z" fill="${persona.hairColor}"/>`;

  return `
<g id="avatar-root">
  <g id="body-group">
    <rect x="130" y="150" width="60" height="50" fill="${persona.skinTone}"/>
    <path d="M60 400 Q60 250 160 244 Q260 250 260 400 Z" fill="${persona.outfitColor}"/>
    <rect x="60" y="380" width="200" height="20" fill="${persona.outfitColor}"/>
    <g id="arm-l-group" transform-origin="118px 270px">
      <path d="M118 270 Q90 300 96 345 Q98 358 118 356 Q110 320 128 280 Z" fill="${persona.outfitColor}"/>
    </g>
    <g id="arm-r-group" transform-origin="202px 270px">
      <path d="M202 270 Q230 300 224 345 Q222 358 202 356 Q210 320 192 280 Z" fill="${persona.outfitColor}"/>
    </g>
  </g>

  <g id="head-group" transform-origin="160px 210px">
    ${persona.hairStyle === "flow" ? hair : ""}
    <ellipse cx="160" cy="150" rx="62" ry="70" fill="${persona.skinTone}"/>
    <ellipse cx="104" cy="155" rx="8" ry="12" fill="${persona.skinTone}"/>
    <ellipse cx="216" cy="155" rx="8" ry="12" fill="${persona.skinTone}"/>
    ${persona.hairStyle !== "flow" ? hair : ""}

    <path id="brow-l" d="M118 122 Q132 112 148 120" stroke="${persona.hairColor}" stroke-width="5" fill="none" stroke-linecap="round"/>
    <path id="brow-r" d="M172 120 Q188 112 202 122" stroke="${persona.hairColor}" stroke-width="5" fill="none" stroke-linecap="round"/>

    <g id="eye-l">
      <ellipse cx="133" cy="140" rx="12" ry="9" fill="#fff"/>
      <circle cx="133" cy="140" r="5" fill="#2a2016"/>
      <rect id="eyelid-l" x="119" y="127" width="28" height="0" fill="${persona.skinTone}"/>
    </g>
    <g id="eye-r">
      <ellipse cx="187" cy="140" rx="12" ry="9" fill="#fff"/>
      <circle cx="187" cy="140" r="5" fill="#2a2016"/>
      <rect id="eyelid-r" x="173" y="127" width="28" height="0" fill="${persona.skinTone}"/>
    </g>

    <path d="M160 148 Q156 168 160 172" stroke="${persona.skinTone === "#8a5a3c" ? "#6e442d" : "#00000022"}" stroke-width="3" fill="none" stroke-linecap="round"/>

    <path id="mouth" d="M138 190 Q160 190 182 190" fill="#7a3230" stroke="#5c211f" stroke-width="2"/>
    <ellipse cx="120" cy="175" rx="10" ry="6" fill="${persona.accentColor}" opacity="0.35"/>
    <ellipse cx="200" cy="175" rx="10" ry="6" fill="${persona.accentColor}" opacity="0.35"/>
  </g>
</g>`.trim();
}

const MOUTH_SHAPES = {
  closed: "M138 190 Q160 190 182 190 Z",
  small: "M140 187 Q160 200 180 187 Q160 194 140 187 Z",
  medium: "M136 184 Q160 208 184 184 Q160 198 136 184 Z",
  wideRound: "M134 182 Q160 214 186 182 Q160 202 134 182 Z",
  wideFlat: "M132 188 Q160 206 188 188 Q160 196 132 188 Z",
};

/**
 * The runtime driving the SVG above. Exposes `window.__avatarStep(tMs)` —
 * called once per captured frame by render.ts (see compose.ts) — which
 * reads the scene's precomputed envelope, updates the mouth shape, blinks,
 * bobs the head, and raises a hand at loud ("emphasis") moments.
 */
export function avatarRuntimeScript(params: { envelope: number[]; envelopeFps: number; sceneSeed: number }): string {
  const envelopeJson = JSON.stringify(params.envelope);

  return `
(function () {
  var ENVELOPE = ${envelopeJson};
  var ENVELOPE_FPS = ${params.envelopeFps};
  var SEED = ${params.sceneSeed};
  var MOUTH = ${JSON.stringify(MOUTH_SHAPES)};

  // Deterministic pseudo-random in [0,1), seeded by scene + a time bucket, so
  // idle motion never repeats identically across scenes but is bit-identical
  // across re-renders of the same scene (required for frame-cache correctness).
  function prand(bucket) {
    var x = Math.sin(SEED * 12.9898 + bucket * 78.233) * 43758.5453;
    return x - Math.floor(x);
  }

  function envelopeAt(tMs) {
    var idx = Math.floor((tMs / 1000) * ENVELOPE_FPS);
    if (idx < 0) idx = 0;
    if (idx >= ENVELOPE.length) idx = ENVELOPE.length - 1;
    return ENVELOPE.length ? ENVELOPE[idx] : 0;
  }

  var lastGestureAt = -Infinity;
  var gestureActive = false;

  window.__avatarStep = function (tMs) {
    var amp = envelopeAt(tMs);
    var mouth = document.getElementById("mouth");
    var eyelidL = document.getElementById("eyelid-l");
    var eyelidR = document.getElementById("eyelid-r");
    var head = document.getElementById("head-group");
    var root = document.getElementById("avatar-root");
    var armR = document.getElementById("arm-r-group");
    var browL = document.getElementById("brow-l");
    var browR = document.getElementById("brow-r");
    if (!mouth) return;

    // --- Mouth: amplitude-bucketed viseme approximation ---
    var shapeBucket = Math.floor(tMs / 90); // re-pick a mouth shape at most every 90ms
    var variant = prand(shapeBucket) > 0.5 ? "wideRound" : "wideFlat";
    var d;
    if (amp < 0.08) d = MOUTH.closed;
    else if (amp < 0.32) d = MOUTH.small;
    else if (amp < 0.6) d = MOUTH.medium;
    else d = MOUTH[variant];
    mouth.setAttribute("d", d);

    // --- Blink: ~every 2.5-6s, seeded per-scene, 120ms closed ---
    var blinkPeriod = 2500 + prand(1) * 3500;
    var blinkPhase = tMs % blinkPeriod;
    var eyelidHeight = blinkPhase < 120 ? 16 : 0;
    if (eyelidL) eyelidL.setAttribute("height", String(eyelidHeight));
    if (eyelidR) eyelidR.setAttribute("height", String(eyelidHeight));

    // --- Idle head bob + subtle sway, plus a small extra bob while talking ---
    var t = tMs / 1000;
    var swayDeg = Math.sin(t * 0.6 + SEED) * 1.6;
    var bobPx = Math.sin(t * 1.8 + SEED) * 1.5 + amp * 2.2;
    if (head) head.setAttribute("transform", "translate(0 " + bobPx.toFixed(2) + ") rotate(" + swayDeg.toFixed(2) + " 160 210)");
    if (root) root.setAttribute("transform", "translate(0 " + (Math.sin(t * 0.9 + SEED) * 1.2).toFixed(2) + ")");

    // --- Eyebrow raise + hand gesture on emphasis (a sustained loud moment) ---
    var emphasis = amp > 0.72;
    var browLift = emphasis ? -4 : 0;
    if (browL) browL.setAttribute("transform", "translate(0 " + browLift + ")");
    if (browR) browR.setAttribute("transform", "translate(0 " + browLift + ")");

    if (emphasis && !gestureActive && tMs - lastGestureAt > 2200) {
      gestureActive = true;
      lastGestureAt = tMs;
    }
    if (gestureActive && tMs - lastGestureAt > 700) {
      gestureActive = false;
    }
    if (armR) {
      var gestureT = gestureActive ? Math.min(1, (tMs - lastGestureAt) / 350) : 0;
      var raiseDeg = gestureActive ? -Math.sin(gestureT * Math.PI) * 34 : 0;
      armR.setAttribute("transform", "rotate(" + raiseDeg.toFixed(2) + " 202 270)");
    }
  };
})();`.trim();
}
