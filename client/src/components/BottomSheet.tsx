/**
 * A bottom sheet, in the two forms Material 3 distinguishes.
 *
 * `modal` dims the table and takes focus — right for things you consult and
 * dismiss. Non-modal has no scrim and does not trap focus, so the table stays
 * usable underneath: that is what lets the combo guide stay open while the
 * player taps through their hand.
 *
 * The drag handle is a real button. A sheet that can only be swiped shut is an
 * accessibility failure, not a style: keyboard and switch users need a control.
 */
import { useEffect, useId, useRef } from 'react';
import type { ReactNode } from 'react';

export interface BottomSheetProps {
  readonly open: boolean;
  readonly title: string;
  readonly modal?: boolean;
  readonly onClose: () => void;
  readonly children: ReactNode;
}

export function BottomSheet({ open, title, modal = true, onClose, children }: BottomSheetProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const titleId = useId();

  // Escape closes any sheet; a modal one also takes focus so the reader lands
  // inside it rather than continuing down the page behind the scrim.
  useEffect(() => {
    if (!open) return undefined;

    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKeyDown);
    if (modal) panelRef.current?.focus();

    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open, modal, onClose]);

  if (!open) return null;

  return (
    <>
      {modal && <div className="sheet-scrim" onClick={onClose} aria-hidden="true" />}
      <div
        ref={panelRef}
        className={`sheet${modal ? ' sheet--modal' : ' sheet--standard'}`}
        role={modal ? 'dialog' : 'region'}
        aria-modal={modal || undefined}
        aria-labelledby={titleId}
        tabIndex={modal ? -1 : undefined}
      >
        <div className="sheet-head">
          <button
            type="button"
            className="sheet-handle"
            aria-label={`${title} 닫기`}
            onClick={onClose}
          />
          <h2 id={titleId}>{title}</h2>
          <button type="button" className="sheet-close secondary" onClick={onClose}>닫기</button>
        </div>
        {/* The only vertical scroller in the app; contain keeps the page still. */}
        <div className="sheet-body">{children}</div>
      </div>
    </>
  );
}
