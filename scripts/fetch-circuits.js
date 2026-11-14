/**
 * Download the official circuit artifacts from agentgames.zkverify.io
 * and verify SHA-256 checksums (recorded 14 Nov 2026).
 *
 * The .wasm/.zkey files are binary and are NOT committed to the repo —
 * run this once after checkout (and as part of the build) to fetch them
 * into circuits/.
 *
 * Usage: node scripts/fetch-circuits.js
 */
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const BASE = 'https://agentgames.zkverify.io/circuits/';
const DIR = path.join(__dirname, '..', 'circuits');

const FILES = [
  { name: 'gatekeeper.wasm', sha256: 'be00aefe3c8ba910951a242f50e55937bf82a0375ad4b69c2ef10629ab92764f' },
  { name: 'gatekeeper_final.zkey', sha256: 'adfe95a439a7063a82a4967ef026d2dd6857a4d02c63b3caf63dac02e01af80d' },
  { name: 'vfy-policy.wasm', sha256: 'bc0998250d2baf75b89deef5306867ffa7085a08d4f7d2caf0dd63a060b134d2' },
  { name: 'vfy-policy_final.zkey', sha256: 'f9666a1655279ef27f7fee6d535ac8aa9e39286ac40ff6279fea87c21ab6ce41' },
];

async function main() {
  fs.mkdirSync(DIR, { recursive: true });
  for (const f of FILES) {
    const dest = path.join(DIR, f.name);
    if (fs.existsSync(dest)) {
      const hash = crypto.createHash('sha256').update(fs.readFileSync(dest)).digest('hex');
      if (hash === f.sha256) {
        console.log(`OK (cached) ${f.name}`);
        continue;
      }
      console.log(`checksum mismatch (cached) ${f.name} — re-downloading`);
    }
    console.log(`downloading ${f.name} ...`);
    const res = await fetch(BASE + f.name);
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${f.name}`);
    const buf = Buffer.from(await res.arrayBuffer());
    const hash = crypto.createHash('sha256').update(buf).digest('hex');
    if (hash !== f.sha256) {
      throw new Error(`checksum mismatch for ${f.name}: got ${hash}, want ${f.sha256}`);
    }
    fs.writeFileSync(dest, buf);
    console.log(`OK ${f.name} (${buf.length} B)`);
  }
  console.log('All circuit artifacts verified.');
}

main().catch((e) => { console.error(e.message); process.exit(1); });
