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
  // Touched positions, most recent first. A stack rather than a single value:
  // with several pieces on, taking one off used to leave the selection pointing
  // at an empty position, which blanked the Shop button even though other
  // pieces were still worn. Keeping the order lets it fall back to whatever was
  // touched before instead.
  const [selectionOrder, setSelectionOrder] = useState([]);
  // A press on bare canvas hides the handles without forgetting which piece the
  // Shop button is for — the two were one flag before, so dismissing the gizmo
  // also cleared the shop target.
  const [handlesHidden, setHandlesHidden] = useState(false);

  const hasWorn = Object.keys(activeStyles).length > 0;
  // The most recently touched position that is still worn. Stale entries are
  // skipped rather than pruned: there are only six positions, so the list stays
  // short on its own and every write staying O(6) keeps taps cheap.
  const selectedWorn = selectionOrder.find((key) => activeStyles[key]) ?? null;
  const shopStyle = selectedWorn ? jewelryFor(selectedWorn, activeStyles[selectedWorn]) : null;

  // Moves a position to the front. Returning the identical array when it is
  // already there matters: onPieceSelect fires on every pointerdown in Adjust
  // mode, and a re-render per press is a re-render the draw loop competes with.
  const promoteSelection = (positionKey) => {
    setHandlesHidden(false);
    setSelectionOrder((prev) => {
      if (prev[0] === positionKey) return prev;
      return [positionKey, ...prev.filter((key) => key !== positionKey)];
    });
  };

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
    const removing = activeStyles[positionKey] === styleId;

    setActiveStyles((prev) => {
      const next = { ...prev };
      if (next[positionKey] === styleId) {
        delete next[positionKey];
      } else {
        next[positionKey] = styleId;
      }
      return next;
    });

    if (removing) {
      // Taking a piece off must not hand it the selection. It used to, which is
      // why removing one of several worn pieces blanked the Shop button.
      setSelectionOrder((prev) => prev.filter((key) => key !== positionKey));
    } else {
      promoteSelection(positionKey);
    }
  };

  return (
    <div className="stage">
      <header className="site-header">
        <h1 className="wordmark">PiercedUp</h1>
        <p className="tagline">See it before the needle.</p>
        <p className="disclosure">
          PiercedUp uses affiliate links and earns a commission from purchases made
          through them, at no extra cost to you.
        </p>
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
              selectedPosition={adjustMode && hasWorn && !handlesHidden ? selectedWorn : null}
              onPieceSelect={(positionKey) =>
                (positionKey === null ? setHandlesHidden(true) : promoteSelection(positionKey))
              }
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

          {/* One shop action, for the piece touched most recently. Mounted on
              hasWorn rather than on the selection, so moving between worn
              pieces only swaps the href and the caption — the bar itself never
              unmounts. It used to, and every remount resized the viewfinder,
              which reallocates both canvas backing stores mid-stream. */}
          {hasWorn && shopStyle?.affiliateUrl && (
            <div className="shop-bar">
              {/* Which piece "this piece" means, since several can be on. */}
              <p className="shop-piece">{shopStyle.label}</p>
              <a
                className="shop-button"
                href={shopStyle.affiliateUrl}
                target="_blank"
                rel="sponsored noopener noreferrer"
                aria-label={`Shop the ${shopStyle.label} — affiliate link, opens in a new tab`}
              >
                Shop this piece
              </a>
              {/* FTC: the disclosure sits with the link itself, not only in the
                  header and the privacy page, so it is unmissable before a click. */}
              <p className="shop-note">
                Affiliate link — we earn a commission, at no extra cost to you.
              </p>
            </div>
          )}

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
            {/* BASE_URL is '/' in both dev and production. privacy.html ships
                from public/, so it is a real navigation, not a route the SPA
                handles. */}
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
