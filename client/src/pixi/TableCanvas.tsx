/**
 * Mounts the Pixi table into React.
 *
 * React never re-renders the table: the scene subscribes to the store directly
 * and redraws itself. That keeps turn-rate state in React and frame-rate work
 * in Pixi, so a card animation never runs through the React reconciler.
 */
import { useEffect, useRef, useState } from 'react';
import { Application } from 'pixi.js';
import { TableScene } from './TableScene.ts';
import { loadTableTextures, waitForFonts } from './assets.ts';
import { actions, gameStore } from '../store/gameStore.ts';
import { palette, toHexNumber } from '../theme/tokens.ts';

/** Movement past this is a scroll, not a tap. */
const DRAG_THRESHOLD = 8;

export function TableCanvas() {
  const hostRef = useRef<HTMLDivElement>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    let disposed = false;
    let app: Application | null = null;
    let scene: TableScene | null = null;
    let unsubscribe: (() => void) | null = null;
    let observer: ResizeObserver | null = null;
    let detachDrag: (() => void) | null = null;

    const start = async (): Promise<void> => {
      const created = new Application();
      // WebGL by default: Pixi's own guide still marks WebGPU experimental.
      await created.init({
        preference: 'webgl',
        background: toHexNumber(palette.bg),
        backgroundAlpha: 0,
        antialias: true,
        resolution: Math.min(window.devicePixelRatio || 1, 2),
        autoDensity: true,
        width: host.clientWidth || 640,
        height: 400,
      });
      if (disposed) {
        created.destroy(true);
        return;
      }

      app = created;
      host.appendChild(created.canvas);
      // The canvas must never widen the document; it fills its column instead.
      created.canvas.style.width = '100%';
      created.canvas.style.display = 'block';
      // The table owns its row of the grid rather than sitting in a scrolling
      // page, so it handles pans itself. touch-action has to be settled before
      // a gesture begins, which is why it is set once here and never toggled.
      created.canvas.style.touchAction = 'none';

      await waitForFonts();
      const textures = await loadTableTextures();
      if (disposed) return;

      scene = new TableScene(created, textures, {
        onSelectHand: (card) => actions.selectCard(card.id),
        onSelectMarket: (card) => actions.selectMarket(card.id),
      }, host.clientWidth || 640);

      let lastSelected: string | null = null;

      const draw = (): void => {
        const {
          state, selectedCardId, selectedMarketId, previewCardId, previewMarketId,
        } = gameStore.getState();
        if (!state || !scene || !app) return;
        const content = scene.update({
          state, selectedCardId, selectedMarketId, previewCardId, previewMarketId,
        });
        // The canvas fills its grid row; the scene scrolls inside it when the
        // content is taller, so the page itself never grows.
        const available = host.clientHeight || content;
        scene.setViewport(host.clientWidth || 640, available, content);
        app.renderer.resize(host.clientWidth || 640, available);

        if (selectedCardId && !lastSelected) scene.revealMarket();
        lastSelected = selectedCardId;
      };

      draw();
      unsubscribe = gameStore.subscribe(draw);

      // Drag to scroll the table. A drag past the threshold suppresses the tap,
      // so scrolling past a card never picks it up.
      let dragging = false;
      let lastY = 0;
      let travelled = 0;

      const onPointerDown = (event: PointerEvent): void => {
        dragging = true;
        travelled = 0;
        lastY = event.clientY;
      };
      const onPointerMove = (event: PointerEvent): void => {
        if (!dragging || !scene) return;
        const delta = lastY - event.clientY;
        lastY = event.clientY;
        travelled += Math.abs(delta);
        if (travelled > DRAG_THRESHOLD) {
          scene.scrollBy(delta);
          created.canvas.classList.add('is-dragging');
        }
      };
      const endDrag = (): void => {
        dragging = false;
        // Cleared on the next frame so the click that follows this pointerup
        // still sees that a drag happened.
        requestAnimationFrame(() => created.canvas.classList.remove('is-dragging'));
      };

      created.canvas.addEventListener('pointerdown', onPointerDown);
      created.canvas.addEventListener('pointermove', onPointerMove);
      created.canvas.addEventListener('pointerup', endDrag);
      created.canvas.addEventListener('pointercancel', endDrag);
      detachDrag = () => {
        created.canvas.removeEventListener('pointerdown', onPointerDown);
        created.canvas.removeEventListener('pointermove', onPointerMove);
        created.canvas.removeEventListener('pointerup', endDrag);
        created.canvas.removeEventListener('pointercancel', endDrag);
      };
      scene.setDragged(() => travelled > DRAG_THRESHOLD);

      observer = new ResizeObserver(() => {
        if (!scene) return;
        scene.resize(host.clientWidth || 640);
        draw();
      });
      observer.observe(host);
    };

    void start().catch((cause: unknown) => {
      console.error('Pixi table failed to start:', cause);
      if (!disposed) setFailed(true);
    });

    return () => {
      disposed = true;
      detachDrag?.();
      observer?.disconnect();
      unsubscribe?.();
      scene?.destroy();
      app?.destroy(true, { children: true });
    };
  }, []);

  if (failed) {
    return (
      <section className="panel">
        <p>테이블을 그리지 못했습니다. 페이지를 새로고침해 주세요.</p>
      </section>
    );
  }

  return <div className="table-canvas" ref={hostRef} />;
}
