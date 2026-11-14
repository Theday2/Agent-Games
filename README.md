# sky-agent-games

Agent **SKY-TANK** for [zkVerify Agent Games](https://agentgames.zkverify.io) — **Proof Gatekeeper** + **Steal the VFY** tracks. Competition runs 21 Oct – 21 Nov 2026.

- **Proof Gatekeeper**: approve/reject proof-backed payment requests. 7 trap varieties (VK substitution, threshold mismatch, proof reuse, expired condition, recipient mismatch, amount overflow). Wrong approvals cost −6, wrong rejections −3 — so on any uncertainty the agent **fails closed (REJECT)**.
- **Steal the VFY**: head-to-head strategy match, 20 turns, 100 VFY each. Conservative policy: FORTIFY when exposed and attacked, EXTRACT when the opponent leaves balance exposed, otherwise HOLD (always provable, never invalid).

## How it works

- Public HTTPS endpoint receives signed turn envelopes from the platform.
- Every request is verified with HMAC-SHA256 (`x-agent-games-signature` over the raw body) before parsing; every response is signed the same way.
- Gatekeeper decisions are made by pure local checks (no network) in ~1 ms, well inside the 60 s deadline.
- Groth16 proofs (Circom 2.x, BN128, snarkjs) are generated locally from the official circuit artifacts in `circuits/` and submitted via Kurier; verification is confirmed on-chain before any APPROVE.

## Run locally

```bash
npm install
cp .env.example .env   # set AGENT_GAMES_SECRET (issued at registration)
npm start              # listens on :3000
npm test               # mock-envelope self-test (17 checks)
```

## Deploy (Vercel, free Hobby tier)

The same handler runs as a serverless function (`api/index.js`):

```bash
npx vercel login        # one-time, authorise on your phone
npx vercel --prod       # deploys https://<project>.vercel.app
```

Set `AGENT_GAMES_SECRET` (and `KURIER_API_KEY` once wired) in the Vercel dashboard → Settings → Environment Variables. The endpoint URL to register is the deployed `https://<project>.vercel.app` (POST `/`).

Why Vercel and not a tunnel: this VM's egress proxy breaks the usual tunnel tools — cloudflared and ngrok both ignore the proxy env and fail their TLS handshakes (verified 14 Nov 2026). A serverless function has no tunnel to keep alive, no sleep, and a stable URL.

## Known limitations (honest)

- **Circuit input schema not yet wired.** The official circuits are downloaded (`circuits/`, vkHash verified against `/api/circuit-info`) but the .circom source / input-signal spec is not published on the build page, so `src/proof.js` refuses to generate proofs rather than guess wrong ones (`PROOF_READY = false`). Until the schema is found, Gatekeeper answers decisions without a proof: correct decisions still score (+12, minus 2, no reliability bonus) and no trap is ever approved — but the agent cannot earn the proof bonus.
- **On-chain verification not yet wired.** `src/kurier.js` is a stub: the Kurier endpoint paths/auth are not published on the build page. Until wired, valid-looking tasks fail closed to `REJECT / UNVERIFIED` (safe, but forfeits +12s). Wiring Kurier is the single highest-value next step.
- **Serverless state is per-instance.** `seenProofs`/`seenTurns` live in memory; on Vercel each function instance has its own copy, so PROOF_REUSED detection is best-effort. The on-chain check (once wired) is the real guard.
- **Prize payout is an SS58 address.** Per the competition Privacy Policy §02(g), the prize payout address must be a **zkVerify / Substrate SS58 address** — an EVM `0x…` address cannot receive native VFY. Register the SS58 address before the competition closes (21 Nov 2026).

## Layout

```
src/server.js      long-running HTTP server (local / tunnel)
src/handler.js     shared request handler (HMAC, routing, fail-closed)
src/gatekeeper.js  7-trap decision logic
src/steal.js       Steal strategy + turn validation
src/proof.js       snarkjs Groth16 proving (schema pending)
src/kurier.js      Kurier client (endpoint paths pending)
src/selftest.js    mock-envelope end-to-end test
api/index.js       Vercel serverless entrypoint
circuits/          official .wasm + .zkey artifacts
```

## License

MIT — see `LICENSE`.
