import { Actor } from 'fun-fp-js';
import { gameInterpreter } from '../game/program.js';

export function createRoomActor(room) {
  return Actor({
    init: room,
    timeout: Infinity,
    handle: async (state, program) => {
      const transition = await gameInterpreter.run(program);
      return transition.run(state);
    },
  });
}

export function sendToActor(actor, program) {
  return new Promise((resolve, reject) => actor.send(program).fork(reject, resolve));
}
