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
  /**
   * A modal sheet covers the table and takes over input. On a wide screen the
   * sheet becomes a side panel that covers nothing, so it must stop claiming to
   * be modal — the accessibility tree would otherwise describe a dialog the
   * player can see straight past.
   */
  readonly modal?: boolean;
  readonly onClose: () => void;
  readonly children: ReactNode;
}

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]),'
  + ' textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function BottomSheet({ open, title, modal = true, onClose, children }: BottomSheetProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const titleId = useId();

  useEffect(() => {
    if (!open) return undefined;

    const panel = panelRef.current;
    // Give focus back to whatever opened the sheet, not to the top of the page.
    const opener = document.activeElement as HTMLElement | null;

    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        onClose();
        return;
      }
      // A declared modal has to behave like one: Tab cycles inside the sheet
      // rather than wandering into the table behind it.
      if (event.key !== 'Tab' || !modal || !panel) return;

      const focusable = [...panel.querySelectorAll<HTMLElement>(FOCUSABLE)];
      if (focusable.length === 0) {
        event.preventDefault();
        return;
      }
      const first = focusable[0]!;
      const last = focusable[focusable.length - 1]!;
      const active = document.activeElement;

      if (event.shiftKey && (active === first || active === panel)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', onKeyDown);
    if (modal) panel?.focus();

    return () => {
      document.removeEventListener('keydown', onKeyDown);
      if (modal) opener?.focus?.();
    };
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
