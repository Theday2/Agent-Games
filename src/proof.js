/**
 * Groth16 proof generation with snarkjs (Circom 2.x, BN128).
 *
 * Circuits (from https://agentgames.zkverify.io/api/circuit-info):
 *   gatekeeper : vkHash 0x6b79c6012a6d8651f3e13bc4d2a20370280ab49700c90c5316d4168bfbad77b0
 *                13 public inputs, artifacts circuits/gatekeeper.wasm + .zkey
 *   vfy-policy : vkHash 0x6c56509f1c56fd1fd4e9737f906d2220f4b95f1d507f1adf6899085bd74be047
 *                9 public inputs, artifacts circuits/vfy-policy.wasm + .zkey
 *
 * STATUS: the circuit input schema (signal names + order + meaning of the
 * public inputs) is NOT published on the build page. Until the .circom
 * source or an official input spec is found, groth16FullProve() below
 * cannot be wired to real inputs — generateProof() throws a clear error
 * instead of producing a wrong proof. A wrong proof is worse than none
 * (-2 per turn / lost reliability bonus), so the server FAILS CLOSED and
 * answers without a proof rather than with an invalid one.
 *
 * Once the schema is known, fill in buildGatekeeperInput() and
 * buildPolicyInput() and flip PROOF_READY to true.
 */
'use strict';

const path = require('path');
const snarkjs = require('snarkjs');

const PROOF_READY = false; // flip to true once the input schema is verified

const CIRCUITS = {
  gatekeeper: {
    wasm: path.join(__dirname, '..', 'circuits', 'gatekeeper.wasm'),
    zkey: path.join(__dirname, '..', 'circuits', 'gatekeeper_final.zkey'),
    vkHash: '0x6b79c6012a6d8651f3e13bc4d2a20370280ab49700c90c5316d4168bfbad77b0',
    nPublic: 13,
  },
  vfyPolicy: {
    wasm: path.join(__dirname, '..', 'circuits', 'vfy-policy.wasm'),
    zkey: path.join(__dirname, '..', 'circuits', 'vfy-policy_final.zkey'),
    vkHash: '0x6c56509f1c56fd1fd4e9737f906d2220f4b95f1d507f1adf6899085bd74be047',
    nPublic: 9,
  },
};

/** TODO(schema): map a gatekeeper task + decision to circuit inputs. */
function buildGatekeeperInput(task, decision) {
  throw new Error('gatekeeper circuit input schema unknown — see proof.js header');
}

/** TODO(schema): map a Steal turn + action to circuit inputs. */
function buildPolicyInput(turn, action) {
  throw new Error('vfy-policy circuit input schema unknown — see proof.js header');
}

async function groth16FullProve(circuit, input) {
  const { proof, publicSignals } = await snarkjs.groth16.fullProve(
    input, circuit.wasm, circuit.zkey,
  );
  return { proof, publicSignals };
}

/**
 * Generate a proof for a gatekeeper decision. Throws when the schema is
 * not yet known (caller must fail closed, not retry with a guessed proof).
 */
async function proveGatekeeper(task, decision) {
  if (!PROOF_READY) throw new Error('gatekeeper proof not ready: circuit input schema unknown');
  const input = buildGatekeeperInput(task, decision);
  const { proof, publicSignals } = await groth16FullProve(CIRCUITS.gatekeeper, input);
  return { circuit: 'gatekeeper', circuitVersion: 'v1', proof, publicSignals, vkHash: CIRCUITS.gatekeeper.vkHash };
}

/** Generate a policy proof for a Steal turn. Same fail-closed rule. */
async function provePolicy(turn, action) {
  if (!PROOF_READY) throw new Error('vfy-policy proof not ready: circuit input schema unknown');
  const input = buildPolicyInput(turn, action);
  const { proof, publicSignals } = await groth16FullProve(CIRCUITS.vfyPolicy, input);
  return { circuit: 'vfy-policy', circuitVersion: 'v1', proof, publicSignals, vkHash: CIRCUITS.vfyPolicy.vkHash };
}

/** Local sanity check: verify a generated proof against its own .zkey. */
async function verifyLocal(circuitName, proof, publicSignals) {
  const circuit = CIRCUITS[circuitName];
  const vk = await snarkjs.zKey.exportVerificationKey(circuit.zkey);
  return snarkjs.groth16.verify(vk, publicSignals, proof);
}

module.exports = { proveGatekeeper, provePolicy, verifyLocal, CIRCUITS, PROOF_READY };
