import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';

// Landmark indices taken from the canonical MediaPipe FaceMesh topology.
// The offsetX/offsetY values below predate these indices and have NOT been
// re-calibrated against the live camera — verify each one before relying on it.
const PIERCING_POINTS = {
  leftNostril: { label: 'Left Nostril', index: 129, offsetX: 0, offsetY: 0 },
  rightNostril: { label: 'Right Nostril', index: 358, offsetX: 0, offsetY: 15 },
  septum: { label: 'Septum', index: 2, offsetX: 0, offsetY: 0 },
  leftEyebrow: { label: 'Left Eyebrow', index: 105, offsetX: 0, offsetY: 0 },
  rightEyebrow: { label: 'Right Eyebrow', index: 334, offsetX: 0, offsetY: 0 },
  lowerLip: { label: 'Lower Lip', index: 17, offsetX: 0, offsetY: 0 },
};

// Jewelry styles per piercing point. Images are transparent PNGs pinned to the
// landmark; actual draw size scales with the live face width.
//
// Every entry sizes itself with `widthRatio`, a face-width ratio in the same
// space as the Adjust sliders. Offset still resolves two ways (see
// configPlacement): a per-style `offset: [x, y]` (also face-width ratios)
// when present, else the per-position offsetX/offsetY in PIERCING_POINTS.
//
// Optional per-style fields:
//   rotationOffset  degrees, default 0. Corrects a source PNG shot at the wrong
//                   orientation — e.g. a curved barbell photographed vertically.
//                   Added to the head-roll angle, spinning the sprite about its
//                   own pivot, so it never shifts placement.
//   anchor          [ax, ay] in normalized image coords, default [0.5, 0.5]
//                   (centered). Names the point of the PNG that lands on the
//                   landmark, letting a piece hang off its pivot the way real
//                   jewelry hangs off the hole rather than sitting on top of it.
//   mirror          flips the sprite horizontally about its anchor, for pieces
//                   whose left- and right-side versions are the same asset.

// Vite rewrites root-absolute URLs inside index.html to carry the base path,
// but not string literals in JS — so a bare '/jewelry/x.png' 404s once the site
// is served from the /face-tracker/ sub-path. BASE_URL keeps these correct in
// dev ('/') and on Pages ('/face-tracker/') alike.
const jewelryAsset = (file) => `${import.meta.env.BASE_URL}jewelry/${file}`;

// nostril-hoop.png is an open ring with its post-and-ball at the top right.
// That post is what passes through the piercing, so pinning the landmark there
// — rather than at the ring's center — lets the visible curve hang down and
// outward off the nostril edge. One value serves both sides: `mirror` flips the
// sprite about this same point, swapping which way the curve falls.
const NOSTRIL_HOOP_ANCHOR = [0.78, 0.12];

const JEWELRY = {
  leftNostril: [
    { id: 'stud', label: 'Stud', src: jewelryAsset('nostril-stud.png'), widthRatio: 0.045, offset: [0.024, 0.055] },
    { id: 'hoop', label: 'Small Hoop', src: jewelryAsset('nostril-hoop.png'), widthRatio: 0.073, offset: [0.024, 0.055], anchor: NOSTRIL_HOOP_ANCHOR },
  ],
  rightNostril: [
    { id: 'stud', label: 'Stud', src: jewelryAsset('nostril-stud.png'), widthRatio: 0.045, offset: [-0.059, 0.066] },
    { id: 'hoop', label: 'Small Hoop', src: jewelryAsset('nostril-hoop.png'), widthRatio: 0.073, offset: [-0.059, 0.066], anchor: NOSTRIL_HOOP_ANCHOR, mirror: true },
  ],
  septum: [
    { id: 'ring', label: 'Ring', src: jewelryAsset('septum-ring.png'), widthRatio: 0.091 },
    { id: 'horseshoe', label: 'Horseshoe', src: jewelryAsset('septum-horseshoe.png'), widthRatio: 0.091 },
    { id: 'hoop', label: 'Small Hoop', src: jewelryAsset('septum-hoop.png'), widthRatio: 0.064 },
  ],
  leftEyebrow: [
    { id: 'straight', label: 'Straight Barbell', src: jewelryAsset('barbell-straight.png'), widthRatio: 0.118, offset: [-0.071, -0.055] },
    { id: 'curved', label: 'Curved Barbell', src: jewelryAsset('barbell-curved.png'), widthRatio: 0.118, offset: [-0.071, -0.055] },
  ],
  rightEyebrow: [
    { id: 'straight', label: 'Straight Barbell', src: jewelryAsset('barbell-straight.png'), widthRatio: 0.118, offset: [0.071, -0.055] },
    { id: 'curved', label: 'Curved Barbell', src: jewelryAsset('barbell-curved.png'), widthRatio: 0.118, offset: [0.071, -0.055] },
  ],
  lowerLip: [
    { id: 'stud', label: 'Stud', src: jewelryAsset('lip-stud.png'), widthRatio: 0.045 },
    { id: 'ring', label: 'Small Ring', src: jewelryAsset('lip-ring.png'), widthRatio: 0.064 },
  ],
};

