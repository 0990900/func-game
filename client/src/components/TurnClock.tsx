/**
 * How long the player on turn has left.
 *
 * Only shown when the clock is the player's own to run out. Bots act inside a
 * second, so counting them down would be noise; another human's deadline is
 * theirs to worry about, and a bar draining for someone else reads as pressure
 * on the wrong person. What everyone does see is that the game keeps moving,
 * which the table already shows.
 *
 * The deadline is stamped against the server's clock, so it is read through the
 * offset the store measured rather than against this device's idea of the time.
 */
import { useEffect, useState } from 'react';
import { useGame } from '../store/gameStore.ts';

/** Below this the clock is the thing to look at, and says so. */
const URGENT_SECONDS = 10;
/** Fast enough that the seconds never appear to skip, cheap enough to ignore. */
const TICK_MS = 200;

export function TurnClock() {
  const state = useGame((s) => s.state);
  const clockOffset = useGame((s) => s.clockOffset);
  const [now, setNow] = useState(() => Date.now());

  const endsAt = state?.turnEndsAt ?? null;
  const isMine = Boolean(state?.me?.isMyTurn);
  const running = endsAt !== null && isMine;

  useEffect(() => {
    if (!running) return undefined;
    // Re-read immediately so a fresh deadline never shows a stale second.
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), TICK_MS);
    return () => window.clearInterval(timer);
  }, [running, endsAt]);

  if (!running || endsAt === null) return null;

  const limit = Math.max(1, state?.turnLimitSeconds ?? 30);
  const msLeft = Math.max(0, endsAt - (now + clockOffset));
  const seconds = Math.ceil(msLeft / 1000);
  const fraction = Math.max(0, Math.min(1, msLeft / (limit * 1000)));
  const urgent = seconds <= URGENT_SECONDS;

  return (
    <span
      className={`turn-clock${urgent ? ' is-urgent' : ''}`}
      // The bar is decorative; the number is what gets announced, and only when
      // it starts mattering, so a screen reader is not told every second.
      role="timer"
      aria-live={urgent ? 'assertive' : 'off'}
      aria-label={`남은 시간 ${seconds}초`}
    >
      <span className="turn-clock-bar" style={{ transform: `scaleX(${fraction})` }} aria-hidden="true" />
      <b className="turn-clock-value">{seconds}s</b>
    </span>
  );
}
