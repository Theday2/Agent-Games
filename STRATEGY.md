# Steal the VFY — Committed Policy v1 (FROZEN)

Agent: **Wowo**. Policy version: `v1` (circuitVersion `1`).
Circuit: **vfy-policy**, vkHash
`0x6c56509f1c56fd1fd4e9737f906d2220f4b95f1d507f1adf6899085bd74be047`.

The policy is a pure, deterministic function of the public turn state only
(turn, selfBalance, opponentBalance, selfFortifiedUntilTurn,
opponentFortifiedUntilTurn) — no hidden history — so a turn's action can be
proven by the vfy-policy circuit from the public inputs alone.
Implementation: `src/policy.js` (`chooseAction` + `publicInputsHash`).

## Mechanics (official)

- 100 VFY each, 20 turns, Swiss 5 rounds → Top 16 knockout.
- HOLD: free, no movement.
- FORTIFY: costs 2 VFY, blocks up to 6 VFY of incoming extraction.
- EXTRACT: free, takes a bounded amount from the opponent's exposed
  balance. Documented example amount: **5**.

## Rules (in priority order)

1. Opponent fortified this turn → EXTRACT is blocked. If we are not
   fortified and balance ≥ 30 and turn ≤ 16 → FORTIFY; else HOLD.
2. Behind (selfBalance < opponentBalance), opponent not fortified →
   EXTRACT 5.
3. Ahead or level, not fortified, turn ≤ 16, balance ≥ 60 → FORTIFY
   (spend 2 to block up to 6).
4. Otherwise → EXTRACT 5.
5. Late game (turn ≥ 17): never FORTIFY → EXTRACT 5 if the opponent is
   not fortified, else HOLD.

## publicInputsHash

Published formula (keccak256 over ABI-packed 32-byte big-endian fields):
commitment → matchId (UUID as integer) → turn → selfBalance →
opponentBalance → action (HOLD 0 / FORTIFY 1 / EXTRACT 2) → amount →
circuitVersion (1). Implemented in `src/policy.js` with `viem`.

## Registering the commitment (dashboard, by paman — no public API)

Before Swiss Round 1 opens: **Dashboard → My Agents → Edit agent →
Steal the VFY section → register an active strategy commitment**.
It commits a hash of the policy circuit (the vkHash above); the platform
freezes it when matches are paired and rejects any turn that uses a
different circuit version. **Without an active commitment the agent
cannot be paired.** One agent + one circuit for all 5 rounds.

## Scoring reminder

Win +18, draw +9, loss +3, reliability +0..+2, timeout −1/turn,
invalid proof −2/turn. A missed turn is a forced HOLD + −1, so the
endpoint must never miss a turn — the handler answers HOLD (never an
error) on any invalid/duplicate envelope.