// jewelryFor('septum') -> all styles for that point.
// jewelryFor('septum', 'ring') -> the single matching style, or undefined.
const jewelryFor = (pointKey, styleId) => {
  const styles = JEWELRY[pointKey];
  if (!styles) return undefined;
  if (styleId === undefined) return styles;
  return styles.find((s) => s.id === styleId);
};

// ---- Module-level asset preload ----
// Keyed by src so draw code and swatches share one decoded-image cache.
const JEWELRY_SOURCES = [...new Set(Object.values(JEWELRY).flatMap((styles) => styles.map((s) => s.src)))];

const IMAGES = {};

JEWELRY_SOURCES.forEach((src) => {
  const img = new Image();
  const entry = { img, ready: false, width: 0, height: 0 };
  IMAGES[src] = entry;
  img.src = src;
  img
    .decode()
    .then(() => {
      entry.ready = true;
      entry.width = img.naturalWidth;
      entry.height = img.naturalHeight;
    })
    .catch(() => {
      // Leave ready=false; drawing stays gated off for this asset.
    });
});

// Tragus-to-tragus (234/454) approximates full face width and is stable
// under expression changes, unlike eye or mouth landmarks.
const TRAGUS_LEFT = 234;
const TRAGUS_RIGHT = 454;

// The nose tip protrudes, so turning the head sweeps it laterally toward
// whichever side is rotating away from the camera. Its drift from the tragus
// midpoint, over face width, is a cheap yaw proxy that needs no 3D solve.
const NOSE_TIP = 1;

// Fraction of face width the nose may drift before the receding side's
// jewelry is hidden. Raise to keep pieces visible further into a turn.
const YAW_THRESHOLD = 0.15;

// Which side each piercing sits on, in the same sense as TRAGUS_LEFT/RIGHT.
// Centered positions (septum, lowerLip) are absent and always draw.
const POSITION_SIDE = {
  leftNostril: 'left',
  leftEyebrow: 'left',
  rightNostril: 'right',
  rightEyebrow: 'right',
};

// Calibration baseline: the px offsetX/offsetY in PIERCING_POINTS are tuned
// for a face this many px wide (tragus-to-tragus) in canvas device-pixel
// space, and the live face width divides by it to give the draw scale.
const REFERENCE_FACE_WIDTH = 220;

// Normalizes placement to face-width ratios. Sizes are already ratios; a
// style without its own `offset` falls back to the per-position px offsets,
// divided down into the same ratio space.
const configPlacement = (point, style) => ({
  offsetX: style.offset ? style.offset[0] : point.offsetX / REFERENCE_FACE_WIDTH,
  offsetY: style.offset ? style.offset[1] : point.offsetY / REFERENCE_FACE_WIDTH,
  widthRatio: style.widthRatio,
  rotationOffset: style.rotationOffset ?? 0,
});

// ---- User adjustments (the Adjust panel in App.jsx) ----
// A piece the user has nudged keeps tracking its landmark exactly as before;
// only the offset/size/rotation numbers feeding that math get replaced. Keyed
// per position+style so every piece adjusts independently, and so switching
// styles and coming back returns to what the user set.
const adjustmentKey = (positionKey, styleId) => `${positionKey}:${styleId}`;

// Seeds the sliders from whatever the config currently holds, in the same
// face-width ratio space the sliders work in.
const defaultAdjustment = (positionKey, styleId) => {
  const point = PIERCING_POINTS[positionKey];
  const style = jewelryFor(positionKey, styleId);
  if (!point || !style) return null;
  return configPlacement(point, style);
};

const EMA_ALPHA = 0.35;

const emptyEma = () => ({ width: null, angle: null, yaw: null, points: {} });

const emaLerp = (prev, next) => (prev === null ? next : prev + EMA_ALPHA * (next - prev));

