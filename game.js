// ===================== 定数 =====================
const SUITS = ['♠', '♥', '♦', '♣'];
const RANKS = ['3','4','5','6','7','8','9','10','J','Q','K','A','2'];
const RANK_ORDER = { '3':3,'4':4,'5':5,'6':6,'7':7,'8':8,'9':9,'10':10,'J':11,'Q':12,'K':13,'A':14,'2':15,'JOKER':16 };
const RANK_BY_VAL = Object.fromEntries(Object.entries(RANK_ORDER).map(([k,v]) => [v,k]));
const RANK_NAMES = ['大富豪', '富豪', '貧民', '大貧民'];

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

// スート別の3効果
const SUIT3_EFFECTS = {
  '♠': { name: 'スペ３',   color: '#8e44ad' },
  '♥': { name: 'ギフト',   color: '#e91e63' },
  '♣': { name: 'リセット',  color: '#795548' },
  '♦': { name: '８切返し', color: '#ff5722' },
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
  skipNext: 0,
  numberLock: null,
  suitLock: [],          // 縛りスートの配列（空=縛りなし、複数可）
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

// 階段内のジョーカーが代替するランクを返す（内部ギャップ → そのランク、端 → 小さい側）
function getJokerSubstRank(cards) {
  const nonJokers = cards.filter(c => c.rank !== 'JOKER');
  if (nonJokers.length === cards.length) return null;
  const vals = nonJokers.map(c => RANK_ORDER[c.rank]).sort((a, b) => a - b);
  for (let i = 1; i < vals.length; i++) {
    if (vals[i] - vals[i - 1] > 1) return RANK_BY_VAL[vals[i - 1] + 1] || null; // 内部ギャップ
  }
  // ギャップなし → 端に配置（小さい側を優先。範囲外なら大きい側）
  const lower = vals[0] - 1;
  const upper = vals[vals.length - 1] + 1;
  return RANK_BY_VAL[lower] || RANK_BY_VAL[upper] || null;
}

// ===================== 階段ヘルパー =====================
// 階段判定（3枚以上、同スート、連続ランク）
// ジョーカーは最大1枚まで「穴埋め」として使用可
function isSequence(cards) {
  if (cards.length < 3) return false;
  const jokers = cards.filter(c => c.rank === 'JOKER');
  if (jokers.length > 1) return false;
  const nonJokers = cards.filter(c => c.rank !== 'JOKER');
  if (nonJokers.length === 0) return false;
  const suit = nonJokers[0].suit;
  if (!nonJokers.every(c => c.suit === suit)) return false;
  const vals = nonJokers.map(c => RANK_ORDER[c.rank]).sort((a, b) => a - b);
  // 重複チェック
  for (let i = 1; i < vals.length; i++) if (vals[i] === vals[i - 1]) return false;
  const span = vals[vals.length - 1] - vals[0];
  if (jokers.length === 0) return span === cards.length - 1; // ジョーカーなし：完全連続
  // ジョーカーあり：穴1つ分以内のスパンであればOK
  return span <= cards.length - 1;
}

// このカードを含む、seqLen枚の同スート連続セットが手札にあり、かつ強さがminStrengthを超えるか
function canBeInSequence(card, hand, seqLen, minStrength) {
  if (card.rank === 'JOKER') return false;
  const suit = card.suit;
  const cardVal = RANK_ORDER[card.rank];
  const suitVals = new Set(
    hand.filter(c => c.suit === suit && c.rank !== 'JOKER').map(c => RANK_ORDER[c.rank])
  );
  for (let start = Math.max(3, cardVal - seqLen + 1); start <= cardVal && start + seqLen - 1 <= 15; start++) {
    const end = start + seqLen - 1;
    let ok = true;
    for (let v = start; v <= end; v++) {
      if (!suitVals.has(v)) { ok = false; break; }
    }
    if (ok) {
      let seqMax = -Infinity;
      for (let v = start; v <= end; v++) {
        const rank = RANK_BY_VAL[v];
        if (rank) seqMax = Math.max(seqMax, cardValue({ rank, suit }));
      }
      if (seqMax > minStrength) return true;
    }
  }
  return false;
}

// 手札から全ての階段候補（minLen枚以上）を列挙
function findAllSequences(hand, minLen = 3) {
  const result = [];
  for (const suit of SUITS) {
    const sc = hand.filter(c => c.suit === suit && c.rank !== 'JOKER')
      .sort((a, b) => RANK_ORDER[a.rank] - RANK_ORDER[b.rank]);
    let i = 0;
    while (i < sc.length) {
      let j = i;
      while (j + 1 < sc.length && RANK_ORDER[sc[j + 1].rank] === RANK_ORDER[sc[j].rank] + 1) j++;
      const runLen = j - i + 1;
      if (runLen >= minLen) {
        for (let s = i; s <= j; s++)
          for (let e = s + minLen - 1; e <= j; e++)
            result.push(sc.slice(s, e + 1));
      }
      i = j + 1;
    }
  }
  return result;
}

function resetField() {
  state.discardPile.push(...state.field);
  state.field = [];
  state.passCount = 0;
  state.elevenBack = false;
  state.numberLock = null;
  state.suitLock = [];
  state.trickStarter = null;
}

function updateLocks(prevField, newCards) {
  // 階段が絡む場合は縛りを適用しない
  if (isSequence(prevField) || isSequence(newCards)) {
    state.numberLock = null;
    return;
  }

  // ---- 数字縛り（連続ランク・革命/11バック対応） ----
  // cardValue() で強さを比較することで、革命/11バック中は逆順で連続判定する
  const prevRank = getMainRank(prevField);
  const newRank  = getMainRank(newCards);
  if (prevRank && newRank) {
    const prevVal = cardValue({ rank: prevRank });
    const newVal  = cardValue({ rank: newRank });
    if (newVal === prevVal + 1) {
      const nextStrength = newVal + 1;
      const reversed = state.revolution !== state.elevenBack;
      // 強さ→ランク変換: reversed時は base=17-strength, 通常は base=strength
      const nextBase = reversed ? (17 - nextStrength) : nextStrength;
      state.numberLock = RANK_BY_VAL[nextBase] || null;
    } else {
      state.numberLock = null;
    }
  } else {
    state.numberLock = null;
  }

  // ---- スート縛り（両場に共通するスートをすべて縛る） ----
  // 縛りの有無にかかわらず、前の場と今の出し手の共通スートで毎回更新する
  // → 片方縛り中に両方同スートで出したとき、両方縛りに拡張される
  const prevSuits = new Set(prevField.filter(c => c.rank !== 'JOKER').map(c => c.suit));
  const newSuits  = new Set(newCards.filter(c => c.rank !== 'JOKER').map(c => c.suit));
  const common = [...prevSuits].filter(s => newSuits.has(s));
  if (common.length >= 1) {
    state.suitLock = common;   // 配列で保持（拡張・縮小ともに反映）
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
      id: i, name, hand: [], isHuman: i === 0, finished: false, stuck: false, rank: null,
    })),
    field: [],
    discardPile: [],
    currentPlayer: 0,
    passCount: 0,
    revolution: false,
    elevenBack: false,
    skipNext: 0,
    numberLock: null,
    suitLock: [],
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
  // 貧民の強い1枚 → 富豪
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
  const nj = state.field.filter(c => c.rank !== 'JOKER');
  if (nj.length === 0) return 17;
  // 階段は最強カードの値、グループは全員同じ値なので max で統一
  return Math.max(...nj.map(c => cardValue(c)));
}

