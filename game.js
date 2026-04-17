// ===================== 定数 =====================
const SUITS = ['♠', '♥', '♦', '♣'];
const RANKS = ['3','4','5','6','7','8','9','10','J','Q','K','A','2'];
const RANK_ORDER = { '3':3,'4':4,'5':5,'6':6,'7':7,'8':8,'9':9,'10':10,'J':11,'Q':12,'K':13,'A':14,'2':15,'JOKER':16 };
const RANK_BY_VAL = Object.fromEntries(Object.entries(RANK_ORDER).map(([k,v]) => [v,k]));
const RANK_NAMES = ['大富豪', '富豪', '平民', '大貧民'];

const EFFECT_INFO = {
  '4':  { name: '死者蘇生', color: '#8e44ad' },
  '5':  { name: 'スキップ',  color: '#2980b9' },
  '6':  { name: '強制縛り',  color: '#16a085' },
  '7':  { name: '７渡し',    color: '#27ae60' },
  '8':  { name: '８切り',    color: '#e74c3c' },
  '9':  { name: '９回し',    color: '#d35400' },
  '10': { name: '10捨て',   color: '#e67e22' },
  'J':  { name: '11バック', color: '#c0392b' },
};

// ===================== ゲーム設定 =====================
let gameConfig = {
  totalRounds: 1,
  currentRound: 0,
  points: [0, 0, 0, 0],   // 累計点数（低いほど良い）
  prevRanks: null,          // playerIdx → rank(0-3)
};

// ===================== ゲーム状態 =====================
let state = {
  players: [],
  field: [],
  discardPile: [],
  currentPlayer: 0,
  passCount: 0,
  revolution: false,
  elevenBack: false,
  skipNext: false,
  numberLock: null,
  suitLock: null,
  roundStarter: null,   // このラウンドの最初のプレイヤー
  trickStarter: null,   // 現在の場を最初に出したプレイヤー
  finishRanks: [],
  gameOver: false,
};

// ===================== 新カードハイライト =====================
let newCardIds = new Set();
let newCardTimer = null;

function highlightNewCards(cards) {
  if (!cards || cards.length === 0) return;
  cards.forEach(c => newCardIds.add(c.id));
  clearTimeout(newCardTimer);
  newCardTimer = setTimeout(() => {
    newCardIds.clear();
    renderPlayerHand();
  }, 2500);
}

// ===================== エフェクトモーダル =====================
let effectCallback = null;
let effectSelectedIds = [];
let effectMaxCount = 0;
let effectExact = false;
let effectModalCards = [];

// ===================== カード生成 =====================
function createDeck() {
  const deck = [];
  for (const suit of SUITS)
    for (const rank of RANKS)
      deck.push({ suit, rank, id: `${suit}${rank}` });
  deck.push({ suit: '🃏', rank: 'JOKER', id: 'JOKER' });
  return deck;
}

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function cardValue(card) {
  const v = RANK_ORDER[card.rank];
  const reversed = state.revolution !== state.elevenBack;
  return reversed ? (17 - v) : v;
}

function sortHand(hand) {
  hand.sort((a, b) => RANK_ORDER[a.rank] - RANK_ORDER[b.rank]);
}

function getNextActivePlayer(fromIdx) {
  let next = (fromIdx + 1) % 4;
  for (let i = 0; i < 4; i++) {
    if (!state.players[next].finished) return next;
    next = (next + 1) % 4;
  }
  return next;
}

// ===================== 縛りヘルパー =====================
function getMainRank(cards) {
  const nj = cards.filter(c => c.rank !== 'JOKER');
  return nj.length > 0 ? nj[0].rank : null;
}

function getMainSuit(cards) {
  const nj = cards.filter(c => c.rank !== 'JOKER');
  if (nj.length === 0) return null;
  const s = nj[0].suit;
  return nj.every(c => c.suit === s) ? s : null;
}

function resetField() {
  state.discardPile.push(...state.field);
  state.field = [];
  state.passCount = 0;
  state.elevenBack = false;
  state.numberLock = null;
  state.suitLock = null;
  state.trickStarter = null;
}

function updateLocks(prevField, newCards) {
  const prevRank = getMainRank(prevField);
  const prevSuit = getMainSuit(prevField);
  const newRank  = getMainRank(newCards);
  const newSuit  = getMainSuit(newCards);

  if (prevRank && newRank && RANK_ORDER[newRank] === RANK_ORDER[prevRank] + 1) {
    const nextVal = RANK_ORDER[newRank] + 1;
    state.numberLock = RANK_BY_VAL[nextVal] || null;
  } else {
    state.numberLock = null;
  }

  if (!state.suitLock && prevSuit && newSuit && prevSuit === newSuit) {
    state.suitLock = newSuit;
  }
}