// Shortest-path angle smoothing avoids a snap when the raw angle wraps past +-pi.
const emaLerpAngle = (prev, next) => {
  if (prev === null) return next;
  const delta = Math.atan2(Math.sin(next - prev), Math.cos(next - prev));
  return prev + EMA_ALPHA * delta;
};

// Fakes the small contact shadow real jewelry casts, so a piece reads as
// sitting on skin rather than pasted over it. Both are fractions of the live
// face width, which is already in canvas device px — no separate DPR term.
const SHADOW_COLOR = 'rgba(0,0,0,0.5)';
const SHADOW_BLUR_RATIO = 0.015;
const SHADOW_OFFSET_Y_RATIO = 0.008;

// Just shy of opaque, so the hard PNG cutout edge doesn't knife against skin.
const JEWELRY_ALPHA = 0.96;

// Where the landmark sits on the sprite when a style names no `anchor`.
const DEFAULT_ANCHOR = [0.5, 0.5];

// How much of the sprite's larger dimension counts as grabbable, as a radius
// about its drawn center.
const GRAB_RADIUS_RATIO = 0.6;

// Returns where the artwork actually landed — center and grab radius in canvas
// px — so drag hit-testing can reuse the geometry instead of recomputing it.
const drawJewelry = (
  ctx,
  entry,
  drawWidthAtReference,
  x,
  y,
  scale,
  angle,
  { rotationOffset = 0, anchor = DEFAULT_ANCHOR, mirror = false } = {},
) => {
  const drawWidth = drawWidthAtReference * scale;
  const aspect = entry.height / entry.width;
  const drawHeight = drawWidth * aspect;
  // scale is the smoothed face width over the reference, so this recovers that
  // width in canvas px — the unit the shadow ratios above are expressed in.
  const faceWidth = scale * REFERENCE_FACE_WIDTH;
  const rotation = angle + (rotationOffset * Math.PI) / 180;

  ctx.save();
  ctx.translate(x, y);
  // Head roll plus the per-style orientation fix. Applied after translate, so
  // it rotates the sprite about its anchor and leaves placement untouched.
  ctx.rotate(rotation);
  // Innermost, so it flips the artwork about the anchor without reversing the
  // sense of the rotation above — a mirrored piece still rolls with the head.
  if (mirror) ctx.scale(-1, 1);

  // Canvas shadow offsets ignore the current transform, so the shadow keeps
  // falling straight down on screen as the head rolls — which is what overhead
  // lighting would do anyway. globalAlpha multiplies the shadow too, leaving it
  // a touch under the 0.5 in SHADOW_COLOR.
  ctx.shadowColor = SHADOW_COLOR;
  ctx.shadowBlur = faceWidth * SHADOW_BLUR_RATIO;
  ctx.shadowOffsetX = 0;
  ctx.shadowOffsetY = faceWidth * SHADOW_OFFSET_Y_RATIO;
  ctx.globalAlpha = JEWELRY_ALPHA;

  // Anchor is a fraction of the sprite, so the named point lands on the origin
  // — i.e. on the landmark — whatever the piece's size or aspect.
  ctx.drawImage(entry.img, -drawWidth * anchor[0], -drawHeight * anchor[1], drawWidth, drawHeight);

  // The restore() below already unwinds these. Cleared explicitly as well so no
  // shadow can stack or bleed onto the next piece if that pairing ever changes.
  ctx.shadowColor = 'transparent';
  ctx.shadowBlur = 0;
  ctx.shadowOffsetX = 0;
  ctx.shadowOffsetY = 0;
  ctx.globalAlpha = 1;

  ctx.restore();

  // The anchor can sit well off the sprite's middle — a nose hoop hangs below
  // its post — so a drag has to aim at the drawn artwork, not the landmark.
  // Same rotation the sprite got, and the mirror flips which side it leans to.
  const localX = (0.5 - anchor[0]) * drawWidth * (mirror ? -1 : 1);
  const localY = (0.5 - anchor[1]) * drawHeight;
  const cos = Math.cos(rotation);
  const sin = Math.sin(rotation);

  const extent = Math.max(drawWidth, drawHeight) / 2;

  return {
    x: x + localX * cos - localY * sin,
    y: y + localX * sin + localY * cos,
    radius: extent * 2 * GRAB_RADIUS_RATIO,
    // The gizmo needs the piece's half-size to orbit, and its rotation so the
    // handles ride around with it.
    extent,
    rotation,
  };
};

// ---- Drag-to-position ----
// Smallest grab target, in CSS px, so a stud stays catchable on a phone even
// though it draws only a few pixels across.
const MIN_GRAB_RADIUS = 26;