// カード1枚が「そもそも出せる可能性がある」かチェック（ハイライト用）
function isCardPotentiallyPlayable(card) {
  const hand = state.players[0].hand;
  const fieldLen = state.field.length;

  // ♣3 (リセット) はあらゆる制限を無視して常に1枚で出せる
  if (card.suit === '♣' && card.rank === '3') return true;

  // 数字縛りチェック（ジョーカーは免除）
  if (card.rank !== 'JOKER' && state.numberLock && card.rank !== state.numberLock) return false;

  if (fieldLen === 0) return true;

  const fldStrength = getFieldStrength();

  // 特例：場が単体ジョーカーのとき ♠3 だけ光らせる（スート縛りがある場合は縛りも確認）
  if (fieldLen === 1 && state.field[0].rank === 'JOKER') {
    if (!(card.suit === '♠' && card.rank === '3')) return false;
    if (state.suitLock.length > 0 && !state.suitLock.includes('♠')) return false;
    return true;
  }

  // ジョーカー自身
  if (card.rank === 'JOKER') {
    if (cardValue(card) <= fldStrength) return false;
    if (fieldLen === 1) return true;
    const strongPartners = hand.filter(c => c.rank !== 'JOKER' && cardValue(c) > fldStrength);
    // 場が階段：同スートが (fieldLen-1) 枚以上あればジョーカーを組み込める可能性あり
    if (isSequence(state.field)) {
      return SUITS.some(s => strongPartners.filter(c => c.suit === s).length >= fieldLen - 1);
    }
    // 場がグループ：同ランクが (fieldLen-1) 枚以上あるか
    const grps = {};
    strongPartners.forEach(c => { grps[c.rank] = (grps[c.rank] || 0) + 1; });
    return Object.values(grps).some(cnt => cnt >= fieldLen - 1);
  }

  // ---- 場が階段の場合 ----
  if (isSequence(state.field)) {
    return canBeInSequence(card, hand, fieldLen, fldStrength);
  }

  // ---- 場がグループの場合 ----
  const joker = hand.find(c => c.rank === 'JOKER');
  const cardStrong = cardValue(card) > fldStrength;
  // グループ出しではジョーカーは「同ランク扱い」なので、このカード自身の強さで判定する
  // （ジョーカーが場の強さを超えていても、このカードが弱ければ出せない）
  if (!cardStrong) return false;

  // 1枚出し：このカード自身がすべての縛りスートを満たす必要がある
  if (fieldLen === 1) {
    if (state.suitLock.length > 0 && !state.suitLock.includes(card.suit)) return false;
    return true;
  }

  // 複数枚出し：このカードを含む組が縛りスートをすべてカバーできるかチェック
  // ジョーカーはオールマイティとして未カバーの縛りスートを1つ補填できる
  if (state.suitLock.length > 0) {
    const jokerAvail = hand.some(c => c.rank === 'JOKER');
    const uncoveredLocks = state.suitLock.filter(s => s !== card.suit);
    if (uncoveredLocks.length > fieldLen - 1) return false;
    let jokerUsed = false;
    for (const lockSuit of uncoveredLocks) {
      const covered = hand.some(c => c.id !== card.id && c.rank === card.rank && c.suit === lockSuit);
      if (!covered) {
        if (jokerAvail && !jokerUsed) jokerUsed = true;
        else return false;
      }
    }
  }

  // 同ランクのパートナー枚数（縛りスート外も含めてカウント）
  const sameRankOthers = hand.filter(c => c.rank === card.rank && c.id !== card.id).length;
  const jokerAvail = joker ? 1 : 0;
  return sameRankOthers + jokerAvail >= fieldLen - 1;
}

