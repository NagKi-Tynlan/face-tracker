import { useEffect, useMemo, useRef, useState } from 'react';
import FaceTracker, { PIERCING_POINTS, jewelryFor } from './FaceTracker';
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
  };

  return (
    <div className="stage">
      <div className="phone">
        <div className="phone-ear">
          <span className="phone-camera" />
          <span className="phone-speaker" />
        </div>

        <div className="screen">
          <header className="top-bar">
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
          </header>

          <div className="viewfinder">
            <FaceTracker ref={trackerRef} activeStyles={activeStyles} />
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
                    <img className="swatch" src={style.src} alt={style.label} />
                    <span className="tray-item-label">{style.label}</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          <footer className="bottom-bar">
            <div className="thumb-slot">
              {lastShot ? (
                <img className="thumb" src={lastShot} alt="Last capture" />
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
            <div className="thumb-slot" />
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