// Only the <video> is CSS-mirrored; the overlay canvas carries no transform and
// the draw loop already flipped landmarks with (1 - x), so it is *already* in
// mirrored screen space. Pointer coords therefore map straight across — the
// only conversion needed is CSS px to the canvas's device-pixel backing store,
// which is also what keeps this correct under devicePixelRatio.
const canvasPoint = (canvas, event) => {
  const rect = canvas.getBoundingClientRect();
  if (rect.width === 0 || rect.height === 0) return null;
  return {
    x: (event.clientX - rect.left) * (canvas.width / rect.width),
    y: (event.clientY - rect.top) * (canvas.height / rect.height),
    perCssPx: canvas.width / rect.width,
  };
};

// Nearest drawn piece within its grab radius, or null. Overlapping pieces
// resolve to whichever center the pointer is closest to.
const nearestPiece = (pieces, point) => {
  const floor = MIN_GRAB_RADIUS * point.perCssPx;
  let best = null;
  let bestDistance = Infinity;

  pieces.forEach((piece) => {
    const distance = Math.hypot(point.x - piece.x, point.y - piece.y);
    if (distance > Math.max(piece.radius, floor)) return;
    if (distance >= bestDistance) return;
    bestDistance = distance;
    best = piece;
  });

  return best;
};

// ---- Selected-piece gizmo ----
// Sizes are CSS px, scaled to device px at draw time. The grips stay small so
// they don't bury the jewelry; the hit radius is much larger so they stay
// thumb-sized on a phone.
const HANDLE_GAP = 12;
const HANDLE_RADIUS = 8;
const HANDLE_HIT_RADIUS = 22;

// Mirrors --amber / --bar in App.css; canvas can't read CSS custom properties.
const HANDLE_AMBER = '#ffcc00';
const HANDLE_DARK = '#101010';
const HANDLE_RIM = 'rgba(0, 0, 0, 0.55)';

// Resize sits down-right of the piece and rotate up-right, both carried around
// by the piece's own rotation so the gizmo reads as attached to it.
const HANDLE_LAYOUT = [
  { kind: 'resize', angle: Math.PI / 4 },
  { kind: 'rotate', angle: -Math.PI / 4 },
];

const pieceHandles = (piece, dpr) => {
  const orbit = piece.extent + HANDLE_GAP * dpr;
  return HANDLE_LAYOUT.map(({ kind, angle }) => {
    const around = piece.rotation + angle;
    return {
      kind,
      x: piece.x + orbit * Math.cos(around),
      y: piece.y + orbit * Math.sin(around),
    };
  });
};

const drawHandles = (ctx, piece, handles, dpr) => {
  const orbit = piece.extent + HANDLE_GAP * dpr;

  ctx.save();

  // Faint ring frames the selection and shows what the grips are attached to,
  // without competing with the jewelry it surrounds.
  ctx.strokeStyle = HANDLE_AMBER;
  ctx.globalAlpha = 0.35;
  ctx.lineWidth = Math.max(dpr, 1);
  ctx.beginPath();
  ctx.arc(piece.x, piece.y, orbit, 0, Math.PI * 2);
  ctx.stroke();
  ctx.globalAlpha = 1;

  handles.forEach(({ kind, x, y }) => {
    // Filled vs hollow is what tells the two apart at grip size — an icon would
    // be illegible in 8px.
    const filled = kind === 'resize';
    ctx.beginPath();
    ctx.arc(x, y, HANDLE_RADIUS * dpr, 0, Math.PI * 2);
    ctx.fillStyle = filled ? HANDLE_AMBER : HANDLE_DARK;
    ctx.fill();
    ctx.strokeStyle = filled ? HANDLE_RIM : HANDLE_AMBER;
    ctx.lineWidth = Math.max(1.5 * dpr, 1);
    ctx.stroke();
  });

  ctx.restore();
};

// Grips beat the piece body, so grabbing one transforms rather than moves.
const handleAt = (handles, point) => {
  const limit = HANDLE_HIT_RADIUS * point.perCssPx;
  let best = null;
  let bestDistance = Infinity;

  handles.forEach((handle) => {
    const distance = Math.hypot(point.x - handle.x, point.y - handle.y);
    if (distance > limit || distance >= bestDistance) return;
    bestDistance = distance;
    best = handle;
  });

  return best;
};

// Keeps a resized piece from vanishing or swallowing the frame.
const MIN_WIDTH_RATIO = 0.012;
const MAX_WIDTH_RATIO = 0.25;

const clamp = (value, min, max) => Math.min(Math.max(value, min), max);