// ===================== オーバーレイ制御 =====================
function selectRounds(n) {
  gameConfig.totalRounds = n;
  document.querySelectorAll('.round-btn').forEach(b => b.classList.remove('selected'));
  event.target.classList.add('selected');
  document.getElementById('round-selector').classList.add('hidden');
  const btn = document.getElementById('overlay-action-btn');
  btn.textContent = 'ゲーム開始';
  btn.classList.remove('hidden');
}

function overlayAction() {
  document.getElementById('overlay').classList.add('hidden');
  startRound();
}

// ===================== ラウンド開始 =====================
function startRound() {
  gameConfig.currentRound++;
  const deck = shuffle(createDeck());

  state = {
    players: ['あなた','CPU1','CPU2','CPU3'].map((name, i) => ({
      id: i, name, hand: [], isHuman: i === 0, finished: false, rank: null,
    })),
    field: [],
    discardPile: [],
    currentPlayer: 0,
    passCount: 0,
    revolution: false,
    elevenBack: false,
    skipNext: false,
    numberLock: null,
    suitLock: null,
    roundStarter: null,
    trickStarter: null,
    finishRanks: [],
    gameOver: false,
  };

  deck.forEach((card, i) => state.players[i % 4].hand.push(card));
  state.players.forEach(p => sortHand(p.hand));

  updateRoundIndicator();
  render();

  if (gameConfig.prevRanks) {
    setMessage('カード交換中…');
    doCardExchange(() => beginPlay());
  } else {
    beginPlay();
  }
}

function beginPlay() {
  // ♠3 持ちから開始
  for (let i = 0; i < 4; i++) {
    if (state.players[i].hand.some(c => c.suit === '♠' && c.rank === '3')) {
      state.currentPlayer = i;
      break;
    }
  }
  state.roundStarter = state.currentPlayer;
  render();
  setMessage(`${state.players[state.currentPlayer].name}のターンです`);
  if (!state.players[state.currentPlayer].isHuman) {
    setTimeout(cpuTurn, 800);
  } else {
    enableActions(true);
  }
}

// ===================== カード交換 =====================
function doCardExchange(callback) {
  const pr = gameConfig.prevRanks;
  const daihugo  = state.players.find(p => pr[p.id] === 0);
  const fugo     = state.players.find(p => pr[p.id] === 1);
  const heimin   = state.players.find(p => pr[p.id] === 2);
  const daihinmin= state.players.find(p => pr[p.id] === 3);

  // 大貧民の強い2枚 → 大富豪
  takeTopCards(daihinmin, daihugo, 2);
  // 平民の強い1枚 → 富豪
  takeTopCards(heimin, fugo, 1);

  render();

  // 大富豪が2枚を大貧民に渡す
  giveBack(daihugo, daihinmin, 2, () => {
    // 富豪が1枚を平民に渡す
    giveBack(fugo, heimin, 1, () => {
      render();
      callback();
    });
  });
}

function takeTopCards(from, to, count) {
  const picks = [...from.hand]
    .sort((a, b) => RANK_ORDER[b.rank] - RANK_ORDER[a.rank])
    .slice(0, count);
  picks.forEach(c => {
    from.hand.splice(from.hand.findIndex(x => x.id === c.id), 1);
    to.hand.push(c);
  });
  sortHand(to.hand);
  if (to.isHuman) highlightNewCards(picks);
}

function giveBack(giver, receiver, count, callback) {
  if (giver.isHuman) {
    showEffectModal(
      `🔄 カード交換`,
      `${RANK_NAMES[gameConfig.prevRanks[receiver.id]]}（${receiver.name}）に渡す ${count} 枚を選んでください`,
      [...giver.hand], count, callback, true
    );
  } else {
    // CPU: 最弱を渡す
    const gives = [...giver.hand]
      .sort((a, b) => RANK_ORDER[a.rank] - RANK_ORDER[b.rank])
      .slice(0, count);
    gives.forEach(c => {
      giver.hand.splice(giver.hand.findIndex(x => x.id === c.id), 1);
      receiver.hand.push(c);
    });
    sortHand(receiver.hand);
    if (receiver.isHuman) highlightNewCards(gives);
    callback([]);
  }
}

