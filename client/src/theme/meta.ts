/**
 * How game vocabulary is presented: symbols, Korean hints, status and event
 * labels. Ported from the legacy client so the wording players know is kept.
 */
import type { Card, ContainerName, EventType, PlayerStatus, ScoreBreakdown } from '../../../src/core/types.ts';

export const containerMeta: Record<ContainerName, { symbol: string; theme: string }> = {
  Maybe: { symbol: '◇', theme: 'maybe' },
  Either: { symbol: '◐', theme: 'either' },
  List: { symbol: '≡', theme: 'list' },
  Task: { symbol: 'ϟ', theme: 'task' },
};

/** Operation → [symbol, Korean hint]. */
export const operationMeta: Record<string, readonly [string, string]> = {
  map: ['↦', '구조를 유지해 변환'],
  ap: ['⊛', '함수를 구조 안에서 적용'],
  pure: ['η', '값을 구조에 올리기'],
  chain: ['⋙', '연산을 순서대로 연결'],
  alt: ['∨', '실패 시 다른 선택'],
  zero: ['∅', '빈 선택'],
  bimap: ['⇄', '양쪽 값을 함께 변환'],
  reduce: ['Σ', '여러 값을 하나로 접기'],
  traverse: ['⤨', '효과를 유지해 순회'],
};

export interface CardFace {
  readonly containerSymbol: string;
  readonly kindLabel: string;
  readonly operationSymbol: string;
  readonly operationLabel: string;
  readonly hint: string;
}

export function cardTheme(card: Card): string {
  if (card.kind === 'utility') return 'utility';
  if (card.kind.includes('wildcard')) return 'wildcard';
  return containerMeta[card.container as ContainerName]?.theme ?? 'neutral';
}

export function cardFace(card: Card): CardFace {
  if (card.kind === 'utility') {
    return {
      containerSymbol: 'λ',
      kindLabel: 'UTILITY',
      operationSymbol: 'ƒ',
      operationLabel: card.operation,
      hint: '다양성 점수 카드',
    };
  }
  if (card.kind.includes('wildcard')) {
    return {
      containerSymbol: '✦',
      kindLabel: 'WILDCARD',
      operationSymbol: card.operation === '*' ? '⁕' : operationMeta[card.operation]?.[0] ?? '⁕',
      operationLabel: card.label,
      hint: '필요한 자리를 대신합니다',
    };
  }
  const [symbol, hint] = operationMeta[card.operation] ?? ['·', '함수 연산'];
  return {
    containerSymbol: containerMeta[card.container as ContainerName]?.symbol ?? 'ƒ',
    kindLabel: String(card.container),
    operationSymbol: symbol,
    operationLabel: card.operation,
    hint,
  };
}

export const phaseName = (phase: string): string =>
  ({ lobby: '대기실', goal: '목표 선택', draft: '드래프트', finished: '종료' })[phase] ?? phase;

export const statusName = (status: PlayerStatus): string =>
  ({
    playing: '플레이 중',
    thinking: '생각 중…',
    claiming: 'Claim 선택',
    waiting: '대기 중',
    choosing_goal: '목표 선택 중',
    ready: '선택 완료',
    disconnected: '연결 끊김',
    finished: '종료',
    lobby: '대기실',
  })[status] ?? status;

export const eventIcon = (type: EventType | string): string =>
  ({
    pick: '↦', market: '⇄', claim: '★', claim_ready: '☆', pass: '➜',
    round_start: '◆', game_start: '◇', game_end: '■', turn_order: '①',
    join: '+', disconnect: '!', reconnect: '↻', goal_ready: '✓',
  })[type] ?? '·';

export const scoreSummary = (score: ScoreBreakdown): string =>
  `조합 ${score.comboScore} · Utility ${score.utilityScore} · Claim ${score.claimScore} · 비밀 목표 제외`;

export const directionName = (direction: string): string => (direction === 'left' ? '왼쪽' : '오른쪽');
