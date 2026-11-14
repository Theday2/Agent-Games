/**
 * Steal the VFY — strategy + turn handling.
 *
 * Match: 20 turns, 100 VFY each, Swiss 5 rounds -> Top 16 knockout.
 * Actions: EXTRACT (free, takes a bounded amount from opponent's exposed
 * balance), FORTIFY (small fixed cost, protects part of your balance),
 * HOLD (free, no movement). Resolution is simultaneous against prior
 * public state only — never arrival order.
 * Scoring: win +18, draw +9, loss +3, reliability +0..+2,
 * timeout -1/turn, invalid proof -2/turn.
 *
 * Policy (parameterised, conservative — a submitted-but-invalid proof is
 * -2 and a timeout is -1, so NEVER miss a turn and NEVER send an action
 * the committed strategy cannot prove):
 *   - If our exposed balance is large and the opponent extracted last
 *     turn (or is likely to), FORTIFY.
 *   - Else if the opponent's exposed balance is worth taking, EXTRACT.
 *   - Else HOLD.
 * Exact caps/costs (EXTRACT cap, FORTIFY cost, exposed fraction) come
 * from the turn envelope / docs — see README. Defaults below are the
 * documented ones where known; tune after the first practice turns.
 *
 * The platform computes publicInputsHash from the game state it knows and
 * rejects proofs whose hashes diverge — compute it from the envelope's
 * state fields in the exact documented field order (see proof.js).
 */
'use strict';

const ACTIONS = { EXTRACT: 'EXTRACT', FORTIFY: 'FORTIFY', HOLD: 'HOLD' };

/**
 * Choose an action for one turn.
 * @param {object} state - game state from the turn envelope. Expected
 *   fields (names per the platform envelope; missing fields default to 0):
 *   myBalance, myExposed, opponentBalance, opponentExposed,
 *   myFortified, opponentFortified, turn, matchId,
 *   opponentLastAction (if the envelope carries history).
 * @param {object} cfg - tunables
 * @returns {{action: string, amount?: number, reason: string}}
 */
function chooseAction(state, cfg = {}) {
  const {
    extractMinGain = 1,     // only EXTRACT if expected gain >= this
    fortifyThreshold = 25,  // FORTIFY when our exposed balance >= this
    extractThreshold = 5,   // EXTRACT when opponent exposed >= this
  } = cfg;

  const myExposed = Number(state.myExposed ?? 0);
  const oppExposed = Number(state.opponentExposed ?? 0);
  const turn = Number(state.turn ?? 0);

  // Late match, behind on balance: take what is available.
  // (Balance comparison needs myBalance/opponentBalance from the envelope.)
  const myBalance = Number(state.myBalance ?? 100);
  const oppBalance = Number(state.opponentBalance ?? 100);

  // 1. Protect ourselves when we are exposed and the opponent is aggressive.
  if (myExposed >= fortifyThreshold && state.opponentLastAction === 'EXTRACT') {
    return { action: ACTIONS.FORTIFY, reason: 'exposed-and-opponent-extracting' };
  }

  // 2. Take value when the opponent leaves balance exposed.
  if (oppExposed >= extractThreshold) {
    const gain = Math.min(oppExposed, Number(cfg.extractCap ?? oppExposed));
    if (gain >= extractMinGain) {
      return { action: ACTIONS.EXTRACT, amount: gain, reason: 'opponent-exposed' };
    }
  }

  // 3. Behind late in the match: extract whatever is exposed, even small.
  if (turn >= 15 && myBalance < oppBalance && oppExposed > 0) {
    return { action: ACTIONS.EXTRACT, amount: Math.min(oppExposed, Number(cfg.extractCap ?? oppExposed)), reason: 'behind-late' };
  }

  // 4. Default: preserve state. HOLD is always provable and never invalid.
  return { action: ACTIONS.HOLD, reason: 'no-edge' };
}

/**
 * Validate a turn envelope minimally before acting.
 * Returns an error string, or null when the envelope looks usable.
 */
function validateTurn(envelope) {
  if (!envelope || typeof envelope !== 'object') return 'empty-envelope';
  if (!envelope.matchId) return 'missing-matchId';
  if (envelope.turn === undefined || envelope.turn === null) return 'missing-turn';
  if (envelope.deadline && Date.now() > Date.parse(envelope.deadline)) return 'turn-expired';
  return null;
}

module.exports = { chooseAction, validateTurn, ACTIONS };
