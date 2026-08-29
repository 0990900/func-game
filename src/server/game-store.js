const rooms = new Map();
export const gameStore = {
  add(room) { rooms.set(room.id, room); return room; },
  get(id) { return rooms.get(id); },
  values() { return rooms.values(); },
};