// ===================== バリデーション =====================
function getFieldStrength() {
  if (state.field.length === 0) return null;
  if (state.field.length === 1 && state.field[0].rank === 'JOKER') return 17;
  const base = state.field.find(c => c.rank !== 'JOKER');
  return base ? cardValue(base) : 17;
}

// カード1枚が「そもそも出せる可能性がある」かチェック（ハイライト用）
function isCardPotentiallyPlayable(card) {
  if (card.rank === 'JOKER') return true;
  if (state.numberLock && card.rank !== state.numberLock) return false;
  if (state.suitLock && card.suit !== state.suitLock) return false;
  if (state.field.length === 0) return true;
  return cardValue(card) > getFieldStrength();
}

function canPlay(selected) {
  if (selected.length === 0) return false;
  if (state.numberLock) {
    if (selected.filter(c => c.rank !== 'JOKER').some(c => c.rank !== state.numberLock)) return false;
  }
  if (state.suitLock) {
    if (selected.filter(c => c.rank !== 'JOKER').some(c => c.suit !== state.suitLock)) return false;
  }
  const fieldLen = state.field.length;
  if (fieldLen === 0) return isValidSet(selected);
  if (selected.length !== fieldLen) return false;
  if (!isValidSet(selected)) return false;
  return maxStrength(selected) > getFieldStrength();
}

function isValidSet(cards) {
  if (cards.length === 0) return false;
  if (cards.length === 1) return true;
  const nj = cards.filter(c => c.rank !== 'JOKER');
  if (nj.length === 0) return true;
  return nj.every(c => c.rank === nj[0].rank);
}

function maxStrength(cards) {
  return Math.max(...cards.map(c => cardValue(c)));
}

// ===================== プレイヤー操作 =====================
let selectedCards = [];

function toggleCard(cardId) {
  const card = state.players[0].hand.find(c => c.id === cardId);
  if (!isCardPotentiallyPlayable(card)) return; // 出せないカードは選択不可

  const idx = selectedCards.indexOf(cardId);
  if (idx === -1) selectedCards.push(cardId);
  else selectedCards.splice(idx, 1);
  renderPlayerHand();
  document.getElementById('btn-play').disabled = !canPlay(
    selectedCards.map(id => state.players[0].hand.find(c => c.id === id))
  );
}

function playCards() {
  const player = state.players[state.currentPlayer];
  const cards = selectedCards.map(id => player.hand.find(c => c.id === id));
  if (!canPlay(cards)) { setMessage('そのカードは出せません'); return; }
  doPlay(state.currentPlayer, cards);
}

function pass() {
  doPass(state.currentPlayer);
}

// ===================== コアロジック =====================
function doPlay(playerIdx, cards) {
  const player = state.players[playerIdx];
  enableActions(false);

  const prevField = [...state.field];
  // 場が空→このプレイヤーがトリック親
  if (prevField.length === 0) state.trickStarter = playerIdx;

  cards.forEach(c => {
    const i = player.hand.findIndex(h => h.id === c.id);
    if (i !== -1) player.hand.splice(i, 1);
  });

  state.discardPile.push(...state.field);
  state.field = cards;
  state.passCount = 0;

  // 革命チェック
  const nonJokers = cards.filter(c => c.rank !== 'JOKER');
  if (cards.length === 4 && nonJokers.length >= 1 && nonJokers.every(c => c.rank === nonJokers[0].rank)) {
    state.revolution = !state.revolution;
    showBadgeFlash('革命' + (state.revolution ? '発動！' : '解除！'));
  }

  updateLocks(prevField, cards);
  selectedCards = [];
  render();

  const effectRank = nonJokers.length > 0 ? nonJokers[0].rank : null;
  handleSpecialEffect(playerIdx, cards, effectRank, nonJokers, (samePlayer) => {
    afterEffect(playerIdx, samePlayer);
  });
}

function doPass(playerIdx) {
  state.passCount++;
  setMessage(`${state.players[playerIdx].name}がパスした`);
  const activePlayers = state.players.filter(p => !p.finished).length;
  if (state.passCount >= activePlayers - 1) {
    resetField();
    setMessage('場をリセット！');
  }
  render();
  nextTurn();
}

function afterEffect(playerIdx, samePlayer) {
  if (checkFinish(playerIdx)) return;
  render();
  const player = state.players[playerIdx];
  if (samePlayer && !player.finished) {
    if (player.isHuman) { enableActions(true); setMessage('もう一度あなたのターンです（８切り）'); }
    else setTimeout(() => cpuTurn(), 900);
  } else {
    nextTurn();
  }
}