// Shortest path around the circle, so a drag across +-pi doesn't jump.
const wrapAngle = (radians) => Math.atan2(Math.sin(radians), Math.cos(radians));

const normalizeDegrees = (degrees) => ((((degrees + 180) % 360) + 360) % 360) - 180;

const FaceTracker = forwardRef(function FaceTracker(
  {
    activeStyles = {},
    adjustments = {},
    adjustMode = false,
    selectedPosition = null,
    onPieceSelect,
    onPieceAdjust,
  },
  ref,
) {
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  // Handles live on their own canvas stacked above the jewelry: capturePhoto
  // composites only canvasRef, so the gizmo can never end up in a saved photo.
  const gizmoRef = useRef(null);
  const cameraRef = useRef(null);
  const faceMeshRef = useRef(null);
  const animationFrameRef = useRef(null);
  const activeStylesRef = useRef(activeStyles);
  const adjustmentsRef = useRef(adjustments);
  const emaRef = useRef(emptyEma());
  const lastSizeRef = useRef({ width: 0, height: 0 });
  const selectedRef = useRef(selectedPosition);
  // Last frame's drawn pieces, in canvas px — the drag's hit targets.
  const drawnRef = useRef([]);
  // Grips for the selected piece, empty when nothing is selected or the
  // selected piece isn't on screen this frame.
  const handlesRef = useRef([]);
  const dragRef = useRef(null);
  const [error, setError] = useState(null);
  const [dragging, setDragging] = useState(false);

  useEffect(() => {
    activeStylesRef.current = activeStyles;
  }, [activeStyles]);

  // Mirrors activeStyles: held in a ref so slider drags reach the running
  // draw loop without tearing down and re-creating the FaceMesh pipeline.
  useEffect(() => {
    adjustmentsRef.current = adjustments;
  }, [adjustments]);

  useEffect(() => {
    selectedRef.current = selectedPosition;
  }, [selectedPosition]);

  // Leaving Adjust mode mid-drag would otherwise strand the drag: the canvas
  // goes inert and no pointerup arrives to clear it.
  useEffect(() => {
    if (adjustMode) return;
    dragRef.current = null;
    setDragging(false);
  }, [adjustMode]);

  useImperativeHandle(ref, () => ({
    capturePhoto: () => {
      const video = videoRef.current;
      const canvas = canvasRef.current;
      if (!video || !canvas || canvas.width === 0 || video.videoWidth === 0) return null;

      const exportCanvas = document.createElement('canvas');
      exportCanvas.width = video.videoWidth;
      exportCanvas.height = video.videoHeight;
      const ctx = exportCanvas.getContext('2d');

      ctx.save();
      ctx.translate(exportCanvas.width, 0);
      ctx.scale(-1, 1);
      ctx.drawImage(video, 0, 0, exportCanvas.width, exportCanvas.height);
      ctx.restore();

      // Overlay canvas resolution (rect * dpr) differs from the video's
      // native resolution, so scale it into the export frame.
      ctx.drawImage(
        canvas,
        0, 0, canvas.width, canvas.height,
        0, 0, exportCanvas.width, exportCanvas.height,
      );

      return exportCanvas.toDataURL('image/png');
    },
  }));

  useEffect(() => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) return;

    let cancelled = false;
    let stream = null;
    let processing = false;
    let resizeObserver = null;

    const syncCanvasSize = () => {
      const rect = video.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return;

      const dpr = window.devicePixelRatio || 1;
      const width = Math.round(rect.width * dpr);
      const height = Math.round(rect.height * dpr);
      // Both layers share one coordinate space, so pointer math on the gizmo
      // canvas applies unchanged to what was drawn on the jewelry canvas.
      const layers = [canvas, gizmoRef.current].filter(Boolean);

      if (width !== lastSizeRef.current.width || height !== lastSizeRef.current.height) {
        layers.forEach((layer) => {
          layer.width = width;
          layer.height = height;
        });
        lastSizeRef.current = { width, height };
      }

      layers.forEach((layer) => {
        layer.style.width = `${rect.width}px`;
        layer.style.height = `${rect.height}px`;
      });
    };

    const init = async () => {
      if (!navigator.mediaDevices?.getUserMedia) {
        setError('Webcam access is not supported in this browser.');
        return;
      }

      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } },
        });

        if (cancelled) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }

        video.srcObject = stream;
        await video.play();
        syncCanvasSize();
        video.addEventListener('loadedmetadata', syncCanvasSize);

        resizeObserver = new ResizeObserver(syncCanvasSize);
        resizeObserver.observe(video);

        const faceMesh = new window.FaceMesh({
          locateFile: (file) =>
            `https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh@0.4.1633559619/${file}`,
        });

        faceMesh.setOptions({
          maxNumFaces: 1,
          refineLandmarks: true,
          minDetectionConfidence: 0.5,
          minTrackingConfidence: 0.5,
        });

        faceMesh.onResults((results) => {
          const ctx = canvas.getContext('2d');
          if (!ctx) return;

          const gizmo = gizmoRef.current;
          const gizmoCtx = gizmo?.getContext('2d') ?? null;

          ctx.clearRect(0, 0, canvas.width, canvas.height);
          // Cleared up front so every early return below leaves no stale grips.
          if (gizmoCtx) gizmoCtx.clearRect(0, 0, gizmo.width, gizmo.height);
          handlesRef.current = [];

          const landmarks = results.multiFaceLandmarks?.[0];
          if (!landmarks) {
            emaRef.current = emptyEma();
            drawnRef.current = [];
            return;
          }

          const left = landmarks[TRAGUS_LEFT];
          const right = landmarks[TRAGUS_RIGHT];
          if (!left || !right) {
            emaRef.current = emptyEma();
            drawnRef.current = [];
            return;
          }

          const lx = (1 - left.x) * canvas.width;
          const ly = left.y * canvas.height;
          const rx = (1 - right.x) * canvas.width;
          const ry = right.y * canvas.height;

          const ema = emaRef.current;
          const rawWidth = Math.hypot(rx - lx, ry - ly);
          const rawAngle = Math.atan2(ry - ly, rx - lx);

          ema.width = emaLerp(ema.width, rawWidth);
          ema.angle = emaLerpAngle(ema.angle, rawAngle);

          // Head-yaw gate. lx/rx already carry the (1 - x) mirror flip, so
          // taking the leftward direction from them keeps the sign right
          // without assuming which screen edge TRAGUS_LEFT lands on.
          // Smoothed like the rest so a face sitting on the threshold does
          // not flicker the jewelry on and off frame to frame.
          const nose = landmarks[NOSE_TIP];
          if (nose && ema.width > 0) {
            const nx = (1 - nose.x) * canvas.width;
            const leftward = lx > rx ? 1 : -1;
            const rawYaw = ((nx - (lx + rx) / 2) * leftward) / ema.width;
            ema.yaw = emaLerp(ema.yaw, rawYaw);
          }

          // Positive yaw = nose swung toward the TRAGUS_LEFT side = that side
          // has rotated away from the camera.
          const yaw = ema.yaw ?? 0;
          let hiddenSide = null;
          if (yaw > YAW_THRESHOLD) hiddenSide = 'left';
          else if (yaw < -YAW_THRESHOLD) hiddenSide = 'right';

          const scale = ema.width / REFERENCE_FACE_WIDTH;
          const cos = Math.cos(ema.angle);
          const sin = Math.sin(ema.angle);
          const active = activeStylesRef.current;
          const adjusted = adjustmentsRef.current;
          const drag = dragRef.current;
          const drawn = [];

          Object.entries(PIERCING_POINTS).forEach(([key, point]) => {
            const styleId = active[key];
            if (!styleId) {
              delete ema.points[key];
              return;
            }

            // On the side that has turned away. Dropping the smoothed point
            // makes it re-seed at its true position when the head comes back
            // instead of sliding in from a stale one.
            if (hiddenSide && POSITION_SIDE[key] === hiddenSide) {
              delete ema.points[key];
              return;
            }

            const style = jewelryFor(key, styleId);
            if (!style) return;

            const asset = IMAGES[style.src];
            if (!asset || !asset.ready) return;

            const lm = landmarks[point.index];
            if (!lm) return;

            // A user adjustment beats the config; both are face-width ratios,
            // converted back to px at reference here so the rest of the
            // pipeline keeps its existing units.
            const placement = adjusted[adjustmentKey(key, styleId)] ?? configPlacement(point, style);
            const widthAtReference = placement.widthRatio * REFERENCE_FACE_WIDTH;

            const ox = placement.offsetX * REFERENCE_FACE_WIDTH * scale;
            const oy = placement.offsetY * REFERENCE_FACE_WIDTH * scale;
            const rotOx = ox * cos - oy * sin;
            const rotOy = ox * sin + oy * cos;

            const rawX = (1 - lm.x) * canvas.width + rotOx;
            const rawY = lm.y * canvas.height + rotOy;

            // The piece under an active drag skips position smoothing: at this
            // alpha it would trail the finger by a few frames, which reads as
            // broken under direct manipulation. Writing the raw point back into
            // the EMA means smoothing resumes from here on release, no snap.
            const held = drag !== null && drag.key === key;
            const prev = ema.points[key] ?? null;
            const smoothedX = prev === null || held ? rawX : prev.x + EMA_ALPHA * (rawX - prev.x);
            const smoothedY = prev === null || held ? rawY : prev.y + EMA_ALPHA * (rawY - prev.y);
            ema.points[key] = { x: smoothedX, y: smoothedY };

            const hit = drawJewelry(
              ctx, asset, widthAtReference, smoothedX, smoothedY, scale, ema.angle,
              {
                // Rotation is user-adjustable, so it comes off the placement;
                // anchor and mirror are fixed properties of the artwork.
                rotationOffset: placement.rotationOffset,
                anchor: style.anchor,
                mirror: style.mirror,
              },
            );

            // The current placement rides along so every drag continues from
            // where the piece already sits rather than from its config default.
            drawn.push({
              key,
              styleId,
              x: hit.x,
              y: hit.y,
              radius: hit.radius,
              extent: hit.extent,
              rotation: hit.rotation,
              offsetX: placement.offsetX,
              offsetY: placement.offsetY,
              widthRatio: placement.widthRatio,
              rotationOffset: placement.rotationOffset,
            });
          });

          drawnRef.current = drawn;

          // After the pieces, and on the layer above, so the grips are never
          // buried by jewelry drawn later in the loop.
          const selected = drawn.find((piece) => piece.key === selectedRef.current);
          if (gizmoCtx && selected) {
            const dpr = window.devicePixelRatio || 1;
            const handles = pieceHandles(selected, dpr);
            handlesRef.current = handles;
            drawHandles(gizmoCtx, selected, handles, dpr);
          }
        });

        faceMeshRef.current = faceMesh;

        const onFrame = async () => {
          await faceMesh.send({ image: video });
        };

        const camera = new window.Camera(video, { onFrame, width: 640, height: 480 });
        cameraRef.current = camera;

        const processFrame = async () => {
          if (cancelled) return;
          animationFrameRef.current = requestAnimationFrame(processFrame);

          if (processing || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) return;

          processing = true;
          try {
            await onFrame();
          } finally {
            processing = false;
          }
        };

        processFrame();
      } catch (err) {
        stream?.getTracks().forEach((track) => track.stop());
        if (err?.name === 'NotAllowedError' || err?.name === 'PermissionDeniedError') {
          setError('Webcam permission denied. Please allow camera access and refresh the page.');
        } else if (err?.name === 'NotFoundError') {
          setError('No webcam found. Please connect a camera and try again.');
        } else {
          setError('Failed to access the webcam. Please try again.');
        }
      }
    };

    init();

    return () => {
      cancelled = true;
      resizeObserver?.disconnect();
      video.removeEventListener('loadedmetadata', syncCanvasSize);

      if (animationFrameRef.current !== null) {
        cancelAnimationFrame(animationFrameRef.current);
        animationFrameRef.current = null;
      }

      stream?.getTracks().forEach((track) => track.stop());
      video.srcObject = null;
      cameraRef.current = null;
      faceMeshRef.current?.close();
      faceMeshRef.current = null;
      emaRef.current = emptyEma();
    };
  }, []);

  const handlePointerDown = (event) => {
    const gizmo = gizmoRef.current;
    if (!adjustMode || !gizmo) return;

    const point = canvasPoint(gizmo, event);
    if (!point) return;

    // Grips are tested first, so grabbing one transforms the piece instead of
    // dragging it out from under the gizmo.
    const grip = handleAt(handlesRef.current, point);
    const selected = grip
      ? drawnRef.current.find((piece) => piece.key === selectedRef.current)
      : null;
    const piece = selected ?? nearestPiece(drawnRef.current, point);

    if (!piece) {
      // A press on bare canvas drops the selection, which is the only way back
      // to showing no handles at all.
      onPieceSelect?.(null);
      return;
    }

    event.preventDefault();
    gizmo.setPointerCapture(event.pointerId);

    const ema = emaRef.current;
    dragRef.current = {
      pointerId: event.pointerId,
      mode: grip ? grip.kind : 'move',
      key: piece.key,
      styleId: piece.styleId,
      startX: point.x,
      startY: point.y,
      baseOffsetX: piece.offsetX,
      baseOffsetY: piece.offsetY,
      baseWidthRatio: piece.widthRatio,
      baseRotationOffset: piece.rotationOffset,
      // Guarded against a zero divisor if the grip is grabbed dead-center.
      startDistance: Math.max(Math.hypot(point.x - piece.x, point.y - piece.y), 1),
      startPointerAngle: Math.atan2(point.y - piece.y, point.x - piece.x),
      startFaceAngle: ema.angle ?? 0,
    };
    setDragging(true);
    onPieceSelect?.(piece.key, piece.styleId);
  };

  const handlePointerMove = (event) => {
    const drag = dragRef.current;
    const gizmo = gizmoRef.current;
    if (!drag || drag.pointerId !== event.pointerId || !gizmo) return;

    const ema = emaRef.current;
    if (!ema.width) return;

    const point = canvasPoint(gizmo, event);
    if (!point) return;

    if (drag.mode === 'move') {
      // The draw loop places a piece at landmark + R(angle) * offset *
      // faceWidth, so inverting that turns a screen-space drag back into offset
      // units: undo the head roll, then divide out the face width. Both come
      // from the live EMA rather than being frozen at pointerdown, so the piece
      // stays under the finger even if the head rolls or moves closer mid-drag.
      const dx = point.x - drag.startX;
      const dy = point.y - drag.startY;
      const angle = ema.angle ?? 0;
      const cos = Math.cos(angle);
      const sin = Math.sin(angle);

      onPieceAdjust?.(drag.key, drag.styleId, {
        offsetX: drag.baseOffsetX + (dx * cos + dy * sin) / ema.width,
        offsetY: drag.baseOffsetY + (-dx * sin + dy * cos) / ema.width,
      });
      return;
    }

    // Resize and rotate both measure against the piece's live center, so they
    // stay honest while the face keeps moving underneath.
    const piece = drawnRef.current.find((entry) => entry.key === drag.key);
    if (!piece) return;

    if (drag.mode === 'resize') {
      const distance = Math.hypot(point.x - piece.x, point.y - piece.y);
      onPieceAdjust?.(drag.key, drag.styleId, {
        widthRatio: clamp(
          drag.baseWidthRatio * (distance / drag.startDistance),
          MIN_WIDTH_RATIO,
          MAX_WIDTH_RATIO,
        ),
      });
      return;
    }

    // rotationOffset is added on top of head roll, so the roll that happened
    // during the drag has to come back out — otherwise a head tilt counts twice
    // and the grip slides away from the finger.
    const pointerDelta = wrapAngle(
      Math.atan2(point.y - piece.y, point.x - piece.x) - drag.startPointerAngle,
    );
    const rollDelta = wrapAngle((ema.angle ?? 0) - drag.startFaceAngle);

    onPieceAdjust?.(drag.key, drag.styleId, {
      rotationOffset: normalizeDegrees(
        drag.baseRotationOffset + ((pointerDelta - rollDelta) * 180) / Math.PI,
      ),
    });
  };

  const handlePointerUp = (event) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;

    dragRef.current = null;
    setDragging(false);
    gizmoRef.current?.releasePointerCapture?.(event.pointerId);
  };

  return (
    <div style={{ position: 'relative', width: '100%', display: 'block' }}>
      {error ? (
        <p role="alert" style={{ color: '#e5484d', padding: '0 12px' }}>
          {error}
        </p>
      ) : null}
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted
        style={{
          display: 'block',
          width: '100%',
          height: 'auto',
          borderRadius: 14,
          transform: 'scaleX(-1)',
          backgroundColor: '#000',
        }}
      />
      {/* Jewelry layer. capturePhoto composites exactly this canvas, so it
          holds the try-on and nothing else. */}
      <canvas
        ref={canvasRef}
        style={{ position: 'absolute', top: 0, left: 0, pointerEvents: 'none' }}
      />
      {/* Gizmo layer: handles, and every pointer interaction. Same size and
          coordinate space as the layer below. */}
      <canvas
        ref={gizmoRef}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          // Inert outside Adjust mode, so ordinary use is untouched. touchAction
          // none is what stops a touch drag from scrolling the page instead.
          pointerEvents: adjustMode ? 'auto' : 'none',
          touchAction: adjustMode ? 'none' : 'auto',
          cursor: adjustMode ? (dragging ? 'grabbing' : 'grab') : 'default',
        }}
      />
    </div>
  );
});

export default FaceTracker;
export { PIERCING_POINTS, JEWELRY, jewelryFor };
// Consumed by the Adjust panel in App.jsx.
export { adjustmentKey, defaultAdjustment };
