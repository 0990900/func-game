/**
 * The rooms that are open right now.
 *
 * A room code is something you have to be told; a list is something you can
 * read. The code entry stays as a fallback, because a game already under way
 * is not in this list and a friend can still hand you its code.
 *
 * Polled rather than pushed. Watching the lobby means holding a connection to
 * something, and there is nothing here worth a socket: a few seconds of
 * staleness costs a player nothing, and the list stops polling the moment they
 * are in a game.
 */
import { useCallback, useEffect, useState } from 'react';
import { listRooms } from '../net/connection.ts';
import type { RoomSummary } from '../net/connection.ts';
import { phaseName } from '../theme/meta.ts';
import type { Phase } from '../../../src/core/types.ts';

const REFRESH_MS = 4000;
/** Seats the rules allow. Anything past this is a bot's chair or an observer's. */
const SEATS = 4;

export function RoomList({
  busy,
  onJoin,
  onObserve,
}: {
  readonly busy: boolean;
  readonly onJoin: (roomId: string) => void;
  readonly onObserve: (roomId: string) => void;
}) {
  const [rooms, setRooms] = useState<RoomSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async (): Promise<void> => {
    try {
      setRooms(await listRooms());
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '방 목록을 불러오지 못했습니다.');
    }
  }, []);

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => void refresh(), REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [refresh]);

  if (error) return <p className="muted">{error}</p>;
  if (rooms === null) return <p className="muted">방을 찾는 중…</p>;
  if (rooms.length === 0) {
    return <p className="muted">지금 열린 방이 없습니다. 위에서 방을 만들면 여기에 나타납니다.</p>;
  }

  return (
    <ul className="room-list">
      {rooms.map((room) => {
        const started = room.phase !== 'lobby';
        const full = room.humans >= SEATS;
        // A disabled button is skipped by keyboard navigation and its `title`
        // is not reliably announced, so the reason has to be in the name.
        const why = started ? '이미 시작된 게임' : full ? '자리가 찼습니다' : null;
        return (
          <li key={room.roomId}>
            <span className="room-who">
              {/* One element, or the grid makes the name and the suffix two
                  rows and every room reads as "방장 / 의 방". */}
              <span className="room-name"><b>{room.host}</b>의 방</span>
              <span className="muted">
                {phaseName(room.phase as Phase)} · 사람 {room.humans}/{SEATS}
                {room.observers > 0 && ` · 관전 ${room.observers}`}
              </span>
            </span>
            <span className="room-actions">
              <button
                type="button"
                disabled={busy || started || full}
                onClick={() => onJoin(room.roomId)}
                aria-label={`${room.host}의 방에 참가${why ? ` · 불가: ${why}` : ''}`}
                title={why ?? undefined}
              >
                참가
              </button>
              <button
                type="button"
                className="secondary"
                disabled={busy}
                onClick={() => onObserve(room.roomId)}
                aria-label={`${room.host}의 방 관전${why ? ` · ${why}이지만 관전은 됩니다` : ''}`}
              >
                관전
              </button>
            </span>
          </li>
        );
      })}
    </ul>
  );
}