function checkFinish(playerIdx) {
  const player = state.players[playerIdx];
  if (player.hand.length > 0 || player.finished) return false;

  player.finished = true;
  player.rank = state.finishRanks.length;
  state.finishRanks.push(playerIdx);
  setMessage(`${player.name}が上がった！ → ${RANK_NAMES[player.rank]}`);

  if (state.finishRanks.length >= 3) {
    const last = state.players.find(p => !p.finished);
    if (last) { last.finished = true; last.rank = 3; state.finishRanks.push(last.id); }
    endRound();
    return true;
  }
  return false;
}

function nextTurn() {
  let next = getNextActivePlayer(state.currentPlayer);
  if (state.skipNext) {
    state.skipNext = false;
    const skipped = state.players[next];
    if (!skipped.finished) {
      setMessage(`${skipped.name}をスキップ！`);
      next = getNextActivePlayer(next);
    }
  }
  state.currentPlayer = next;
  render();
  const player = state.players[next];
  if (!state.gameOver) {
    if (player.isHuman) { enableActions(true); if (!state.gameOver) setMessage('あなたのターンです'); }
    else { enableActions(false); setTimeout(() => cpuTurn(), 900); }
  }
}

// ===================== 特殊効果 =====================
function handleSpecialEffect(playerIdx, cards, rank, nonJokers, done) {
  const player = state.players[playerIdx];
  const count = cards.length;
  const info = EFFECT_INFO[rank];
  if (!info) { done(false); return; }
  showEffectNotice(info.name, info.color);

  switch (rank) {
    case '4': {
      if (state.discardPile.length === 0) { done(false); return; }
      if (player.isHuman) {
        showEffectModal(`💀 死者蘇生`, `捨て札から最大 ${count} 枚を手札に戻せます（0枚でもOK）`,
          [...state.discardPile], count,
          (selected) => {
            selected.forEach(c => {
              state.discardPile.splice(state.discardPile.findIndex(x => x.id === c.id), 1);
              player.hand.push(c);
            });
            sortHand(player.hand);
            highlightNewCards(selected);
            if (selected.length > 0) setMessage(`${selected.length}枚を手札に戻した！`);
            render(); done(false);
          }
        );
      } else {
        const picks = [...state.discardPile].sort((a,b) => RANK_ORDER[b.rank]-RANK_ORDER[a.rank]).slice(0, count);
        picks.forEach(c => { state.discardPile.splice(state.discardPile.findIndex(x=>x.id===c.id),1); player.hand.push(c); });
        sortHand(player.hand);
        setMessage(`${player.name}が捨て札から ${picks.length} 枚回収！`);
        render(); done(false);
      }
      break;
    }
    case '5': {
      state.skipNext = true;
      setMessage(`${player.name}がスキップ！次の人を飛ばす`);
      done(false); break;
    }
    case '6': {
      const suit = nonJokers.length > 0 ? nonJokers[0].suit : null;
      if (suit) { state.suitLock = suit; setMessage(`${player.name}が強制縛り！${suit}のみ出せる`); render(); }
      done(false); break;
    }
    case '7': {
      if (player.hand.length === 0) { done(false); return; }
      const targetIdx = getNextActivePlayer(playerIdx);
      const target = state.players[targetIdx];
      const maxGive = Math.min(count, player.hand.length);
      if (player.isHuman) {
        showEffectModal(`🎁 ７渡し`, `最大 ${maxGive} 枚を ${target.name} に渡せます（0枚でもOK）`,
          [...player.hand], maxGive,
          (selected) => {
            selected.forEach(c => { player.hand.splice(player.hand.findIndex(x=>x.id===c.id),1); target.hand.push(c); });
            sortHand(target.hand);
            if (selected.length > 0) setMessage(`${target.name}に ${selected.length} 枚渡した！`);
            render(); done(false);
          }
        );
      } else {
        const gives = [...player.hand].sort((a,b)=>RANK_ORDER[a.rank]-RANK_ORDER[b.rank]).slice(0, maxGive);
        gives.forEach(c => { player.hand.splice(player.hand.findIndex(x=>x.id===c.id),1); target.hand.push(c); });
        sortHand(target.hand);
        if (target.isHuman) highlightNewCards(gives);
        setMessage(`${player.name}が ${gives.length} 枚を ${target.name} に渡した！`);
        render(); done(false);
      }
      break;
    }
    case '9': { // ９回し（宣言者がK枚を決め、全員が一斉にK枚時計回りに渡す）
      const maxN = count; // 出した9の枚数が上限
      const active9 = state.players.filter(p => !p.finished);
      if (active9.length <= 1) { done(false); return; }

      // K枚が決まったら全員一斉に実行（humanCardsは宣言者が選んだ分）
      const executeAll = (k, declarerCards) => {
        if (k === 0) { setMessage('０枚宣言。全員パス'); render(); done(false); return; }
        const moveList = active9.map(p => {
          const receiverIdx = getNextActivePlayer(p.id);
          // 宣言者の手札はすでに選択済み、他は自動で最弱k枚
          let cardsToGive;
          if (p.id === playerIdx) {
            cardsToGive = declarerCards;
          } else if (p.isHuman) {
            // 宣言者でないヒューマンはあとでモーダルで選ぶ（下で処理）
            cardsToGive = null; // placeholder
          } else {
            cardsToGive = [...p.hand]
              .sort((a, b) => RANK_ORDER[a.rank] - RANK_ORDER[b.rank])
              .slice(0, Math.min(k, p.hand.length));
          }
          return { cardsToGive, receiverIdx, giverId: p.id };
        });

        const commit = (humanExtra) => {
          moveList.forEach(item => {
            if (item.cardsToGive === null) item.cardsToGive = humanExtra;
          });
          const humanReceived = [];
          moveList.forEach(({ cardsToGive, receiverIdx, giverId }) => {
            const giver = state.players[giverId];
            const receiver = state.players[receiverIdx];
            cardsToGive.forEach(c => {
              giver.hand.splice(giver.hand.findIndex(x => x.id === c.id), 1);
              receiver.hand.push(c);
            });
            if (receiver.isHuman) humanReceived.push(...cardsToGive);
          });
          state.players.forEach(p => sortHand(p.hand));
          highlightNewCards(humanReceived);
          setMessage(`全員が時計回りに ${k} 枚渡した！`);
          render(); done(false);
        };

        // 宣言者以外のヒューマンがいればモーダルを出す
        const otherHuman = state.players.find(p => p.isHuman && !p.finished && p.id !== playerIdx);
        if (otherHuman && otherHuman.hand.length > 0) {
          const actualK = Math.min(k, otherHuman.hand.length);
          showEffectModal(
            `🔄 ９回し`,
            `${player.name}が ${k} 枚を宣言！あなたも ${actualK} 枚選んでください`,
            [...otherHuman.hand], actualK,
            (selected) => commit(selected),
            true // ちょうどk枚
          );
        } else {
          commit([]);
        }
      };

      if (player.isHuman) {
        // ヒューマンが宣言：選んだ枚数がK
        const maxK = Math.min(maxN, player.hand.length);
        showEffectModal(
          `🔄 ９回し`,
          `渡す枚数を選んで宣言（最大 ${maxK} 枚）。全員がその枚数を時計回りに渡します`,
          [...player.hand], maxK,
          (selected) => executeAll(selected.length, selected)
        );
      } else {
        // CPUが宣言：最弱カードをmaxN枚選んでKを決定
        const cpuGives = [...player.hand]
          .sort((a, b) => RANK_ORDER[a.rank] - RANK_ORDER[b.rank])
          .slice(0, Math.min(maxN, player.hand.length));
        executeAll(cpuGives.length, cpuGives);
      }
      break;
    }

    case '8': {
      resetField();
      setMessage(`${player.name}が８切り！場を流して続ける`);
      render(); done(true); break;
    }
    case '10': {
      if (player.hand.length === 0) { done(false); return; }
      const maxDiscard = Math.min(count, player.hand.length);
      if (player.isHuman) {
        showEffectModal(`🗑️ 10捨て`, `手札から最大 ${maxDiscard} 枚を捨てられます（0枚でもOK）`,
          [...player.hand], maxDiscard,
          (selected) => {
            selected.forEach(c => { player.hand.splice(player.hand.findIndex(x=>x.id===c.id),1); state.discardPile.push(c); });
            if (selected.length > 0) setMessage(`${selected.length} 枚を捨てた！`);
            render(); done(false);
          }
        );
      } else {
        const discards = [...player.hand].sort((a,b)=>RANK_ORDER[a.rank]-RANK_ORDER[b.rank]).slice(0, maxDiscard);
        discards.forEach(c => { player.hand.splice(player.hand.findIndex(x=>x.id===c.id),1); state.discardPile.push(c); });
        setMessage(`${player.name}が ${discards.length} 枚を捨てた！`);
        render(); done(false);
      }
      break;
    }
    case 'J': {
      state.elevenBack = !state.elevenBack;
      setMessage(`${player.name}がイレブンバック！この場の強弱が逆転！`);
      render(); done(false); break;
    }
    default: done(false);
  }
}

