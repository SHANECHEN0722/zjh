import { ref, onValue, set, update, push, remove, get, child, onDisconnect } from "firebase/database";
import { db } from "../firebase";

// === Users ===
export const subscribeUsers = (callback) => {
  const usersRef = ref(db, 'users');
  return onValue(usersRef, (snapshot) => {
    callback(snapshot.val() || {});
  });
};

export const addUser = async (name, chips) => {
  const usersRef = ref(db, 'users');
  const newUserRef = push(usersRef);
  const initialChips = Number(chips) || 300;
  await set(newUserRef, {
    name,
    chips: initialChips,
    totalTopUp: initialChips,
    avatar: `https://api.dicebear.com/7.x/adventurer/svg?seed=${name}`
  });
  return newUserRef.key;
};

export const removeUser = async (userId) => {
  await remove(ref(db, `users/${userId}`));
  await remove(ref(db, `room/players/${userId}`));
};

// === Room / Game ===
export const subscribeRoom = (callback) => {
  const roomRef = ref(db, 'room');
  return onValue(roomRef, (snapshot) => {
    const data = snapshot.val();
    if (!data || !data.status) {
      // Initialize if empty or missing core properties
      const defaultState = {
        status: "WAITING",
        pot: 0,
        currentBet: 10,
        turnIndex: 0,
        round: 1,
        players: data?.players || {}
      };
      set(roomRef, defaultState);
      callback(defaultState);
    } else {
      callback(data);
    }
  });
};

export const checkCanJoin = async () => {
  const roomSnap = await get(ref(db, 'room'));
  const data = roomSnap.val();
  if (data?.status === 'PLAYING') {
    // 防卡死：如果游戏中但实际上只有0-1人在桌上，说明是残局，允许新玩家进入并重置
    const playersCount = Object.keys(data?.players || {}).length;
    if (playersCount < 2) {
      return true;
    }
    return false;
  }
  return true;
};

export const joinTable = async (userId, userDetails) => {
  const roomSnap = await get(ref(db, 'room'));
  const roomData = roomSnap.val();
  
  let status = roomData?.status;
  const players = roomData?.players || {};
  const isExisting = !!players[userId];
  const playersCount = Object.keys(players).length;

  // 自动修复卡死的残局
  if (status === 'PLAYING' && playersCount < 2) {
    status = 'WAITING';
    await update(ref(db, 'room'), { status: 'WAITING', pot: 0, currentBet: 1, round: 1 });
  }

  if (status === 'PLAYING' && !isExisting) {
    throw new Error('GAME_IN_PROGRESS');
  }

  const playerRef = ref(db, `room/players/${userId}`);
  
  let newSeat = 1;
  const existingSeats = Object.values(players).map(p => p.seat || 0);
  while (existingSeats.includes(newSeat)) {
    newSeat++;
  }

  if (!isExisting) {
    await update(playerRef, {
      ...userDetails,
      isSitting: true,
      isSpectator: false,
      hasFolded: false,
      hasLooked: false,
      hasLost: false,
      eligibleForLuckyMoney: false,
      seat: newSeat,
      betInRound: 0,
      cards: []
    });
  } else {
    // 允许刷新/断线重连，只更新基本信息，不覆盖手中的牌
    await update(playerRef, {
      ...userDetails,
      isSitting: true
    });
  }
};

export const leaveTable = async (userId) => {
  const roomSnap = await get(ref(db, 'room'));
  const roomData = roomSnap.val();
  const players = roomData?.players || {};
  
  const remainingPlayers = Object.entries(players).filter(([id]) => id !== userId);
  remainingPlayers.sort((a, b) => (a[1].seat || 0) - (b[1].seat || 0));

  const updates = {};
  updates[`room/players/${userId}`] = null;
  remainingPlayers.forEach(([id], index) => {
    updates[`room/players/${id}/seat`] = index + 1;
  });

  // 如果人都走光了，或者只剩1个人且还在游戏中，自动重置牌局
  if (remainingPlayers.length <= 1 && roomData?.status === 'PLAYING') {
    updates['room/status'] = 'WAITING';
    updates['room/pot'] = 0;
    updates['room/currentBet'] = 1;
    updates['room/round'] = 1;
  }
  
  await update(ref(db), updates);
};

// Multi-path update for atomic transactions (e.g., updating room pot and user chips at once)
export const updateGameData = async (updates) => {
  await update(ref(db), updates);
};

export const fetchGameState = async () => {
  const snapshot = await get(ref(db));
  return snapshot.val() || {};
};