function canPlay(selected) {
  if (selected.length === 0) return false;
  // ♣3 (リセット) はどんな場でも1枚で出せる（縛り・強さを無視）
  if (selected.length === 1 && selected[0].suit === '♣' && selected[0].rank === '3') return true;
  if (state.numberLock) {
    if (selected.filter(c => c.rank !== 'JOKER').some(c => c.rank !== state.numberLock)) return false;
  }
  if (state.suitLock.length > 0) {
    // ジョーカーはオールマイティ：未カバーの縛りスートを1つ補填できる
    const nonJokers = selected.filter(c => c.rank !== 'JOKER');
    const hasJoker  = selected.some(c => c.rank === 'JOKER');
    const uncovered = state.suitLock.filter(s => !nonJokers.some(c => c.suit === s));
    if (uncovered.length > (hasJoker ? 1 : 0)) return false;
  }
  const fieldLen = state.field.length;
  if (fieldLen === 0) return isValidSet(selected);

  // 特例：♠3 は単体ジョーカーに勝てる
  if (fieldLen === 1 && state.field[0].rank === 'JOKER') {
    return selected.length === 1 && selected[0].suit === '♠' && selected[0].rank === '3';
  }

  if (selected.length !== fieldLen) return false;
  if (!isValidSet(selected)) return false;

  // 階段 vs 階段、グループ vs グループ の一致チェック
  const fieldIsSeq = isSequence(state.field);
  const selIsSeq   = isSequence(selected);
  if (fieldIsSeq !== selIsSeq) return false;

  return maxStrength(selected) > getFieldStrength();
}

function isValidSet(cards) {
  if (cards.length === 0) return false;
  if (cards.length === 1) return true;
  // 階段判定（3枚以上の同スート連続）
  if (isSequence(cards)) return true;
  // グループ判定（同ランク）
  const nj = cards.filter(c => c.rank !== 'JOKER');
  if (nj.length === 0) return true;
  return nj.every(c => c.rank === nj[0].rank);
}

function maxStrength(cards) {
  // ジョーカー単体ならそのまま
  // グループ出しにジョーカーが含まれる場合、ジョーカーは「同ランク扱い」なので
  // 非ジョーカーの強さで決まる（getFieldStrength と同じ方針）
  const nj = cards.filter(c => c.rank !== 'JOKER');
  if (nj.length === 0) return cardValue(cards[0]); // ジョーカーのみ
  return Math.max(...nj.map(c => cardValue(c)));
}

// 「最後に出し禁止」カードか判定（２、革命中は３、ジョーカーは常時）
function isFinishForbiddenCard(card) {
  if (card.rank === 'JOKER') return true;
  const reversed = state.revolution !== state.elevenBack;
  return reversed ? card.rank === '3' : card.rank === '2';
}

// この出し手が「上がり禁止」の組み合わせか（手札が空になり、かつ禁止カードを含む）
function isForbiddenFinish(playerIdx, cards) {
  const hand = state.players[playerIdx].hand;
  if (hand.length !== cards.length) return false;        // 上がりにならない
  return cards.some(c => isFinishForbiddenCard(c));
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
  const selected = selectedCards.map(id => state.players[0].hand.find(c => c.id === id));
  document.getElementById('btn-play').disabled =
    !canPlay(selected) || isForbiddenFinish(0, selected);
}