// ===================== CPU AI =====================
function cpuTurn() {
  if (state.gameOver) return;
  const player = state.players[state.currentPlayer];
  if (player.isHuman || player.finished) return;

  const fieldLen = state.field.length;
  const played = fieldLen === 0 ? findPlayableFromEmpty(player.hand) : findPlayable(player.hand, fieldLen);

  if (played) {
    const nj = played.filter(c => c.rank !== 'JOKER');
    const rankName = nj.length > 0 ? EFFECT_INFO[nj[0].rank]?.name : null;
    setMessage(`${player.name}がカードを出した${rankName ? '（' + rankName + '）' : ''}`);
    doPlay(state.currentPlayer, played);
  } else {
    doPass(state.currentPlayer);
  }
}

function findPlayableFromEmpty(hand) {
  let candidates = hand;
  if (state.suitLock)   candidates = candidates.filter(c => c.rank === 'JOKER' || c.suit === state.suitLock);
  if (state.numberLock) candidates = candidates.filter(c => c.rank === 'JOKER' || c.rank === state.numberLock);
  if (candidates.length === 0) return hand.length > 0 ? [hand[0]] : null;

  const jokers   = candidates.filter(c => c.rank === 'JOKER');
  const nonJokers = candidates.filter(c => c.rank !== 'JOKER');

  // ランク別にグループ化（弱い順）
  const groups = {};
  nonJokers.forEach(c => {
    if (!groups[c.rank]) groups[c.rank] = [];
    groups[c.rank].push(c);
  });

  const sorted = Object.entries(groups)
    .sort((a, b) => RANK_ORDER[a[0]] - RANK_ORDER[b[0]]);

  // 最も弱いランクの複数枚グループを探す
  for (const [, cards] of sorted) {
    const group = [...cards, ...jokers].slice(0, 4);
    if (group.length >= 2) return group; // ペア以上があれば出す
  }

  // 複数枚グループなし → 最弱の1枚
  return [candidates[0]];
}

