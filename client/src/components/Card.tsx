import { cardFace, cardTheme } from '../theme/meta.ts';
import type { Card as CardModel } from '../../../src/core/types.ts';

interface CardProps {
  readonly card: CardModel;
  readonly selected?: boolean;
  readonly disabled?: boolean;
  readonly onClick?: (card: CardModel) => void;
}

/**
 * Milestone C renders cards as DOM so the game is playable before the canvas
 * exists. Milestone D moves the table to Pixi; this component's props are the
 * contract the sprites will honour.
 */
export function Card({ card, selected = false, disabled = false, onClick }: CardProps) {
  const face = cardFace(card);
  return (
    <button
      type="button"
      className={`card card--${cardTheme(card)}${selected ? ' selected' : ''}`}
      disabled={disabled || !onClick}
      aria-pressed={onClick ? selected : undefined}
      onClick={onClick ? () => onClick(card) : undefined}
    >
      <span className="card-top">
        <span className="card-sigil">{face.containerSymbol}</span>
        <span className="kind">{face.kindLabel}</span>
      </span>
      <span className="operation-symbol" aria-hidden="true">{face.operationSymbol}</span>
      <span className="label">{face.operationLabel}</span>
      <span className="card-hint">{face.hint}</span>
    </button>
  );
}
