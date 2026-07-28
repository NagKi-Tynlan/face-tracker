import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';

// Landmark indices confirmed via click-to-identify testing.
// Each position supports multiple selectable jewelry STYLES (rendered placeholders,
// not photos — chrome-style gradients + shadow, swap for real assets later).
const PIERCING_POINTS = {
  leftNostril: {
    label: 'Left Nostril',
    index: 220,
    offsetX: 0,
    offsetY: 0,
    styles: [
      { id: 'stud', label: 'Stud', shape: 'stud', size: 4 },
      { id: 'hoop', label: 'Small Hoop', shape: 'ring', size: 5 },
    ],
  },
  rightNostril: {
    label: 'Right Nostril',
    index: 437,
    offsetX: 0,
    offsetY: 15,
    styles: [
      { id: 'stud', label: 'Stud', shape: 'stud', size: 4 },
      { id: 'hoop', label: 'Small Hoop', shape: 'ring', size: 5 },
    ],
  },
  septum: {
    label: 'Septum',
    index: 274,
    offsetX: 0,
    offsetY: 0,
    styles: [
      { id: 'ring', label: 'Ring', shape: 'ring', size: 6 },
      { id: 'horseshoe', label: 'Horseshoe', shape: 'horseshoe', size: 6 },
      { id: 'hoop', label: 'Small Hoop', shape: 'ring', size: 4 },
    ],
  },
  leftEyebrow: {
    label: 'Left Eyebrow',
    index: 276,
    offsetX: 0,
    offsetY: 0,
    styles: [
      { id: 'straight', label: 'Straight Barbell', shape: 'barbell', size: 8, curved: false },
      { id: 'curved', label: 'Curved Barbell', shape: 'barbell', size: 8, curved: true },
    ],
  },
  rightEyebrow: {
    label: 'Right Eyebrow',
    index: 46,
    offsetX: 0,
    offsetY: 0,
    styles: [
      { id: 'straight', label: 'Straight Barbell', shape: 'barbell', size: 8, curved: false },
      { id: 'curved', label: 'Curved Barbell', shape: 'barbell', size: 8, curved: true },
    ],
  },
  lowerLip: {
    label: 'Lower Lip',
    index: 335,
    offsetX: 0,
    offsetY: 0,
    styles: [
      { id: 'stud', label: 'Stud', shape: 'stud', size: 4 },
      { id: 'ring', label: 'Small Ring', shape: 'ring', size: 4 },
    ],
  },
};

// ---- Chrome-style rendering helpers ----
// Multi-band gradients fake an environment reflection; the alternating
// light/dark banding is what makes small shapes read as polished metal
// rather than flat drawings.
const CHROME_BANDS = [
  [0, '#ffffff'],
  [0.16, '#e9e9ec'],
  [0.32, '#8f8f9a'],
  [0.45, '#55555f'],
  [0.55, '#d6d6db'],
  [0.72, '#83838d'],
  [0.86, '#f3f3f5'],
  [1, '#c9c9cf'],
];

const chromeStrokeGradient = (ctx, x, y, size) => {
  const g = ctx.createLinearGradient(x - size, y - size, x + size, y + size);
  CHROME_BANDS.forEach(([stop, color]) => g.addColorStop(stop, color));
  return g;
};

const withShadow = (ctx, fn) => {
  ctx.save();
  ctx.shadowColor = 'rgba(0, 0, 0, 0.45)';
  ctx.shadowBlur = 4;
  ctx.shadowOffsetY = 2;
  fn();
  ctx.restore();
};

// Sphere with an offset key light, a floor-bounce fill at the bottom,
// and a hard specular dot.
const drawChromeBall = (ctx, x, y, r) => {
  const base = ctx.createRadialGradient(x - r * 0.35, y - r * 0.4, r * 0.08, x, y, r * 1.15);
  base.addColorStop(0, '#ffffff');
  base.addColorStop(0.3, '#e6e6ea');
  base.addColorStop(0.55, '#9b9ba4');
  base.addColorStop(0.8, '#4e4e58');
  base.addColorStop(1, '#2e2e36');
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fillStyle = base;
  ctx.fill();

  const bounce = ctx.createRadialGradient(x, y + r * 0.7, 0, x, y + r * 0.7, r * 0.6);
  bounce.addColorStop(0, 'rgba(255, 255, 255, 0.35)');
  bounce.addColorStop(1, 'rgba(255, 255, 255, 0)');
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fillStyle = bounce;
  ctx.fill();

  ctx.beginPath();
  ctx.arc(x - r * 0.35, y - r * 0.42, r * 0.2, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(255, 255, 255, 0.95)';
  ctx.fill();
};

// Tube cross-section: dark under-stroke for depth, chrome band stroke on top,
// then narrow specular sweeps where light rakes across the metal.
const strokeChromeArc = (ctx, x, y, size, startAngle, endAngle) => {
  ctx.save();
  ctx.lineCap = 'round';

  withShadow(ctx, () => {
    ctx.beginPath();
    ctx.arc(x, y, size, startAngle, endAngle);
    ctx.strokeStyle = 'rgba(28, 28, 34, 0.9)';
    ctx.lineWidth = 3;
    ctx.stroke();
  });

  ctx.beginPath();
  ctx.arc(x, y, size, startAngle, endAngle);
  ctx.strokeStyle = chromeStrokeGradient(ctx, x, y, size);
  ctx.lineWidth = 2.2;
  ctx.stroke();

  ctx.beginPath();
  ctx.arc(x, y, size, 1.05 * Math.PI, 1.55 * Math.PI);
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.9)';
  ctx.lineWidth = 0.8;
  ctx.stroke();

  ctx.beginPath();
  ctx.arc(x, y, size, 0.25 * Math.PI, 0.6 * Math.PI);
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.4)';
  ctx.lineWidth = 0.6;
  ctx.stroke();

  ctx.restore();
};