function findPlayable(hand, count) {
  const fldStrength = getFieldStrength();
  let available = hand;
  if (state.suitLock) available = available.filter(c => c.rank === 'JOKER' || c.suit === state.suitLock);
  if (state.numberLock) available = available.filter(c => c.rank === 'JOKER' || c.rank === state.numberLock);

  if (count === 1) {
    const candidates = available.filter(c => cardValue(c) > fldStrength);
    if (candidates.length === 0) return null;
    return [candidates.sort((a,b) => cardValue(a)-cardValue(b))[0]];
  }

  const groups = {};
  available.filter(c => c.rank !== 'JOKER').forEach(c => {
    const v = cardValue(c);
    if (!groups[v]) groups[v] = [];
    groups[v].push(c);
  });
  const jokers = available.filter(c => c.rank === 'JOKER');
  for (const [v, cards] of Object.entries(groups).sort((a,b) => Number(a[0])-Number(b[0]))) {
    if (Number(v) <= fldStrength) continue;
    if (cards.length >= count) return cards.slice(0, count);
    if (cards.length + jokers.length >= count) return [...cards, ...jokers].slice(0, count);
  }
  return null;
}

// ===================== ラウンド終了 =====================
function endRound() {
  state.gameOver = true;
  enableActions(false);

  // 今ラウンドの結果を累計に加算
  const newRanks = {};
  state.players.forEach(p => {
    gameConfig.points[p.id] += p.rank;
    newRanks[p.id] = p.rank;
  });
  gameConfig.prevRanks = newRanks;

  // 今ラウンドの結果表示
  const roundResult = [...state.players]
    .sort((a, b) => a.rank - b.rank)
    .map(p => `${RANK_NAMES[p.rank]}：${p.name}`)
    .join('<br>');

  if (gameConfig.currentRound >= gameConfig.totalRounds) {
    // 全ラウンド終了
    showFinalResult();
  } else {
    // まだ続く
    const remaining = gameConfig.totalRounds - gameConfig.currentRound;
    document.getElementById('overlay-title').textContent =
      `ラウンド ${gameConfig.currentRound} 終了`;
    document.getElementById('overlay-result').innerHTML =
      roundResult + `<br><br><span style="color:#aaa;font-size:13px">残り ${remaining} 周</span>`;
    document.getElementById('round-selector').classList.add('hidden');
    const btn = document.getElementById('overlay-action-btn');
    btn.textContent = '次のラウンドへ';
    btn.classList.remove('hidden');
    document.getElementById('overlay').classList.remove('hidden');
  }
}

