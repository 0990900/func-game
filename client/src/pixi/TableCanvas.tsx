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
import { scrollPageTo, stickyClearance } from '../ui/scroll.ts';

/** Brings the market row into view — the next step once a hand card is chosen. */
function revealMarket(host: HTMLElement, marketTop: number): void {
  const top = host.getBoundingClientRect().top + window.scrollY + marketTop;
  scrollPageTo(top - stickyClearance());
}

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
      // Pixi sets touch-action:none, which suits a game that owns the whole
      // screen. Here the table is a tall element inside a scrolling page, so
      // blocking pans left nowhere to drag. Taps still reach the cards.
      created.canvas.style.touchAction = 'pan-y';

      await waitForFonts();
      const textures = await loadTableTextures();
      if (disposed) return;

      scene = new TableScene(created, textures, {
        onSelectHand: (card) => actions.selectCard(card.id),
        onSelectMarket: (card) => actions.selectMarket(card.id),
      }, host.clientWidth || 640);

      let lastSelected: string | null = null;

      const draw = (): void => {
        const { state, selectedCardId, selectedMarketId, previewCardId } = gameStore.getState();
        if (!state || !scene || !app) return;
        const height = scene.update({ state, selectedCardId, selectedMarketId, previewCardId });
        app.renderer.resize(host.clientWidth || 640, height);

        // On a narrow screen the market sits far below the hand, so choosing a
        // card would otherwise leave the next step off-screen.
        if (selectedCardId && !lastSelected) revealMarket(host, scene.getMarketTop());
        lastSelected = selectedCardId;
      };

      draw();
      unsubscribe = gameStore.subscribe(draw);

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
