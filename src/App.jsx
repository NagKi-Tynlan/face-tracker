import { useEffect, useRef, useState } from 'react';
import FaceTracker, {
  PIERCING_POINTS,
  jewelryFor,
  adjustmentKey,
  defaultAdjustment,
} from './FaceTracker';
import './App.css';

const TIMER_MODES = [0, 3, 10];

function GridIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.2" aria-hidden="true">
      <path d="M4.8 0.5v13M9.2 0.5v13M0.5 4.8h13M0.5 9.2h13" />
    </svg>
  );
}

function TimerIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.2" aria-hidden="true">
      <circle cx="7" cy="7.5" r="5" />
      <path d="M7 4.8v2.7l1.8 1.1M5.5 1h3" />
    </svg>
  );
}

function SlidersIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.2" aria-hidden="true">
      <path d="M0.5 4h13M0.5 10h13" />
      <circle cx="4.5" cy="4" r="1.9" fill="currentColor" stroke="none" />
      <circle cx="9.5" cy="10" r="1.9" fill="currentColor" stroke="none" />
    </svg>
  );
}

function App() {
  const trackerRef = useRef(null);
  const flashTimeoutRef = useRef(null);
  const [activeStyles, setActiveStyles] = useState({});
  const [gridOn, setGridOn] = useState(false);
  const [timerMode, setTimerMode] = useState(0);
  const [countdown, setCountdown] = useState(null);
  const [flash, setFlash] = useState(false);
  const [openTray, setOpenTray] = useState(null);
  const [lastShot, setLastShot] = useState(null);
  // Keyed by adjustmentKey(position, styleId), so each piece holds its own
  // tweaks for as long as the app is open. Absent key = config defaults.
  const [adjustments, setAdjustments] = useState({});
  const [adjustMode, setAdjustMode] = useState(false);
  const [selectedPosition, setSelectedPosition] = useState(null);

  // Handles show on whichever piece was touched last, whether that was a tap on
  // the canvas or a pick from the tray. A selection whose piece has since come
  // off resolves to null, which is what hides the handles.
  const hasWorn = Object.keys(activeStyles).length > 0;
  const selectedWorn =
    selectedPosition && activeStyles[selectedPosition] ? selectedPosition : null;

  // Every writer goes through the functional form: a drag fires pointermove far
  // faster than React re-renders, so reading current values off the closure
  // would drop updates mid-drag. Patches arrive already in config units — the
  // tracker is the only place that knows the live face width and roll angle.
  const adjustPiece = (positionKey, styleId, patch) => {
    const key = adjustmentKey(positionKey, styleId);
    setAdjustments((prev) => ({
      ...prev,
      [key]: { ...(prev[key] ?? defaultAdjustment(positionKey, styleId)), ...patch },
    }));
  };

  const capture = () => {
    const dataUrl = trackerRef.current?.capturePhoto();
    if (!dataUrl) return;

    setFlash(true);
    clearTimeout(flashTimeoutRef.current);
    flashTimeoutRef.current = setTimeout(() => setFlash(false), 180);
    setLastShot(dataUrl);

    const link = document.createElement('a');
    link.href = dataUrl;
    link.download = `piercing-tryon-${Date.now()}.png`;
    link.click();
  };

  useEffect(() => () => clearTimeout(flashTimeoutRef.current), []);

  // Countdown ticks via chained timeouts so canceling is just setCountdown(null).
  useEffect(() => {
    if (countdown === null) return undefined;

    if (countdown === 0) {
      setCountdown(null);
      capture();
      return undefined;
    }

    const timeout = setTimeout(() => {
      setCountdown((c) => (c === null ? null : c - 1));
    }, 1000);
    return () => clearTimeout(timeout);
  }, [countdown]);

  const handleShutter = () => {
    if (countdown !== null) {
      setCountdown(null);
      return;
    }
    if (timerMode === 0) {
      capture();
      return;
    }
    setCountdown(timerMode);
  };

  const cycleTimer = () => {
    setTimerMode((m) => TIMER_MODES[(TIMER_MODES.indexOf(m) + 1) % TIMER_MODES.length]);
  };

  const selectStyle = (positionKey, styleId) => {
    setActiveStyles((prev) => {
      const next = { ...prev };
      if (next[positionKey] === styleId) {
        delete next[positionKey];
      } else {
        next[positionKey] = styleId;
      }
      return next;
    });
    setSelectedPosition(positionKey);
  };

  return (
    <div className="stage">
      <header className="site-header">
        <h1 className="wordmark">PiercedUp</h1>
        <p className="tagline">See it before the needle.</p>
      </header>

      <div className="phone">
        <div className="phone-ear">
          <span className="phone-camera" />
          <span className="phone-speaker" />
        </div>

        <div className="screen">
          {/* A div, not a header: the page's banner is the wordmark above. */}
          <div className="top-bar">
            <button
              type="button"
              className={`bar-toggle ${gridOn ? 'on' : ''}`}
              aria-pressed={gridOn}
              onClick={() => setGridOn((g) => !g)}
            >
              <GridIcon />
              <span>Grid</span>
            </button>
            <button
              type="button"
              className={`bar-toggle ${timerMode > 0 ? 'on' : ''}`}
              aria-pressed={timerMode > 0}
              onClick={cycleTimer}
            >
              <TimerIcon />
              <span>{timerMode === 0 ? 'Timer' : `${timerMode}s`}</span>
            </button>
            <button
              type="button"
              className={`bar-toggle ${adjustMode && hasWorn ? 'on' : ''}`}
              aria-pressed={adjustMode && hasWorn}
              disabled={!hasWorn}
              title={hasWorn ? undefined : 'Put on a piece to adjust it'}
              onClick={() => setAdjustMode((on) => !on)}
            >
              <SlidersIcon />
              <span>Adjust</span>
            </button>
          </div>

          <div className="viewfinder">
            <FaceTracker
              ref={trackerRef}
              activeStyles={activeStyles}
              adjustments={adjustments}
              adjustMode={adjustMode && hasWorn}
              selectedPosition={adjustMode && hasWorn ? selectedWorn : null}
              onPieceSelect={(positionKey) => setSelectedPosition(positionKey)}
              onPieceAdjust={adjustPiece}
            />
            {gridOn && (
              <div className="grid-overlay" aria-hidden="true">
                <span className="grid-line v v1" />
                <span className="grid-line v v2" />
                <span className="grid-line h h1" />
                <span className="grid-line h h2" />
              </div>
            )}
            {countdown > 0 && <div className="countdown">{countdown}</div>}
            <div className={`flash ${flash ? 'visible' : ''}`} aria-hidden="true" />
          </div>

          <div className="drawer">
            <div className="tabs">
              {Object.entries(PIERCING_POINTS).map(([key, point]) => (
                <button
                  key={key}
                  type="button"
                  className={`tab ${openTray === key ? 'open' : ''}`}
                  onClick={() => setOpenTray((cur) => (cur === key ? null : key))}
                >
                  {point.label}
                  {activeStyles[key] && <span className="worn-dot" />}
                </button>
              ))}
            </div>
            {openTray && (
              <div className="tray">
                {jewelryFor(openTray).map((style) => (
                  <button
                    key={style.id}
                    type="button"
                    className={`tray-item ${activeStyles[openTray] === style.id ? 'active' : ''}`}
                    onClick={() => selectStyle(openTray, style.id)}
                  >
                    {/* Names the position too, so the alt says something the
                        adjacent label doesn't already say out loud. */}
                    <img
                      className="swatch"
                      src={style.src}
                      alt={`${style.label} for ${PIERCING_POINTS[openTray].label.toLowerCase()}`}
                    />
                    <span className="tray-item-label">{style.label}</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          <footer className="bottom-bar">
            <div className="thumb-slot">
              {lastShot ? (
                <img
                  className="thumb"
                  src={lastShot}
                  alt="Your most recent capture, with the jewelry you tried on"
                />
              ) : (
                <span className="thumb thumb-empty" />
              )}
            </div>
            <button
              type="button"
              className="shutter"
              onClick={handleShutter}
              aria-label={countdown !== null ? 'Cancel timer' : 'Take photo'}
            >
              <span className={`shutter-inner ${countdown !== null ? 'counting' : ''}`} />
            </button>
            {/* BASE_URL keeps this pointing at /face-tracker/ on Pages and at /
                in dev. privacy.html ships from public/, so it is a real
                navigation, not a route the SPA handles. */}
            <div className="thumb-slot thumb-slot-end">
              <a className="footer-link" href={`${import.meta.env.BASE_URL}privacy.html`}>
                Privacy
              </a>
            </div>
          </footer>
        </div>

        <div className="phone-chin">
          <span className="home-button" />
        </div>
      </div>
    </div>
  );
}

export default App;