function showFinalResult() {
  const standings = [...state.players]
    .sort((a, b) => gameConfig.points[a.id] - gameConfig.points[b.id]);
  const medals = ['🥇', '🥈', '🥉', ''];
  const lines = standings.map((p, i) =>
    `${medals[i]} ${p.name}（合計 ${gameConfig.points[p.id]} 点）`
  ).join('<br>');

  document.getElementById('overlay-title').textContent = `${gameConfig.totalRounds}周 終了！`;
  document.getElementById('overlay-result').innerHTML =
    `<b style="color:#ffd700">最終結果</b><br>${lines}`;
  document.getElementById('round-selector').classList.add('hidden');
  const btn = document.getElementById('overlay-action-btn');
  btn.textContent = 'もう一度';
  btn.onclick = () => {
    gameConfig = { totalRounds: 1, currentRound: 0, points: [0,0,0,0], prevRanks: null };
    document.getElementById('overlay-title').textContent = '大富豪';
    document.getElementById('overlay-result').textContent = '';
    document.getElementById('round-selector').classList.remove('hidden');
    btn.classList.add('hidden');
    btn.onclick = overlayAction;
  };
  btn.classList.remove('hidden');
  document.getElementById('overlay').classList.remove('hidden');
}

// ===================== エフェクトモーダル =====================
function showEffectModal(title, desc, cards, maxCount, callback, exact = false) {
  effectCallback = callback;
  effectSelectedIds = [];
  effectMaxCount = maxCount;
  effectExact = exact;
  effectModalCards = cards;

  document.getElementById('effect-modal-title').textContent = title;
  document.getElementById('effect-modal-desc').textContent = desc;

  const cardsEl = document.getElementById('effect-modal-cards');
  cardsEl.innerHTML = '';
  cards.forEach(card => {
    const el = makeCardEl(card, false);
    el.onclick = () => {
      const idx = effectSelectedIds.indexOf(card.id);
      if (idx !== -1) { effectSelectedIds.splice(idx, 1); el.classList.remove('selected'); }
      else if (effectSelectedIds.length < effectMaxCount) { effectSelectedIds.push(card.id); el.classList.add('selected'); }
      updateEffectCount();
    };
    cardsEl.appendChild(el);
  });

  updateEffectCount();
  document.getElementById('effect-modal').classList.remove('hidden');
}

function updateEffectCount() {
  const count = effectSelectedIds.length;
  document.getElementById('effect-modal-count').textContent = `${count} / ${effectMaxCount} 枚選択中`;
  const btn = document.getElementById('effect-modal-confirm');
  btn.disabled = effectExact && count !== effectMaxCount;
}

function confirmEffect() {
  document.getElementById('effect-modal').classList.add('hidden');
  const selected = effectModalCards.filter(c => effectSelectedIds.includes(c.id));
  const cb = effectCallback;
  effectCallback = null;
  effectSelectedIds = [];
  if (cb) cb(selected);
}

// ===================== エフェクト通知 =====================
function showEffectNotice(name, color) {
  const el = document.getElementById('effect-notice');
  el.textContent = name;
  el.style.background = color;
  el.classList.remove('hidden');
  el.style.animation = 'none';
  el.offsetHeight;
  el.style.animation = '';
  clearTimeout(el._timer);
  el._timer = setTimeout(() => el.classList.add('hidden'), 1800);
}

function showBadgeFlash(text) {
  document.getElementById('revolution-badge').textContent = text;
  document.getElementById('revolution-badge').classList.remove('hidden');
}

// ===================== UI =====================
function enableActions(enabled) {
  document.getElementById('btn-pass').disabled = !enabled;
  document.getElementById('btn-play').disabled = true;
  if (!enabled) { selectedCards = []; renderPlayerHand(); }
}

function setMessage(msg) {
  document.getElementById('game-message').textContent = msg;
}

function updateRoundIndicator() {
  document.getElementById('round-indicator').textContent =
    `ラウンド ${gameConfig.currentRound} / ${gameConfig.totalRounds}`;
}

function render() {
  renderField();
  renderCPUs();
  renderPlayerHand();
  renderPlayerArea();
  renderStatusBadges();
}

