import { createRoomActor } from './room-actor.js';

const rooms = new Map();
export const gameStore = {
  add(room) {
    const actor = createRoomActor(room);
    rooms.set(room.id, actor);
    return actor;
  },
  actor(id) { return rooms.get(id); },
  get(id) { return rooms.get(id)?.getState(); },
  values() { return [...rooms.values()].map((actor) => actor.getState()); },
};
