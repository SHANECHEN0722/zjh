const SUITS = ['hearts', 'diamonds', 'clubs', 'spades'];
// Values: 2-14 (14 = Ace)
const VALUES = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14];

export const generateDeck = () => {
  const deck = [];
  for (const suit of SUITS) {
    for (const value of VALUES) {
      deck.push({ suit, value });
    }
  }
  return deck;
};

export const shuffleDeck = (deck) => {
  const shuffled = [...deck];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
};

// Evaluate hand type
// 6: 豹子 (Leopard/Three of a kind)
// 5: 顺金 (Straight Flush)
// 4: 金花 (Flush)
// 3: 顺子 (Straight)
// 2: 对子 (Pair)
// 1: 单张 (High Card)
export const evaluateHand = (cards) => {
  if (!cards || cards.length !== 3) return { type: 0, weight: 0 };
  
  const sorted = [...cards].sort((a, b) => b.value - a.value); // Descending
  const v1 = sorted[0].value;
  const v2 = sorted[1].value;
  const v3 = sorted[2].value;

  const isFlush = sorted[0].suit === sorted[1].suit && sorted[1].suit === sorted[2].suit;
  
  // A23 is a special straight in some variations, but standard is AKQ ... 32A is not allowed, or A23 is smallest. 
  // Let's assume standard straight logic: values are consecutive.
  let isStraight = false;
  let straightMax = v1;
  if (v1 === v2 + 1 && v2 === v3 + 1) {
    isStraight = true;
  } else if (v1 === 14 && v2 === 3 && v3 === 2) {
    // Special A23 straight
    isStraight = true;
    straightMax = 3; // 3 is the top card of A23 in terms of straight comparison
    // Reorder for correct comparison weight
    sorted[0] = cards.find(c => c.value === 3);
    sorted[1] = cards.find(c => c.value === 2);
    sorted[2] = cards.find(c => c.value === 14);
  }

  const isThreeOfAKind = v1 === v2 && v2 === v3;
  const isPair = v1 === v2 || v2 === v3;

  let type = 1; // High card
  if (isThreeOfAKind) type = 6;
  else if (isStraight && isFlush) type = 5;
  else if (isFlush) type = 4;
  else if (isStraight) type = 3;
  else if (isPair) type = 2;

  // Calculate a unique weight for comparison
  // Base weight by type shifted by 20 bits
  // Then card 1 shifted by 12, card 2 by 8, card 3 by 4
  let weight = type * 1000000;
  
  if (type === 2) { // Pair
    const pairValue = v1 === v2 ? v1 : v3;
    const kicker = v1 === v2 ? v3 : v1;
    weight += pairValue * 10000 + kicker * 100;
  } else if (isStraight && straightMax === 3) { // A23
    weight += 3 * 10000 + 2 * 100 + 14; 
  } else {
    weight += sorted[0].value * 10000 + sorted[1].value * 100 + sorted[2].value;
  }

  return { type, weight, sortedCards: sorted };
};