function renderField() {
  const el = document.getElementById('field-cards');
  el.innerHTML = '';
  state.field.forEach(c => el.appendChild(makeCardEl(c, true)));

  const lockParts = [];
  if (state.numberLock) lockParts.push(`数字縛り: ${state.numberLock}`);
  if (state.suitLock)   lockParts.push(`スート縛り: ${state.suitLock}`);
  const lockEl = document.getElementById('lock-display');
  if (lockEl) {
    lockEl.textContent = lockParts.join('　');
    lockEl.classList.toggle('hidden', lockParts.length === 0);
  }

  document.getElementById('field-info').textContent = state.field.length === 0
    ? '（場は空です）'
    : `${state.field.length}枚  /  捨て札: ${state.discardPile.length}枚`;
}

function renderCPUs() {
  [1, 2, 3].forEach(i => {
    const p = state.players[i];
    const handEl = document.getElementById(`cpu${i}-hand`);
    const countEl = document.getElementById(`cpu${i}-count`);
    const playerEl = document.getElementById(`cpu${i}`);
    handEl.innerHTML = '';
    const shown = Math.min(p.hand.length, 12);
    for (let j = 0; j < shown; j++) {
      const back = document.createElement('div');
      back.className = 'cpu-card-back';
      handEl.appendChild(back);
    }
    countEl.textContent = `${p.hand.length}枚`;
    playerEl.classList.toggle('active-turn', state.currentPlayer === i && !state.gameOver);
    playerEl.classList.toggle('finished', p.finished);

    // 親マーク
    const isRoundStarter = state.roundStarter === i;
    const isTrickStarter = state.trickStarter === i;
    const labelEl = playerEl.querySelector('.cpu-label');
    const prevTitle = gameConfig.prevRanks
      ? `(${RANK_NAMES[gameConfig.prevRanks[i]] ?? ''})` : '';
    const parentMark = isRoundStarter ? ' 👑' : (isTrickStarter ? ' ◆' : '');
    labelEl.textContent = `CPU${i}${prevTitle}${parentMark}`;
  });
}

function renderPlayerArea() {
  const el = document.getElementById('player-area');
  el.classList.toggle('active-turn', state.currentPlayer === 0 && !state.gameOver);

  const isRoundStarter = state.roundStarter === 0;
  const isTrickStarter = state.trickStarter === 0;
  const parentMark = isRoundStarter ? ' 👑' : (isTrickStarter ? ' ◆' : '');
  document.getElementById('player-label').textContent = `あなた${parentMark}`;
}

function renderPlayerHand() {
  const el = document.getElementById('player-hand');
  el.innerHTML = '';
  const player = state.players[0];
  const isMyTurn = state.currentPlayer === 0 && !state.gameOver && !player.finished;

  player.hand.forEach(card => {
    const cardEl = makeCardEl(card, false);
    if (selectedCards.includes(card.id)) cardEl.classList.add('selected');

    if (newCardIds.has(card.id)) cardEl.classList.add('card-new');
    const playable = isCardPotentiallyPlayable(card);
    if (!playable) cardEl.classList.add('locked-out');

    if (isMyTurn) {
      cardEl.onclick = () => toggleCard(card.id);
      if (!playable) cardEl.style.cursor = 'not-allowed';
    }

    if (EFFECT_INFO[card.rank]) {
      const badge = document.createElement('div');
      badge.className = 'effect-badge';
      badge.textContent = EFFECT_INFO[card.rank].name;
      badge.style.background = EFFECT_INFO[card.rank].color;
      cardEl.appendChild(badge);
    }
    el.appendChild(cardEl);
  });
}

function renderStatusBadges() {
  const revEl = document.getElementById('revolution-badge');
  if (state.revolution && !state.elevenBack) {
    revEl.textContent = '革命中！'; revEl.classList.remove('hidden');
  } else if (!state.revolution && state.elevenBack) {
    revEl.textContent = '11バック中'; revEl.classList.remove('hidden');
  } else if (state.revolution && state.elevenBack) {
    revEl.textContent = '革命＋11バック'; revEl.classList.remove('hidden');
  } else {
    revEl.classList.add('hidden');
  }
}

function makeCardEl(card, small) {
  const el = document.createElement('div');
  el.className = 'card' + (small ? ' field-card' : '');
  const isRed = card.suit === '♥' || card.suit === '♦';
  el.classList.add(isRed ? 'red' : 'black');

  const suit = document.createElement('div');
  suit.className = 'card-suit';
  suit.textContent = card.suit;

  const rank = document.createElement('div');
  rank.className = 'card-rank';
  rank.textContent = card.rank;

  el.appendChild(suit);
  el.appendChild(rank);
  return el;
}

// ===================== 初期表示 =====================
window.onload = () => {
  document.getElementById('overlay').classList.remove('hidden');
};
