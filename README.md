# sky-agent-games

Agent **Wowo** for [zkVerify Agent Games](https://agentgames.zkverify.io) — **Proof Gatekeeper** + **Steal the VFY** tracks. Competition runs 21 Oct – 21 Nov 2026. Auto rounds run daily **17:30–03:30 WIB**; once the agent is entered + healthy it is paired automatically (no manual start).

- **Proof Gatekeeper**: approve/reject proof-backed payment requests. 7 trap varieties (VK substitution, threshold mismatch, proof reuse, expired condition, recipient mismatch, amount overflow). Approve ONLY when every field matches (VK, minimum vs balance, recipient, amount cap, expiry, fresh proof). Wrong approvals cost −6, wrong rejections −3.
- **Steal the VFY**: head-to-head strategy match, 20 turns, 100 VFY each. Committed policy v1 (frozen, deterministic, stateless — see `STRATEGY.md`): FORTIFY to protect a lead, EXTRACT 5 when behind or the opponent is exposed, HOLD when the opponent is fortified.

## How it works

- Public HTTPS endpoint receives signed turn envelopes from the platform.
- Every request is verified with HMAC-SHA256 (`x-agent-games-signature` over the raw body) before parsing; every response is signed the same way. The 32-byte HMAC secret is issued once at registration — it lives in `AGENT_GAMES_SECRET`, never in the repo.
- Preflight (`agent-games.preflight.v1`) is answered `{ok:true, protocolVersion:"v1"}` — required before the agent is marked active.
- Gatekeeper decisions are made by pure local checks in ~1 ms, well inside the 60 s deadline.
- Groth16 proofs (Circom 2.x, BN128, snarkjs) are generated locally from the official circuit artifacts in `circuits/` and submitted to **Kurier mainnet** (`api.kurier.xyz`, free API key) until Finalized.
- Steal turns carry `policyProof` (circuitVersion, proofReference = vfy-policy vkHash, `publicInputsHash` computed with the published keccak256 formula) plus `agentTimestamp` and a unique `idempotencyKey` per turn.

## Run locally

```bash
npm install
cp .env.example .env   # set AGENT_GAMES_SECRET + KURIER_API_KEY
npm start              # listens on :3000 (use NODE_USE_ENV_PROXY=1 on this VM)
npm test               # mock-envelope self-test (26 checks, real formats)
node scripts/fetch-circuits.js   # downloads + verifies the 4 circuit artifacts
```

## Deploy (Vercel, free Hobby tier)

The same handler runs as a serverless function (`api/index.js`):

```bash
npx vercel login        # one-time, authorise on your phone
npx vercel --prod       # deploys https://<project>.vercel.app
```

Set `AGENT_GAMES_SECRET` (and `KURIER_API_KEY`) in the Vercel dashboard → Settings → Environment Variables. The endpoint URL to register is the deployed `https://<project>.vercel.app` (POST `/`).

Why Vercel and not a tunnel: this VM's egress proxy breaks the usual tunnel tools — cloudflared and ngrok both ignore the proxy env and fail their TLS handshakes (verified 14 Nov 2026). A serverless function has no tunnel to keep alive, no sleep, and a stable URL. A temporary deployment (`vercel deploy --temporary`) works without login but expires after 1 hour and must be claimed.

## Registering the agent (dashboard, by paman — no public API)

1. Link GitHub in Agent Games **Settings** (must be the **Theday2** account — the repo owner), then Register the agent (name **Wowo**, repo `github.com/Theday2/Agent-Games`, both tracks, endpoint URL).
2. At registration the platform shows a **32-byte HMAC secret exactly once** — save it immediately and give it to the builder (via Secure Vault); it is needed as `AGENT_GAMES_SECRET` for the endpoint to sign responses.
3. **Steal strategy commitment** (before Swiss Round 1): Dashboard → My Agents → Edit agent → Steal the VFY section → register an active commitment (hash of the vfy-policy circuit, vkHash in `STRATEGY.md`). Without it the agent cannot be paired.
4. Run a practice task + preflight; the agent must be healthy before the 17:30 window.

## Known limitations (honest)

- **Circuit input schema not published.** The `.circom` source / signal names for both circuits are not public (verified by search + wasm inspection, 14 Nov 2026). `src/proof.js` therefore refuses to generate proofs rather than guess wrong ones (`PROOF_READY = false`). Until the schema is obtained (ask the organisers on Discord, or read an example proof from Practice mode), Gatekeeper answers decisions without a proof: correct decisions still score (+12, minus 2, no reliability bonus) and no trap is ever approved — but the agent cannot earn the proof bonus.
- **Kurier is wired but needs an API key.** `src/kurier.js` implements the real mainnet endpoints (`submit-proof`, `job-status`, `vkRegistered: true`). The key is a free email signup at https://kurier.xyz — it has not been created yet.
- **Gatekeeper approves on local checks.** The on-chain gate is off by default (see `src/gatekeeper.js` for the trade-off): the six local checks catch every trap variety except a proof reused before this agent ever saw it. Re-enable the on-chain gate once Kurier proof verification is wired.
- **Serverless state is per-instance.** `seenProofs`/`seenTurns` live in memory; on Vercel each function instance has its own copy, so PROOF_REUSED detection is best-effort. The on-chain check (once wired) is the real guard.
- **Prize payout is an SS58 address.** Per the competition Privacy Policy §02(g), the prize payout address must be a **zkVerify / Substrate SS58 address** — an EVM `0x…` address cannot receive native VFY. Register the SS58 address before the competition closes (21 Nov 2026).

## Layout

```
src/server.js      long-running HTTP server (local / tunnel)
src/handler.js     shared request handler (HMAC, preflight, routing, fail-closed)
src/gatekeeper.js  7-trap decision logic (approve only if all fields match)
src/policy.js      committed Steal policy v1 + publicInputsHash (viem keccak256)
src/steal.js       Steal envelope validation + response shaping
src/proof.js       snarkjs Groth16 proving (schema pending)
src/kurier.js      Kurier mainnet client (submit-proof / job-status)
src/selftest.js    mock-envelope end-to-end test (real formats)
api/index.js       Vercel serverless entrypoint
scripts/fetch-circuits.js   downloads + verifies circuit artifacts
circuits/          official .wasm + .zkey artifacts (not committed)
STRATEGY.md        committed Steal policy + dashboard registration steps
```

## License

MIT — see `LICENSE`.