function playCards() {
  const player = state.players[state.currentPlayer];
  const cards = selectedCards.map(id => player.hand.find(c => c.id === id));
  if (!canPlay(cards)) { setMessage('そのカードは出せません'); return; }
  if (isForbiddenFinish(state.currentPlayer, cards)) {
    const reversed = state.revolution !== state.elevenBack;
    setMessage(`${reversed ? '３' : '２'}・ジョーカーでは上がれません！`);
    return;
  }
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

  // 革命チェック（4枚同ランク or 4枚以上の階段）
  const nonJokers = cards.filter(c => c.rank !== 'JOKER');
  const isGroupRev = cards.length === 4 && nonJokers.length >= 1 && nonJokers.every(c => c.rank === nonJokers[0].rank);
  const isSeqRev   = isSequence(cards) && cards.length >= 4;
  if (isGroupRev || isSeqRev) {
    state.revolution = !state.revolution;
    showBadgeFlash('革命' + (state.revolution ? '発動！' : '解除！'));
  }

  // 特例：♠3 が単体ジョーカーを倒した → 場を流して続行
  if (prevField.length === 1 && prevField[0].rank === 'JOKER' &&
      cards.length === 1 && cards[0].suit === '♠' && cards[0].rank === '3') {
    showEffectNotice('スペ3! ジョーカー撃破！', '#8e44ad');
    resetField();
    render();
    if (checkFinish(playerIdx)) return;
    render();
    const p = state.players[playerIdx];
    if (p.isHuman) {
      enableActions(true);
      setMessage('♠3でジョーカーを撃破！もう一度あなたのターン');
    } else {
      setTimeout(() => cpuTurn(), 900);
    }
    return;
  }

  updateLocks(prevField, cards);
  selectedCards = [];
  render();

  if (isSequence(cards)) {
    // 階段：ジョーカー代替ランクを含む効果ランクを昇順で順番に処理
    const seqEffectRanks = getSeqEffectRanks(cards);
    processSequenceEffects(playerIdx, cards, seqEffectRanks, 0, false, (samePlayer) => {
      afterEffect(playerIdx, samePlayer);
    });
  } else {
    const effectRank = nonJokers.length > 0 ? nonJokers[0].rank : null;
    handleSpecialEffect(playerIdx, cards, effectRank, nonJokers, (samePlayer) => {
      afterEffect(playerIdx, samePlayer);
    });
  }
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

// 現時点で使われていないランクのうち最上位（小さい数字）を返す
function nextAvailableRankFromTop() {
  const used = new Set(state.players.filter(p => p.finished).map(p => p.rank));
  return [0, 1, 2, 3].find(r => !used.has(r)) ?? 0;
}

function checkFinish(playerIdx) {
  const player = state.players[playerIdx];
  if (player.hand.length > 0 || player.finished) return false;

  player.finished = true;
  player.rank = nextAvailableRankFromTop();   // ← 空きランクの最上位を割り当て
  state.finishRanks.push(playerIdx);
  setMessage(`${player.name}が上がった！ → ${RANK_NAMES[player.rank]}`);

  if (state.finishRanks.length >= 3) {
    const last = state.players.find(p => !p.finished);
    if (last) {
      last.finished = true;
      last.rank = nextAvailableRankFromTop();  // 残り1枠
      state.finishRanks.push(last.id);
    }
    endRound();
    return true;
  }
  return false;
}

// 手札が禁止上がりカードのみのプレイヤーを下位ランクから確定させる
function checkForbiddenStuck() {
  // 手札が残り1枚でそれが禁止カードのときだけ確定する
  // （複数枚ある場合は他を先に出せる可能性があるため確定しない）
  const stuck = state.players.filter(p =>
    !p.finished &&
    p.hand.length === 1 &&
    isFinishForbiddenCard(p.hand[0])
  );
  if (stuck.length === 0) return false;

  // 最下位（大貧民=3）から順に割り当て
  const worstFirst = [3, 2, 1, 0];
  stuck.forEach(player => {
    const used = new Set(state.players.filter(p => p.finished).map(p => p.rank));
    const rank = worstFirst.find(r => !used.has(r));
    if (rank === undefined) return;
    player.finished = true;
    player.stuck = true;
    player.rank = rank;
    state.finishRanks.push(player.id);
  });

  const names = stuck.map(p => `${p.name}→${RANK_NAMES[p.rank]}`).join('、');
  setMessage(`禁止カードのみ！ ${names} 確定`);

  // 3人以上確定 → 残り1人のランクも確定してラウンド終了
  if (state.finishRanks.length >= 3) {
    const last = state.players.find(p => !p.finished);
    if (last) {
      last.finished = true;
      last.rank = nextAvailableRankFromTop();
      state.finishRanks.push(last.id);
    }
    render();
    endRound();
    return true;
  }

  render();
  return false;
}

function nextTurn() {
  if (checkForbiddenStuck()) return;
  const fivePlayer = state.currentPlayer; // 5を出したプレイヤー（全員スキップ時に戻る）
  let next = getNextActivePlayer(state.currentPlayer);
  while (state.skipNext > 0) {
    state.skipNext--;
    const skipped = state.players[next];
    if (!skipped.finished) {
      // スキップもパスと同等にカウント（場のリセット判定に使う）
      state.passCount++;
      const activePlayers = state.players.filter(p => !p.finished).length;
      if (state.passCount >= activePlayers - 1) {
        state.skipNext = 0; // 残りスキップをキャンセルして場リセット
        resetField();
        setMessage(`${skipped.name}をスキップ！場をリセット！`);
        next = fivePlayer; // 5を出したプレイヤーに手番を戻す
        break;
      } else {
        setMessage(`${skipped.name}をスキップ！`);
      }
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

// ===================== 階段エフェクトチェーン =====================
// 階段内のジョーカーを代替ランクに変換した上で、効果ランク一覧を返す
function getSeqEffectRanks(cards) {
  const jokerRank = getJokerSubstRank(cards); // ジョーカーが代替するランク（なければ null）
  const ranks = cards.map(c => c.rank === 'JOKER' ? jokerRank : c.rank)
    .filter(r => r && EFFECT_INFO[r]);
  return [...new Set(ranks)].sort((a, b) => RANK_ORDER[a] - RANK_ORDER[b]);
}

// 階段に含まれる各ランクの効果を順番に処理する
function processSequenceEffects(playerIdx, seqCards, effectRanks, idx, accSamePlayer, done) {
  if (idx >= effectRanks.length) { done(accSamePlayer); return; }
  const rank = effectRanks[idx];
  let rankCards = seqCards.filter(c => c.rank === rank);
  if (rankCards.length === 0) {
    // ジョーカーが代替しているランク → ジョーカーを代理カードとして使用（スートは階段スートに統一）
    const joker = seqCards.find(c => c.rank === 'JOKER');
    const seqSuit = seqCards.find(c => c.rank !== 'JOKER')?.suit || '♠';
    if (joker) rankCards = [{ rank, suit: seqSuit, id: joker.id }];
  }
  handleSpecialEffect(playerIdx, rankCards, rank, rankCards, (samePlayer) => {
    processSequenceEffects(playerIdx, seqCards, effectRanks, idx + 1, accSamePlayer || samePlayer, done);
  });
}

// ===================== 特殊効果 =====================
function handleSpecialEffect(playerIdx, cards, rank, nonJokers, done) {
  const player = state.players[playerIdx];
  const count = cards.length;

  // ---- 3 スート別効果（rank==='3'は EFFECT_INFO に登録なし） ----
  if (rank === '3') {
    const suit3 = nonJokers[0]?.suit;
    if (suit3 === '♣') {
      // ♣3 リセット：場への配置は doPlay 済み。通知のみ
      showEffectNotice('リセット！', '#795548');
      done(false);
      return;
    }
    if (suit3 === '♥' && count === 1) {
      // ♥3 ギフト
      handleHeart3Gift(playerIdx, done);
      return;
    }
    // ♦3 通常ターン出し・♠3 は効果なし（それぞれ割り込み/doPlay で処理）
    done(false);
    return;
  }

  const info = EFFECT_INFO[rank];
  if (!info) { done(false); return; }
  showEffectNotice(info.name, info.color);

  switch (rank) {
    case '4': {
      // 何枚出しても拾えるのは1枚、ジョーカーは拾えない
      const pickable = state.discardPile.filter(c => c.rank !== 'JOKER');
      if (pickable.length === 0) { done(false); return; }
      if (player.isHuman) {
        showEffectModal(`💀 死者蘇生`, `捨て札から1枚を手札に戻せます（0枚でもOK）`,
          pickable, 1,
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
        const picks = [...pickable].sort((a,b) => RANK_ORDER[b.rank]-RANK_ORDER[a.rank]).slice(0, 1);
        picks.forEach(c => { state.discardPile.splice(state.discardPile.findIndex(x=>x.id===c.id),1); player.hand.push(c); });
        sortHand(player.hand);
        setMessage(`${player.name}が捨て札から ${picks.length} 枚回収！`);
        render(); done(false);
      }
      break;
    }
    case '5': {
      state.skipNext = count; // 出した枚数分スキップ
      const skipMsg = count === 1 ? '次の1人を飛ばす' : `次の${count}人を飛ばす`;
      setMessage(`${player.name}がスキップ！${skipMsg}`);
      done(false); break;
    }
    case '6': {
      const suits = [...new Set(nonJokers.map(c => c.suit))];
      if (suits.length > 0) {
        state.suitLock = suits;
        setMessage(`${player.name}が強制縛り！${suits.join('')}のみ出せる`);
        render();
      }
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
      render();
      // ♦3「８切返し」割り込みチェック → 誰も割り込まなければ done(true)
      checkDiamond3Interrupt(playerIdx, () => done(true));
      break;
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

// ===================== ♥3 ギフト =====================
function handleHeart3Gift(playerIdx, done) {
  const player = state.players[playerIdx];
  if (state.discardPile.length === 0) { done(false); return; }
  showEffectNotice('ギフト！', '#e91e63');

  if (player.isHuman) {
    showEffectModal('💝 ギフト', '捨て札から1枚選んで、誰かに渡します（0枚でキャンセル）',
      [...state.discardPile], 1,
      (selected) => {
        if (selected.length === 0) { render(); done(false); return; }
        const card = selected[0];
        state.discardPile.splice(state.discardPile.findIndex(x => x.id === card.id), 1);
        // 渡す相手を選択
        showPlayerSelectModal('💝 ギフト', `${card.suit}${card.rank} を誰に渡しますか？`,
          state.players.filter(p => !p.finished),
          (targetIdx) => {
            state.players[targetIdx].hand.push(card);
            sortHand(state.players[targetIdx].hand);
            if (state.players[targetIdx].isHuman) highlightNewCards([card]);
            setMessage(`${state.players[targetIdx].name} に ${card.suit}${card.rank} を渡した！`);
            render(); done(false);
          }
        );
      }
    );
  } else {
    // CPU：最強カードを自分の手札に
    const picked = [...state.discardPile].sort((a, b) => RANK_ORDER[b.rank] - RANK_ORDER[a.rank])[0];
    state.discardPile.splice(state.discardPile.findIndex(x => x.id === picked.id), 1);
    player.hand.push(picked);
    sortHand(player.hand);
    setMessage(`${player.name} がギフト！捨て札から ${picked.suit}${picked.rank} を回収`);
    render(); done(false);
  }
}

// ===================== ♦3 ８切返し =====================
function checkDiamond3Interrupt(eightCutterIdx, onNoInterrupt) {
  // 8切りしたプレイヤー以外で♦3を持つ人を順番に収集
  const candidates = [];
  let cur = getNextActivePlayer(eightCutterIdx);
  for (let i = 0; i < 3; i++) {
    if (cur === eightCutterIdx) break;
    const p = state.players[cur];
    if (!p.finished && p.hand.some(c => c.suit === '♦' && c.rank === '3')) {
      candidates.push(cur);
    }
    const nxt = getNextActivePlayer(cur);
    if (nxt === cur) break;
    cur = nxt;
  }
  if (candidates.length === 0) { onNoInterrupt(); return; }
  processD3Chain(candidates, 0, onNoInterrupt);
}

function processD3Chain(candidates, idx, onNoInterrupt) {
  if (idx >= candidates.length) { onNoInterrupt(); return; }
  const playerIdx = candidates[idx];
  const player = state.players[playerIdx];

  if (player.isHuman) {
    showConfirmModal('♦ ８切返し',
      '♦3 で割り込みますか？（場はリセット済み、あなたが続けて出せます）',
      () => playDiamond3Interrupt(playerIdx),
      () => processD3Chain(candidates, idx + 1, onNoInterrupt)
    );
  } else {
    // CPU は 50% で割り込む
    if (Math.random() < 0.5) {
      setTimeout(() => playDiamond3Interrupt(playerIdx), 700);
    } else {
      processD3Chain(candidates, idx + 1, onNoInterrupt);
    }
  }
}

function playDiamond3Interrupt(playerIdx) {
  const player = state.players[playerIdx];
  const d3 = player.hand.find(c => c.suit === '♦' && c.rank === '3');
  if (!d3) return;

  // ♦3 を手札から捨て札へ（場は 8-cut ですでに空）
  player.hand.splice(player.hand.findIndex(c => c.id === d3.id), 1);
  state.discardPile.push(d3);

  showEffectNotice('♦3! ８切返し！', '#ff5722');
  setMessage(`${player.name} が ♦3 で割り込み！`);
  state.currentPlayer = playerIdx;
  render();

  if (checkFinish(playerIdx)) return;

  // ♦3 プレイヤーが空場でもう1ターン（8切りと同じ扱い）
  if (player.isHuman) {
    enableActions(true);
    setMessage('♦3 の効果！もう一度あなたのターン（８切返し）');
  } else {
    setTimeout(() => cpuTurn(), 900);
  }
}

// ===================== 汎用確認モーダル =====================
function showConfirmModal(title, desc, onYes, onNo) {
  const modal = document.createElement('div');
  modal.style.cssText =
    'position:fixed;inset:0;background:rgba(0,0,0,0.82);display:flex;' +
    'align-items:center;justify-content:center;z-index:95;';

  const box = document.createElement('div');
  box.style.cssText =
    'background:#1a3a2a;border:2px solid #ffd700;border-radius:16px;' +
    'padding:28px 32px;text-align:center;min-width:300px;';

  const titleEl = document.createElement('h3');
  titleEl.textContent = title;
  titleEl.style.cssText = 'font-size:22px;color:#ffd700;margin-bottom:10px;';

  const descEl = document.createElement('p');
  descEl.textContent = desc;
  descEl.style.cssText = 'font-size:14px;color:#ccc;margin-bottom:20px;line-height:1.5;';

  const btns = document.createElement('div');
  btns.style.cssText = 'display:flex;gap:14px;justify-content:center;';

  const yesBtn = document.createElement('button');
  yesBtn.textContent = '割り込む！';
  yesBtn.style.cssText =
    'padding:10px 22px;font-size:15px;font-weight:bold;background:#e74c3c;' +
    'color:#fff;border:none;border-radius:10px;cursor:pointer;';
  yesBtn.addEventListener('click', () => { modal.remove(); onYes(); });

  const noBtn = document.createElement('button');
  noBtn.textContent = 'パス';
  noBtn.style.cssText =
    'padding:10px 22px;font-size:15px;font-weight:bold;background:#7f8c8d;' +
    'color:#fff;border:none;border-radius:10px;cursor:pointer;';
  noBtn.addEventListener('click', () => { modal.remove(); onNo(); });

  btns.appendChild(yesBtn);
  btns.appendChild(noBtn);
  box.appendChild(titleEl);
  box.appendChild(descEl);
  box.appendChild(btns);
  modal.appendChild(box);
  document.body.appendChild(modal);
}

// ===================== プレイヤー選択モーダル =====================
function showPlayerSelectModal(title, desc, players, callback) {
  const modal = document.createElement('div');
  modal.style.cssText =
    'position:fixed;inset:0;background:rgba(0,0,0,0.82);display:flex;' +
    'align-items:center;justify-content:center;z-index:95;';

  const box = document.createElement('div');
  box.style.cssText =
    'background:#1a3a2a;border:2px solid #ffd700;border-radius:16px;' +
    'padding:28px 32px;text-align:center;';

  const titleEl = document.createElement('h3');
  titleEl.textContent = title;
  titleEl.style.cssText = 'font-size:22px;color:#ffd700;margin-bottom:10px;';

  const descEl = document.createElement('p');
  descEl.textContent = desc;
  descEl.style.cssText = 'font-size:14px;color:#ccc;margin-bottom:18px;';

  const btns = document.createElement('div');
  btns.style.cssText = 'display:flex;gap:10px;justify-content:center;flex-wrap:wrap;';

  players.forEach(p => {
    const btn = document.createElement('button');
    btn.textContent = p.name + (p.isHuman ? '（自分）' : '');
    btn.style.cssText =
      'padding:12px 22px;font-size:15px;font-weight:bold;background:#2c5f4a;' +
      'color:#fff;border:2px solid #aaa;border-radius:10px;cursor:pointer;';
    btn.addEventListener('click', () => { modal.remove(); callback(p.id); });
    btns.appendChild(btn);
  });

  box.appendChild(titleEl);
  box.appendChild(descEl);
  box.appendChild(btns);
  modal.appendChild(box);
  document.body.appendChild(modal);
}

// ===================== CPU AI =====================
function cpuTurn() {
  if (state.gameOver) return;
  const player = state.players[state.currentPlayer];
  if (player.isHuman || player.finished) return;

  const fieldLen = state.field.length;
  let played = fieldLen === 0 ? findPlayableFromEmpty(player.hand) : findPlayable(player.hand, fieldLen);

  // ♣3 リセット：場があって出す手がない場合の最終手段
  if (!played && fieldLen > 0) {
    const c3 = player.hand.find(c => c.suit === '♣' && c.rank === '3');
    if (c3) played = [c3];
  }

  // 詰み回避：手札が [禁止, 通常] の2枚のとき、禁止カードを先に出せるなら優先する
  // （禁止カードを先に出せば、次のターンで通常カードで正常上がりできる）
  if (player.hand.length === 2) {
    const forbidden = player.hand.filter(c => isFinishForbiddenCard(c));
    const normal    = player.hand.filter(c => !isFinishForbiddenCard(c));
    if (forbidden.length === 1 && normal.length === 1 && canPlay(forbidden)) {
      played = forbidden;
    }
  }

  // 禁止上がりになる場合は必ずパス
  // （手札が1枚で禁止カードのみの場合は nextTurn() 冒頭の checkForbiddenStuck で処理済み）
  if (played && isForbiddenFinish(state.currentPlayer, played)) {
    played = null;
  }

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
  if (state.suitLock.length > 0)   candidates = candidates.filter(c => c.rank === 'JOKER' || state.suitLock.includes(c.suit));
  if (state.numberLock) candidates = candidates.filter(c => c.rank === 'JOKER' || c.rank === state.numberLock);
  if (candidates.length === 0) return hand.length > 0 ? [hand[0]] : null;

  const jokers    = candidates.filter(c => c.rank === 'JOKER');
  const nonJokers = candidates.filter(c => c.rank !== 'JOKER');

  // ランク別にグループ化（弱い順）
  const groups = {};
  nonJokers.forEach(c => {
    if (!groups[c.rank]) groups[c.rank] = [];
    groups[c.rank].push(c);
  });
  const sorted = Object.entries(groups).sort((a, b) => RANK_ORDER[a[0]] - RANK_ORDER[b[0]]);
  for (const [, cards] of sorted) {
    const group = [...cards, ...jokers].slice(0, 4);
    if (group.length >= 2) return group;
  }

  // 縛りがない場合、弱い階段があれば出す
  if (!state.numberLock && state.suitLock.length === 0) {
    const seqs = findAllSequences(nonJokers);
    if (seqs.length > 0) {
      seqs.sort((a, b) => a.length - b.length || maxStrength(a) - maxStrength(b));
      return seqs[0];
    }
  }

  return [candidates[0]];
}

function findPlayable(hand, count) {
  const fldStrength = getFieldStrength();

  // 場が階段 → 同枚数の階段で上回るものを探す
  if (isSequence(state.field)) {
    const seqs = findAllSequences(hand, count)
      .filter(s => s.length === count && maxStrength(s) > fldStrength);
    if (seqs.length === 0) return null;
    return seqs.sort((a, b) => maxStrength(a) - maxStrength(b))[0];
  }

  let available = hand;
  if (state.numberLock) available = available.filter(c => c.rank === 'JOKER' || c.rank === state.numberLock);

  if (count === 1) {
    // 特例：場が単体ジョーカーなら ♠3 で勝てる
    if (state.field.length === 1 && state.field[0].rank === 'JOKER') {
      const s3 = hand.find(c => c.suit === '♠' && c.rank === '3');
      return s3 ? [s3] : null;
    }
    // 1枚出しは縛りスート内のカードのみ対象
    let candidates = available.filter(c => cardValue(c) > fldStrength);
    if (state.suitLock.length > 0) candidates = candidates.filter(c => c.rank === 'JOKER' || state.suitLock.includes(c.suit));
    if (candidates.length === 0) return null;
    return [candidates.sort((a,b) => cardValue(a)-cardValue(b))[0]];
  }

  // 複数枚出し：縛りスート外カードも候補に含め、グループとして縛りをカバーできれば採用
  const groups = {};
  available.filter(c => c.rank !== 'JOKER').forEach(c => {
    const v = cardValue(c);
    if (!groups[v]) groups[v] = [];
    groups[v].push(c);
  });
  const jokers = available.filter(c => c.rank === 'JOKER');
  for (const [v, cards] of Object.entries(groups).sort((a,b) => Number(a[0])-Number(b[0]))) {
    if (Number(v) <= fldStrength) continue;
    const total = cards.length + jokers.length;
    if (total < count) continue;
    // 縛りがある場合：ジョーカーは未カバーの縛りスートを1つ補填できる
    if (state.suitLock.length > 0) {
      const hasJ = jokers.length > 0;
      const inLock = cards.filter(c => state.suitLock.includes(c.suit));
      const coveredSuits = new Set(inLock.map(c => c.suit));
      const uncovered = state.suitLock.filter(s => !coveredSuits.has(s));
      if (uncovered.length > (hasJ ? 1 : 0)) continue; // ジョーカー1枚で1スートまで補填
      // 縛りスートのカードを優先し、残りを任意のカードで埋める（ジョーカーで補填）
      const notInLock = cards.filter(c => !state.suitLock.includes(c.suit));
      const selection = [...inLock, ...notInLock, ...jokers].slice(0, count);
      if (selection.length === count) return selection;
      continue;
    }
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
  if (state.suitLock.length > 0) lockParts.push(`スート縛り: ${state.suitLock.join('')}`);
  const lockEl = document.getElementById('lock-display');
  if (lockEl) {
    lockEl.textContent = lockParts.join('　');
    lockEl.classList.toggle('hidden', lockParts.length === 0);
  }

  const seqLabel = isSequence(state.field) ? '【階段】' : '';
  document.getElementById('field-info').textContent = state.field.length === 0
    ? '（場は空です）'
    : `${seqLabel}${state.field.length}枚  /  捨て札: ${state.discardPile.length}枚`;
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
    playerEl.classList.toggle('stuck', p.stuck);

    // 親マーク
    const isRoundStarter = state.roundStarter === i;
    const isTrickStarter = state.trickStarter === i;
    const labelEl = playerEl.querySelector('.cpu-label');
    const prevTitle = gameConfig.prevRanks
      ? `(${RANK_NAMES[gameConfig.prevRanks[i]] ?? ''})` : '';
    const parentMark = isRoundStarter ? ' 👑' : (isTrickStarter ? ' ◆' : '');
    const finishMark = p.stuck ? ' [詰]' : (p.finished ? ' ✓' : '');
    labelEl.textContent = `CPU${i}${prevTitle}${parentMark}${finishMark}`;
  });
}

function renderPlayerArea() {
  const el = document.getElementById('player-area');
  el.classList.toggle('active-turn', state.currentPlayer === 0 && !state.gameOver);

  const isRoundStarter = state.roundStarter === 0;
  const isTrickStarter = state.trickStarter === 0;
  const parentMark = isRoundStarter ? ' 👑' : (isTrickStarter ? ' ◆' : '');
  const player = state.players[0];
  const finishMark = player.stuck ? ' [詰]' : (player.finished ? ' ✓' : '');
  document.getElementById('player-label').textContent = `あなた${parentMark}${finishMark}`;
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

    if (isMyTurn) {
      // 自分のターン中だけ出せる/出せないを明暗で表示
      const playable = isCardPotentiallyPlayable(card);
      if (!playable) {
        cardEl.classList.add('locked-out');
        cardEl.style.cursor = 'not-allowed';
      } else {
        cardEl.onclick = () => toggleCard(card.id);
      }
    }

    const effectInfo = card.rank === '3' ? SUIT3_EFFECTS[card.suit] : EFFECT_INFO[card.rank];
    if (effectInfo) {
      const badge = document.createElement('div');
      badge.className = 'effect-badge';
      badge.textContent = effectInfo.name;
      badge.style.background = effectInfo.color;
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
