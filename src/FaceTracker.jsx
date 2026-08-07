import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';

// ---- TEMPORARY: landmark debug overlay ----
// Flip to false to turn the overlay off; nothing else in the file reads these
// constants, so this whole block can be deleted once calibration is finished.
const DEBUG_LANDMARKS = false;

// The only landmarks drawn — candidates being evaluated as piercing anchors.
const DEBUG_LANDMARK_INDICES = [
  1, 2, 4, 19, 44, 45, 51, 59, 94, 97, 98, 99, 115, 125, 129, 141,
  165, 235, 250, 274, 275, 294, 305, 331, 344, 358, 370, 462,
];

// In CSS px; scaled by devicePixelRatio at draw time because the canvas
// backing store is sized in device pixels.
const DEBUG_DOT_SIZE = 3;
const DEBUG_LABEL_FONT_SIZE = 14;
const DEBUG_LABEL_OFFSET = 6;

// Uses the same (1 - x) flip as the jewelry so dots land on the face as the
// user sees it. Text is unaffected — only the video element is CSS-mirrored.
// Dots and labels are separate passes so every label sits above every dot,
// and so fillStyle/font are set once rather than per landmark.
const drawDebugLandmarks = (ctx, landmarks, canvas) => {
  const dpr = window.devicePixelRatio || 1;
  const radius = (DEBUG_DOT_SIZE * dpr) / 2;
  const offset = DEBUG_LABEL_OFFSET * dpr;

  const points = DEBUG_LANDMARK_INDICES.flatMap((index) => {
    const lm = landmarks[index];
    if (!lm) return [];
    return [{ index, x: (1 - lm.x) * canvas.width, y: lm.y * canvas.height }];
  });

  ctx.save();

  ctx.fillStyle = '#f0f';
  points.forEach(({ x, y }) => {
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fill();
  });

  ctx.font = `bold ${Math.round(DEBUG_LABEL_FONT_SIZE * dpr)}px sans-serif`;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'bottom';
  ctx.strokeStyle = '#000';
  ctx.lineWidth = 3 * dpr;
  ctx.lineJoin = 'round';
  ctx.fillStyle = '#fff';
  points.forEach(({ index, x, y }) => {
    const label = String(index);
    // Bottom-left of the text sits up-and-right of the dot, clear of it.
    ctx.strokeText(label, x + offset, y - offset);
    ctx.fillText(label, x + offset, y - offset);
  });

  ctx.restore();
};

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

