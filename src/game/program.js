import { Free, State } from 'fun-fp-js';
import {
  chooseGoal,
  claimCombo,
  finishClaim,
  joinRoom,
  playBotTurn,
  setPlayerConnection,
  startGame,
  submitPick,
} from './game.js';

export const Game = Free.api(
  'joinRoom',
  'startGame',
  'chooseGoal',
  'pick',
  'claim',
  'finishClaim',
  'botTurn',
  'setConnection',
);

const transition = (effect) => new State((room) => {
  const nextRoom = structuredClone(room);
  const result = effect(nextRoom);
  return [result, nextRoom];
});

export const gameInterpreter = Free.interpreter(Game, {
  joinRoom: (name) => transition((room) => joinRoom(room, name)),
  startGame: (playerId) => transition((room) => {
    if (playerId !== room.hostPlayerId) throw new Error('방장만 시작할 수 있습니다.');
    startGame(room);
  }),
  chooseGoal: (playerId, goalId) => transition((room) => chooseGoal(room, playerId, goalId)),
  pick: (playerId, cardId, marketCardId) => transition((room) => submitPick(room, playerId, cardId, marketCardId)),
  claim: (playerId, container, name) => transition((room) => claimCombo(room, playerId, container, name)),
  finishClaim: (playerId) => transition((room) => finishClaim(room, playerId)),
  botTurn: (playerId) => transition((room) => playBotTurn(room, playerId)),
  setConnection: (playerId, connected) => transition((room) => setPlayerConnection(room, playerId, connected)),
});
