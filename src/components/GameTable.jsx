import React, { useState, useEffect } from 'react';
import { subscribeRoom, joinTable, leaveTable, updateGameData, fetchGameState, subscribeUsers } from '../services/db';
import { generateDeck, shuffleDeck, evaluateHand } from '../utils/pokerLogic';

const GameTable = ({ currentUser, onLogout }) => {
  const [room, setRoom] = useState(null);
  const [users, setUsers] = useState({});
  const [comparing, setComparing] = useState(false);
  const [flippedCards, setFlippedCards] = useState([false, false, false]);

  useEffect(() => {
    joinTable(currentUser.id, { name: currentUser.name, avatar: currentUser.avatar })
      .catch((error) => {
        if (error.message === 'GAME_IN_PROGRESS') {
          alert("牌局正在进行中，暂不允许加入。请稍等这局打完！");
          onLogout();
        }
      });
    const unsubRoom = subscribeRoom((data) => setRoom(data));
    const unsubUsers = subscribeUsers((data) => setUsers(data));
    return () => {
      unsubRoom();
      unsubUsers();
    };
  }, [currentUser]);

  if (!room || !room.players) return <div style={{ color: 'white', textAlign: 'center', padding: '50px' }}>Loading...</div>;

  const playersList = Object.entries(room.players || {}).sort((a, b) => (a[1].seat || 0) - (b[1].seat || 0));
  const activePlayers = playersList.filter(([_, p]) => !p.hasFolded && !p.hasLost && !p.isSpectator);
  const me = room.players[currentUser.id] || {};
  const isMyTurn = room.status === 'PLAYING' && playersList[room.turnIndex] && playersList[room.turnIndex][0] === currentUser.id && !me.isSpectator;
  const myRealChips = users[currentUser.id]?.chips || 0;
  const myTotalTopUp = users[currentUser.id]?.totalTopUp || users[currentUser.id]?.chips || 0;

  const handleTopUp = async () => {
    const amountStr = prompt("请输入注资筹码数量：", "100");
    if (!amountStr) return;
    const amount = Number(amountStr);
    if (isNaN(amount) || amount <= 0) {
      alert("请输入有效的正数金额！");
      return;
    }
    const state = await fetchGameState();
    const current = state.users[currentUser.id]?.chips || 0;
    const currentTotal = state.users[currentUser.id]?.totalTopUp || current;
    await updateGameData({ 
      [`users/${currentUser.id}/chips`]: current + amount,
      [`users/${currentUser.id}/totalTopUp`]: currentTotal + amount
    });
  };

  const advanceTurn = async (currentPlayers, currentIndex, updates, extraLogic = () => {}) => {
    let nextIndex = (currentIndex + 1) % currentPlayers.length;
    let loopCount = 0;
    while ((currentPlayers[nextIndex][1].hasFolded || currentPlayers[nextIndex][1].hasLost || currentPlayers[nextIndex][1].isSpectator) && loopCount < currentPlayers.length) {
      nextIndex = (nextIndex + 1) % currentPlayers.length;
      loopCount++;
    }

    const remaining = currentPlayers.filter(([_, p]) => !p.hasFolded && !p.hasLost && !p.isSpectator);
    if (remaining.length === 1) {
      // 结算
      const winnerId = remaining[0][0];
      const state = await fetchGameState();
      const pot = updates['room/pot'] !== undefined ? updates['room/pot'] : state.room.pot;
      
      let luckyLogs = [];
      let netChanges = {};
      const allPlayerIds = Object.keys(state.room.players);
      allPlayerIds.forEach(id => netChanges[id] = 0);
      
      // 赢家获得底池
      netChanges[winnerId] += pot;

      // 喜钱结算
      allPlayerIds.forEach(pId => {
        const pData = state.room.players[pId];
        if (pData.isSpectator) return; // 旁观者不参与喜钱

        const hand = evaluateHand(pData.cards);
        if ((hand.type === 6 || hand.type === 5) && pData.eligibleForLuckyMoney) {
          const reward = hand.type === 6 ? 10 : 5;
          const name = hand.type === 6 ? "豹子" : "顺金";
          luckyLogs.push(`【${pData.name}】拿到 ${name}，获得喜钱！`);
          // 其他参与者付给 pId
          allPlayerIds.forEach(payerId => {
            const payerData = state.room.players[payerId];
            if (payerId !== pId && !payerData.isSpectator) {
              netChanges[payerId] -= reward;
              netChanges[pId] += reward;
            }
          });
        }
      });

      // 应用芯片更新
      allPlayerIds.forEach(pId => {
        const currentChips = updates[`users/${pId}/chips`] !== undefined ? updates[`users/${pId}/chips`] : (state.users[pId]?.chips || 0);
        updates[`users/${pId}/chips`] = currentChips + netChanges[pId];
      });

      // 记录这局最终盈亏，存入 room
      let lastSettlement = [];
      allPlayerIds.forEach(pId => {
        const initial = state.room.players[pId]?.initialChips || 0;
        const finalChips = updates[`users/${pId}/chips`];
        const net = finalChips - initial;
        lastSettlement.push({ name: state.room.players[pId].name, net });
      });
      
      updates['room/lastSettlement'] = lastSettlement;
      updates['room/lastWinnerId'] = winnerId;
      
      const stayingPlayers = allPlayerIds
        .filter(pId => !state.room.players[pId].wantsToLeave)
        .sort((a, b) => (state.room.players[a].seat || 0) - (state.room.players[b].seat || 0));
        
      stayingPlayers.forEach((pId, index) => {
        updates[`room/players/${pId}/seat`] = index + 1;
      });
      allPlayerIds.filter(pId => state.room.players[pId].wantsToLeave).forEach(pId => {
        updates[`room/players/${pId}`] = null;
      });

      updates['room/status'] = 'WAITING';
      updates['room/pot'] = 0;
      
      extraLogic(winnerId, luckyLogs);
    } else {
      updates['room/turnIndex'] = nextIndex;
    }
  };

  const handleStartGame = async () => {
    if (playersList.length < 2) {
      alert("至少需要2人才能开始！");
      return;
    }
    
    setFlippedCards([false, false, false]);
    
    const state = await fetchGameState();
    const baseAnte = 1;
    let hasPoorPlayer = false;
    let poorNames = [];
    playersList.forEach(([pId, p]) => {
      if ((state.users[pId]?.chips || 0) < baseAnte) {
        hasPoorPlayer = true;
        poorNames.push(p.name);
      }
    });

    if (hasPoorPlayer) {
      alert(`玩家【${poorNames.join(", ")}】筹码不足 1，无法开局！请提醒他们注资。`);
      return;
    }

    const deck = shuffleDeck(generateDeck());
    const updates = {};
    let initialPot = 0;

    playersList.forEach(([pId, p], index) => {
      const userChips = state.users[pId]?.chips || 0;
      updates[`users/${pId}/chips`] = userChips - baseAnte;
      initialPot += baseAnte;

      const cards = [deck.pop(), deck.pop(), deck.pop()];
      updates[`room/players/${pId}/cards`] = cards;
      updates[`room/players/${pId}/isSpectator`] = false;
      updates[`room/players/${pId}/hasLooked`] = false;
      updates[`room/players/${pId}/hasFolded`] = false;
      updates[`room/players/${pId}/hasLost`] = false;
      updates[`room/players/${pId}/eligibleForLuckyMoney`] = false;
      updates[`room/players/${pId}/betInRound`] = baseAnte;
      updates[`room/players/${pId}/initialChips`] = state.users[pId]?.chips || 0;
    });

    let nextTurnIndex = 0;
    if (state.room?.lastWinnerId) {
      const winnerIndex = playersList.findIndex(([id]) => id === state.room.lastWinnerId);
      if (winnerIndex !== -1) {
        nextTurnIndex = (winnerIndex + 1) % playersList.length;
      }
    }

    updates['room/status'] = 'PLAYING';
    updates['room/pot'] = initialPot;
    updates['room/currentBet'] = baseAnte;
    updates['room/turnIndex'] = nextTurnIndex;
    updates['room/round'] = 1;

    await updateGameData(updates);
  };

  const handleLook = async (fullReveal) => {
    if (fullReveal) {
      setFlippedCards([true, true, true]);
    } else {
      setFlippedCards([false, false, false]);
    }
    const updates = {};
    updates[`room/players/${currentUser.id}/hasLooked`] = true;
    await updateGameData(updates);
  };

  const handleFold = async () => {
    const updates = {};
    updates[`room/players/${currentUser.id}/hasFolded`] = true;
    
    const nextPlayers = [...playersList];
    const myIndex = nextPlayers.findIndex(([id]) => id === currentUser.id);
    nextPlayers[myIndex][1].hasFolded = true;

    await advanceTurn(nextPlayers, room.turnIndex, updates, (winnerId, logs) => {
       alert(`${winnerId === currentUser.id ? "你" : nextPlayers.find(p=>p[0]===winnerId)[1].name} 赢得了底池！\n${logs.join('\n')}`);
    });
    await updateGameData(updates);
  };

  const payBet = async (amount, updates, state) => {
    const userChips = state.users[currentUser.id]?.chips || 0;
    // 允许筹码扣除到负数
    updates[`users/${currentUser.id}/chips`] = userChips - amount;
    updates[`room/pot`] = room.pot + amount;
    updates[`room/players/${currentUser.id}/betInRound`] = me.betInRound + amount;
  };

  const handleCall = async () => {
    const state = await fetchGameState();
    const updates = {};
    const cost = me.hasLooked ? room.currentBet * 2 : room.currentBet;
    
    if (myRealChips < cost) {
      alert(`筹码不足以跟注（需要 ${cost}），请注资、弃牌或比牌！`);
      return;
    }

    if (!me.hasLooked) {
      updates[`room/players/${currentUser.id}/eligibleForLuckyMoney`] = true;
    }

    await payBet(cost, updates, state);
    await advanceTurn(playersList, room.turnIndex, updates, (winnerId, logs) => {
      alert(`游戏结束！\n${logs.join('\n')}`);
    });
    await updateGameData(updates);
  };

  const handleRaise = async (newBet) => {
    const state = await fetchGameState();
    const updates = {};
    const cost = me.hasLooked ? newBet * 2 : newBet;
    
    if (myRealChips < cost) {
      alert(`筹码不足以加注（需要 ${cost}）！`);
      return;
    }

    if (!me.hasLooked) {
      updates[`room/players/${currentUser.id}/eligibleForLuckyMoney`] = true;
    }

    updates['room/currentBet'] = newBet;
    await payBet(cost, updates, state);
    await advanceTurn(playersList, room.turnIndex, updates, (winnerId, logs) => {
      alert(`游戏结束！\n${logs.join('\n')}`);
    });
    await updateGameData(updates);
  };

  const initiateCompare = () => {
    setComparing(true);
  };

  const executeCompare = async (targetId) => {
    setComparing(false);
    const targetPlayer = room.players[targetId];
    
    // 统计场上的暗牌数量
    const activeBlindCount = activePlayers.filter(([_, p]) => !p.hasLooked).length;

    if (me.hasLooked && !targetPlayer.hasLooked && activeBlindCount >= 2) {
      alert("场上暗牌数量大于等于2时，明牌不能主动开暗牌！");
      return;
    }

    const state = await fetchGameState();
    const updates = {};
    const cost = me.hasLooked ? room.currentBet * 2 : room.currentBet;
    
    if (myRealChips < cost) {
      alert(`筹码不足以比牌（需要 ${cost}）！`);
      return;
    }

    if (!me.hasLooked) {
      updates[`room/players/${currentUser.id}/eligibleForLuckyMoney`] = true;
    }

    await payBet(cost, updates, state);

    const myHand = evaluateHand(me.cards);
    const targetHand = evaluateHand(targetPlayer.cards);

    const myWin = myHand.weight > targetHand.weight;
    let loserId = myWin ? targetId : currentUser.id;
    updates[`room/players/${loserId}/hasLost`] = true;

    const nextPlayers = [...playersList];
    const loserIndex = nextPlayers.findIndex(([id]) => id === loserId);
    nextPlayers[loserIndex][1].hasLost = true;

    const cardStr = targetPlayer.cards.map(c => {
      const valDisplay = c.value === 14 ? 'A' : c.value === 13 ? 'K' : c.value === 12 ? 'Q' : c.value === 11 ? 'J' : c.value;
      return `${getCardSymbol(c.suit)}${valDisplay}`;
    }).join(' ');

    await advanceTurn(nextPlayers, room.turnIndex, updates, (winnerId, logs) => {
       setTimeout(() => {
         alert(`【游戏结束】\n最终赢家：${winnerId === currentUser.id ? "你" : nextPlayers.find(p=>p[0]===winnerId)[1].name}\n${logs.join('\n')}`);
       }, 500);
    });
    
    await updateGameData(updates);

    // 花钱比牌的人有权查看对方的牌
    alert(`【比牌结果】\n你 ${myWin ? '赢' : '输'} 了！\n对方 (${targetPlayer.name}) 的牌是：${cardStr}`);
  };

  const getCardSymbol = (suit) => {
    switch(suit) {
      case 'hearts': return '♥';
      case 'diamonds': return '♦';
      case 'clubs': return '♣';
      case 'spades': return '♠';
      default: return '';
    }
  };

  const renderCard = (card, index, hidden = false, onClick = null) => {
    const key = card ? `${card.suit}-${card.value}` : `hidden-${index}`;
    if (hidden) {
      return (
      <div className="playing-card card-deal-anim" key={key} onClick={onClick} style={{ cursor: onClick ? 'pointer' : 'default' }}>
        <div className="card-inner">
          <div className="card-face card-back"></div>
        </div>
      </div>
      );
    }
    const isRed = card.suit === 'hearts' || card.suit === 'diamonds';
    const valDisplay = card.value === 14 ? 'A' : card.value === 13 ? 'K' : card.value === 12 ? 'Q' : card.value === 11 ? 'J' : card.value;
    return (
      <div className="playing-card flipped card-deal-anim" key={key} onClick={onClick} style={{ cursor: onClick ? 'pointer' : 'default' }}>
        <div className="card-inner">
          <div className={`card-face card-front ${isRed ? 'red' : 'black'}`} data-value={valDisplay} data-suit={getCardSymbol(card.suit)}>
            <div style={{ fontSize: '1.8rem' }}>{getCardSymbol(card.suit)}</div>
          </div>
        </div>
      </div>
    );
  };

  const raiseOptions = [2, 3, 4, 5].filter(val => val > room.currentBet);

  return (
    <div className="app-container" style={{ justifyContent: 'space-between' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
           <div className="avatar" style={{ width: 40, height: 40 }}>
             <img src={currentUser.avatar} alt="avatar" />
           </div>
           <div>
             <div style={{ fontWeight: 'bold' }}>
               <span style={{ color: 'var(--primary-color)' }}>[{me.seat || '?'}号位] </span>
               {currentUser.name}
             </div>
             <div style={{ fontSize: '0.8rem', color: '#fbbf24', fontWeight: 'bold', display: 'flex', alignItems: 'center', gap: '5px' }}>
               筹码: 💰 {myRealChips} <span style={{ color: 'var(--text-muted)', fontSize: '0.7rem', fontWeight: 'normal' }}>(总入: {myTotalTopUp})</span>
               <button onClick={handleTopUp} style={{ background: '#3b82f6', border: 'none', borderRadius: '4px', color: 'white', padding: '0 4px', cursor: 'pointer' }}>➕注资</button>
             </div>
           </div>
        </div>
        <div style={{ display: 'flex', gap: '10px' }}>
          <button className="btn btn-outline" onClick={async () => {
             if (window.confirm("确定要强制解散吗？当前牌局将被作废，所有下注筹码将全额退还，且所有人将被踢下桌。")) {
               const state = await fetchGameState();
               const updates = {
                 'room/status': 'WAITING',
                 'room/pot': 0,
                 'room/players': null,
                 'room/currentBet': 1,
                 'room/round': 1
               };
               
               if (state.room?.status === 'PLAYING' && state.room?.players) {
                 Object.entries(state.room.players).forEach(([pId, pData]) => {
                   if (pData.betInRound > 0 && state.users[pId]) {
                     updates[`users/${pId}/chips`] = (state.users[pId].chips || 0) + pData.betInRound;
                   }
                 });
               }

               await updateGameData(updates);
             }
          }} style={{ padding: '4px 10px', fontSize: '0.75rem', borderColor: '#ef4444', color: '#ef4444' }}>
            强制解散
          </button>
          <button className="btn btn-outline" onClick={async () => {
            if (room.status === 'PLAYING') {
               if (!me.hasFolded && !me.hasLost && !me.isSpectator) {
                 if (!window.confirm("你当前还在牌局中，退出将自动视为【弃牌】并扣除已下注筹码。确认退出吗？")) {
                   return;
                 }
                 const updates = {};
                 updates[`room/players/${currentUser.id}/hasFolded`] = true;
                 updates[`room/players/${currentUser.id}/wantsToLeave`] = true;
                 
                 const nextPlayers = JSON.parse(JSON.stringify(playersList));
                 const myIndex = nextPlayers.findIndex(([id]) => id === currentUser.id);
                 nextPlayers[myIndex][1].hasFolded = true;
                 nextPlayers[myIndex][1].wantsToLeave = true;

                 await advanceTurn(nextPlayers, room.turnIndex, updates, (winnerId, logs) => {
                   alert(`游戏结束！\n${logs.join('\n')}`);
                 });
                 await updateGameData(updates);
               } else {
                 const updates = {};
                 updates[`room/players/${currentUser.id}/wantsToLeave`] = true;
                 await updateGameData(updates);
               }
               onLogout();
            } else {
               leaveTable(currentUser.id);
               onLogout();
            }
          }} style={{ padding: '4px 10px', fontSize: '0.75rem' }}>
            退出房间
          </button>
        </div>
      </div>

      <div style={{ flex: 1, position: 'relative', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', margin: '20px 0' }}>
        <div style={{ position: 'absolute', top: 20, textAlign: 'center', width: '100%' }}>
          <div className="pot-container">
            <div style={{ fontSize: '0.9rem', color: 'rgba(255,255,255,0.8)', fontWeight: 'bold' }}>总底池</div>
            <div className="text-gradient" style={{ fontSize: '2.2rem', fontWeight: '900', lineHeight: 1 }}>{room.pot}</div>
          </div>
          <div className="chip" style={{ marginTop: '15px' }}>
            暗注: {room.currentBet} / 明注: {room.currentBet * 2}
          </div>
        </div>

        {room.status === 'WAITING' && room.lastSettlement && (
          <div className="glass-panel" style={{ position: 'absolute', top: 160, padding: '15px 25px', zIndex: 10, background: 'rgba(0,0,0,0.6)' }}>
            <div style={{ fontSize: '0.9rem', color: 'var(--text-gold)', marginBottom: 10, textAlign: 'center', fontWeight: 'bold' }}>上局结算榜</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '15px' }}>
              {room.lastSettlement.map((s, i) => (
                <div key={i} style={{ fontSize: '0.9rem' }}>
                  {s.name}: <span style={{ color: s.net > 0 ? '#10b981' : s.net < 0 ? '#ef4444' : 'white', fontWeight: 'bold' }}>{s.net > 0 ? '+' : ''}{s.net}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'center', gap: '20px', width: '100%', marginTop: '120px' }}>
          {playersList.filter(([id, p]) => id !== currentUser.id && !p.isSpectator).map(([id, player]) => {
            const isTurn = room.status === 'PLAYING' && playersList[room.turnIndex][0] === id;
            const isSelectableForCompare = comparing && !player.hasFolded && !player.hasLost;
            
            return (
              <div 
                key={id} 
                style={{ 
                  display: 'flex', flexDirection: 'column', alignItems: 'center', 
                  opacity: (player.hasFolded || player.hasLost) ? 0.4 : 1,
                  transform: isSelectableForCompare ? 'scale(1.1)' : 'none',
                  cursor: isSelectableForCompare ? 'pointer' : 'default',
                  transition: 'all 0.3s'
                }}
                onClick={() => isSelectableForCompare && executeCompare(id)}
              >
                <div className={`avatar ${isTurn ? 'active-turn' : ''}`} style={{ width: 50, height: 50, border: isSelectableForCompare ? '3px solid var(--primary-color)' : '' }}>
                   <img src={player.avatar || `https://api.dicebear.com/7.x/adventurer/svg?seed=${player.name}`} alt="avatar" />
                </div>
                <div style={{ fontSize: '0.8rem', marginTop: 4 }}>
                   <span style={{ color: 'var(--text-muted)' }}>[{player.seat || '?'}] </span>
                   {player.name}
                </div>
                <div style={{ fontSize: '0.7rem', color: '#fbbf24', fontWeight: 'bold', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                  <span>💰 {users[id]?.chips || 0}</span>
                  <span style={{ color: 'var(--text-muted)', fontSize: '0.6rem', fontWeight: 'normal' }}>(总入: {users[id]?.totalTopUp || users[id]?.chips || 0})</span>
                </div>
                <div className="chip" style={{ fontSize: '0.6rem', padding: '1px 6px', marginTop: 2 }}>
                  {player.wantsToLeave ? '已离座' : player.hasFolded ? '已弃牌' : player.hasLost ? '比牌输' : player.hasLooked ? '已看牌' : '暗牌'}
                </div>
                {room.status === 'PLAYING' && !player.hasFolded && !player.hasLost && !player.wantsToLeave && (
                  <div style={{ display: 'flex', marginTop: 10 }}>
                    {[1,2,3].map((_, i) => renderCard(null, i, true))}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* 等待区 (Spectators) */}
        {playersList.filter(([id, p]) => p.isSpectator && id !== currentUser.id).length > 0 && (
          <div style={{ width: '100%', marginTop: '30px', paddingTop: '15px', borderTop: '1px solid rgba(255,255,255,0.1)' }}>
             <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', textAlign: 'center', marginBottom: '10px' }}>等待区 (下局自动上桌)</div>
             <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'center', gap: '15px' }}>
               {playersList.filter(([id, p]) => p.isSpectator && id !== currentUser.id).map(([id, player]) => (
                 <div key={id} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', opacity: 0.6 }}>
                    <div className="avatar" style={{ width: 35, height: 35 }}>
                       <img src={player.avatar || `https://api.dicebear.com/7.x/adventurer/svg?seed=${player.name}`} alt="avatar" />
                    </div>
                    <div style={{ fontSize: '0.7rem', marginTop: 2 }}>{player.name}</div>
                 </div>
               ))}
             </div>
          </div>
        )}
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '15px' }}>
        <div style={{ display: 'flex' }}>
           {room.status === 'PLAYING' && !me.isSpectator ? (
             me.cards?.map((c, i) => {
               const isHidden = me.hasLooked ? !flippedCards[i] : true;
               const canClick = me.hasLooked && !flippedCards[i];
               return renderCard(c, i, isHidden, canClick ? () => {
                 const newFlipped = [...flippedCards];
                 newFlipped[i] = true;
                 setFlippedCards(newFlipped);
               } : null);
             })
           ) : room.status === 'WAITING' && me.cards?.length > 0 && !me.isSpectator ? (
             <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
               <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: 5 }}>上局底牌 (已摊牌)</div>
               <div style={{ display: 'flex' }}>
                 {me.cards?.map((c, i) => renderCard(c, i, false))}
               </div>
             </div>
           ) : (
             <div style={{ height: 'var(--card-height)', display: 'flex', alignItems: 'center', color: 'var(--text-muted)' }}>
               {me.isSpectator ? '游戏进行中，请等待下一局...' : '等待开始...'}
             </div>
           )}
        </div>
        
        {comparing && (
           <div style={{ color: 'var(--primary-color)', fontWeight: 'bold', animation: 'pulse-glow 1s infinite' }}>
             请点击上方的玩家头像进行比牌
             <button className="btn btn-outline" style={{ marginLeft: 10, padding: '2px 8px' }} onClick={() => setComparing(false)}>取消</button>
           </div>
        )}

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px', justifyContent: 'center' }}>
          {room.status === 'WAITING' && (
            <button className="btn btn-primary" onClick={handleStartGame} style={{ width: '100%', maxWidth: '300px' }}>
              开始发牌 ({playersList.length}人就绪)
            </button>
          )}

          {room.status === 'PLAYING' && !me.hasFolded && !me.hasLost && !me.isSpectator && (
            <>
              {!me.hasLooked && (
                <div style={{ display: 'flex', gap: '5px' }}>
                  <button className="btn btn-outline" onClick={() => handleLook(true)}>
                    直接看牌 👀
                  </button>
                  <button className="btn btn-outline" style={{ background: 'rgba(255,255,255,0.05)' }} onClick={() => handleLook(false)}>
                    搓牌 👆
                  </button>
                </div>
              )}
              <button className="btn btn-danger" onClick={handleFold} disabled={!isMyTurn || comparing}>
                弃牌 🏳️
              </button>
              <button className="btn btn-primary" onClick={handleCall} disabled={!isMyTurn || comparing}>
                跟注 ({me.hasLooked ? room.currentBet * 2 : room.currentBet})
              </button>
              
              {isMyTurn && !comparing && raiseOptions.map(val => (
                <button key={`raise-${val}`} className="btn btn-success" onClick={() => handleRaise(val)}>
                  加注到 ({me.hasLooked ? val * 2 : val})
                </button>
              ))}

              <button className="btn btn-outline" style={{ borderColor: 'var(--primary-color)', color: 'var(--primary-color)' }} onClick={initiateCompare} disabled={!isMyTurn || comparing || activePlayers.length < 2}>
                比牌 ⚔️
              </button>
            </>
          )}

          {(me.hasFolded || me.hasLost) && room.status === 'PLAYING' && (
             <div style={{ color: 'var(--text-muted)' }}>本局您已出局，等待下局开始...</div>
          )}
        </div>
      </div>
    </div>
  );
};

export default GameTable;