// Jewelry styles per piercing point. Images are transparent PNGs, drawn
// centered on the anchor; actual draw size scales with the live face width.
//
// Two placement schemas are in play while calibration is in progress:
//   - `widthRatio` + `offset: [x, y]` — face-width ratios, straight off the
//     DEBUG_TUNING sliders. Per style, and wins when present.
//   - `width` — the older px-at-REFERENCE_FACE_WIDTH value, paired with the
//     per-position offsetX/offsetY in PIERCING_POINTS.
// See configPlacement() for the resolution order.
const JEWELRY = {
  leftNostril: [
    { id: 'stud', label: 'Stud', src: '/jewelry/nostril-stud.png', width: 10 },
    { id: 'hoop', label: 'Small Hoop', src: '/jewelry/nostril-hoop.png', width: 16 },
  ],
  rightNostril: [
    { id: 'stud', label: 'Stud', src: '/jewelry/nostril-stud.png', width: 10 },
    { id: 'hoop', label: 'Small Hoop', src: '/jewelry/nostril-hoop.png', width: 16 },
  ],
  septum: [
    { id: 'ring', label: 'Ring', src: '/jewelry/septum-ring.png', width: 20 },
    { id: 'horseshoe', label: 'Horseshoe', src: '/jewelry/septum-horseshoe.png', width: 20 },
    { id: 'hoop', label: 'Small Hoop', src: '/jewelry/septum-hoop.png', width: 14 },
  ],
  leftEyebrow: [
    { id: 'straight', label: 'Straight Barbell', src: '/jewelry/barbell-straight.png', widthRatio: 0.118, offset: [-0.071, -0.055] },
    { id: 'curved', label: 'Curved Barbell', src: '/jewelry/barbell-curved.png', widthRatio: 0.118, offset: [-0.071, -0.055] },
  ],
  rightEyebrow: [
    { id: 'straight', label: 'Straight Barbell', src: '/jewelry/barbell-straight.png', widthRatio: 0.118, offset: [0.071, -0.055] },
    { id: 'curved', label: 'Curved Barbell', src: '/jewelry/barbell-curved.png', widthRatio: 0.118, offset: [0.071, -0.055] },
  ],
  lowerLip: [
    { id: 'stud', label: 'Stud', src: '/jewelry/lip-stud.png', width: 10 },
    { id: 'ring', label: 'Small Ring', src: '/jewelry/lip-ring.png', width: 14 },
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

// Calibration baseline: jewelry `width` values are tuned for a face this
// many px wide (tragus-to-tragus) in canvas device-pixel space.
const REFERENCE_FACE_WIDTH = 220;

// Normalizes either placement schema to face-width ratios. Per-style
// widthRatio/offset win; anything without them falls back to the px `width`
// and the per-position offsets, divided down into the same ratio space.
const configPlacement = (point, style) => ({
  offsetX: style.offset ? style.offset[0] : point.offsetX / REFERENCE_FACE_WIDTH,
  offsetY: style.offset ? style.offset[1] : point.offsetY / REFERENCE_FACE_WIDTH,
  widthRatio: style.widthRatio ?? style.width / REFERENCE_FACE_WIDTH,
});

// ---- TEMPORARY: tuning support (see DEBUG_TUNING in App.jsx) ----
// Overrides are keyed per position+style so each piece tunes independently.
// Delete this, the `tuning` prop, and its use in onResults once the values
// have been written back into PIERCING_POINTS / JEWELRY above.
const tuningKey = (positionKey, styleId) => `${positionKey}:${styleId}`;

// Seeds the sliders from whatever the config currently holds, converting the
// px-at-reference-width values into the face-width ratios the sliders use.
const defaultTuning = (positionKey, styleId) => {
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

const drawJewelry = (ctx, entry, drawWidthAtReference, x, y, scale, angle) => {
  const drawWidth = drawWidthAtReference * scale;
  const aspect = entry.height / entry.width;
  const drawHeight = drawWidth * aspect;

  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);
  ctx.drawImage(entry.img, -drawWidth / 2, -drawHeight / 2, drawWidth, drawHeight);
  ctx.restore();
};

const FaceTracker = forwardRef(function FaceTracker({ activeStyles = {}, tuning = {} }, ref) {
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const cameraRef = useRef(null);
  const faceMeshRef = useRef(null);
  const animationFrameRef = useRef(null);
  const activeStylesRef = useRef(activeStyles);
  const tuningRef = useRef(tuning);
  const emaRef = useRef(emptyEma());
  const lastSizeRef = useRef({ width: 0, height: 0 });
  const [error, setError] = useState(null);

  useEffect(() => {
    activeStylesRef.current = activeStyles;
  }, [activeStyles]);

  // Mirrors activeStyles: held in a ref so slider drags reach the running
  // draw loop without tearing down and re-creating the FaceMesh pipeline.
  useEffect(() => {
    tuningRef.current = tuning;
  }, [tuning]);

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

      if (width !== lastSizeRef.current.width || height !== lastSizeRef.current.height) {
        canvas.width = width;
        canvas.height = height;
        lastSizeRef.current = { width, height };
      }

      canvas.style.width = `${rect.width}px`;
      canvas.style.height = `${rect.height}px`;
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

          ctx.clearRect(0, 0, canvas.width, canvas.height);

          const landmarks = results.multiFaceLandmarks?.[0];
          if (!landmarks) {
            emaRef.current = emptyEma();
            return;
          }

          // Before the tragus check below, so the overlay still renders on
          // frames where those two landmarks are missing.
          if (DEBUG_LANDMARKS) drawDebugLandmarks(ctx, landmarks, canvas);

          const left = landmarks[TRAGUS_LEFT];
          const right = landmarks[TRAGUS_RIGHT];
          if (!left || !right) {
            emaRef.current = emptyEma();
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
          const tune = tuningRef.current;

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

            // A live slider override beats the config; both are face-width
            // ratios, converted back to px at reference here so the rest of
            // the pipeline keeps its existing units.
            const placement = tune[tuningKey(key, styleId)] ?? configPlacement(point, style);
            const widthAtReference = placement.widthRatio * REFERENCE_FACE_WIDTH;

            const ox = placement.offsetX * REFERENCE_FACE_WIDTH * scale;
            const oy = placement.offsetY * REFERENCE_FACE_WIDTH * scale;
            const rotOx = ox * cos - oy * sin;
            const rotOy = ox * sin + oy * cos;

            const rawX = (1 - lm.x) * canvas.width + rotOx;
            const rawY = lm.y * canvas.height + rotOy;

            const prev = ema.points[key] ?? null;
            const smoothedX = prev === null ? rawX : prev.x + EMA_ALPHA * (rawX - prev.x);
            const smoothedY = prev === null ? rawY : prev.y + EMA_ALPHA * (rawY - prev.y);
            ema.points[key] = { x: smoothedX, y: smoothedY };

            drawJewelry(ctx, asset, widthAtReference, smoothedX, smoothedY, scale, ema.angle);
          });
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
      <canvas
        ref={canvasRef}
        style={{ position: 'absolute', top: 0, left: 0, pointerEvents: 'none' }}
      />
    </div>
  );
});

export default FaceTracker;
export { PIERCING_POINTS, JEWELRY, jewelryFor };
// TEMPORARY: consumed only by the DEBUG_TUNING panel in App.jsx.
export { REFERENCE_FACE_WIDTH, tuningKey, defaultTuning };