const drawRing = (ctx, x, y, size) => {
  strokeChromeArc(ctx, x, y, size, 0, Math.PI * 2);
};

const drawStud = (ctx, x, y, size) => {
  withShadow(ctx, () => {
    ctx.beginPath();
    ctx.arc(x, y, size, 0, Math.PI * 2);
    ctx.fillStyle = '#55555f';
    ctx.fill();
  });
  drawChromeBall(ctx, x, y, size);
};

const drawHorseshoe = (ctx, x, y, size) => {
  const startAngle = 0.25 * Math.PI;
  const endAngle = 1.75 * Math.PI;

  strokeChromeArc(ctx, x, y, size, startAngle, endAngle);

  [startAngle, endAngle].forEach((angle) => {
    const ex = x + size * Math.cos(angle);
    const ey = y + size * Math.sin(angle);
    drawChromeBall(ctx, ex, ey, 1.8);
  });
};

const drawBarbell = (ctx, x, y, size, curved) => {
  let x1;
  let y1;
  let x2;
  let y2;

  ctx.save();
  ctx.lineCap = 'round';

  if (curved) {
    const centerY = y + size * 0.5;
    const startAngle = 1.15 * Math.PI;
    const endAngle = 1.85 * Math.PI;

    withShadow(ctx, () => {
      ctx.beginPath();
      ctx.arc(x, centerY, size, startAngle, endAngle);
      ctx.strokeStyle = 'rgba(28, 28, 34, 0.9)';
      ctx.lineWidth = 3;
      ctx.stroke();
    });

    ctx.beginPath();
    ctx.arc(x, centerY, size, startAngle, endAngle);
    ctx.strokeStyle = chromeStrokeGradient(ctx, x, centerY, size);
    ctx.lineWidth = 2.2;
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(x, centerY, size, 1.3 * Math.PI, 1.6 * Math.PI);
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.9)';
    ctx.lineWidth = 0.8;
    ctx.stroke();

    x1 = x + size * Math.cos(startAngle);
    y1 = centerY + size * Math.sin(startAngle);
    x2 = x + size * Math.cos(endAngle);
    y2 = centerY + size * Math.sin(endAngle);
  } else {
    x1 = x - size;
    y1 = y;
    x2 = x + size;
    y2 = y;

    withShadow(ctx, () => {
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.strokeStyle = 'rgba(28, 28, 34, 0.9)';
      ctx.lineWidth = 3;
      ctx.stroke();
    });

    // Vertical gradient across the bar's thickness reads as a lit cylinder.
    const g = ctx.createLinearGradient(x, y - 1.2, x, y + 1.2);
    g.addColorStop(0, '#f5f5f7');
    g.addColorStop(0.35, '#ffffff');
    g.addColorStop(0.7, '#8f8f9a');
    g.addColorStop(1, '#4e4e58');
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.strokeStyle = g;
    ctx.lineWidth = 2.2;
    ctx.stroke();
  }

  ctx.restore();

  [[x1, y1], [x2, y2]].forEach(([bx, by]) => {
    drawChromeBall(ctx, bx, by, 2.2);
  });
};

const SHAPE_DRAWERS = {
  ring: (ctx, x, y, style) => drawRing(ctx, x, y, style.size),
  stud: (ctx, x, y, style) => drawStud(ctx, x, y, style.size),
  horseshoe: (ctx, x, y, style) => drawHorseshoe(ctx, x, y, style.size),
  barbell: (ctx, x, y, style) => drawBarbell(ctx, x, y, style.size, style.curved),
};

const FaceTracker = forwardRef(function FaceTracker({ activeStyles = {} }, ref) {
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const cameraRef = useRef(null);
  const faceMeshRef = useRef(null);
  const animationFrameRef = useRef(null);
  const activeStylesRef = useRef(activeStyles);
  const [error, setError] = useState(null);

  useEffect(() => {
    activeStylesRef.current = activeStyles;
  }, [activeStyles]);

  useImperativeHandle(ref, () => ({
    capturePhoto: () => {
      const video = videoRef.current;
      const canvas = canvasRef.current;
      if (!video || !canvas || canvas.width === 0) return null;

      const exportCanvas = document.createElement('canvas');
      exportCanvas.width = canvas.width;
      exportCanvas.height = canvas.height;
      const ctx = exportCanvas.getContext('2d');

      ctx.save();
      ctx.translate(exportCanvas.width, 0);
      ctx.scale(-1, 1);
      ctx.drawImage(video, 0, 0, exportCanvas.width, exportCanvas.height);
      ctx.restore();

      ctx.drawImage(canvas, 0, 0);

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
      if (video.videoWidth > 0 && video.videoHeight > 0) {
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
      }
      const rect = video.getBoundingClientRect();
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
          locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh/${file}`,
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
          if (!landmarks) return;

          const active = activeStylesRef.current;

          Object.entries(PIERCING_POINTS).forEach(([key, point]) => {
            const styleId = active[key];
            if (!styleId) return;

            const style = point.styles.find((s) => s.id === styleId);
            if (!style) return;

            const lm = landmarks[point.index];
            if (!lm) return;

            const x = (1 - lm.x) * canvas.width + point.offsetX;
            const y = lm.y * canvas.height + point.offsetY;

            const drawFn = SHAPE_DRAWERS[style.shape];
            if (drawFn) drawFn(ctx, x, y, style);
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
export { PIERCING_POINTS, SHAPE_DRAWERS };