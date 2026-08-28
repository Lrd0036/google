# Royal Duke OT range

This is the executable process model behind the Royal Duke map. It uses the
official OT-sim image at commit `f12dfd55d2df830509090cd241c2dc7cfb7c8ffc`
and pins the multi-architecture image digest in `docker-compose.yml`.

## What is real in the model

- `process-plc` runs OT-sim logic and a live Modbus TCP server. The simulated
  pump changes water pressure, flow, reservoir level, and alarm points.
- `operator-gateway` is a separate OT-sim device. It polls the PLC over live
  Modbus TCP, projects a potentially falsified operator pressure, and serves
  the points from a live DNP3 outstation.
- The controller accepts only the six actions defined in `scenario.json`. It
  does not provide a shell, packet builder, arbitrary tag write, or scanner.
- The S7 surface is an interface contract for controller project context,
  station trust, and change authority. OT-sim does not currently implement S7,
  so this model does not claim to be a Siemens device or expose TCP/102.

The protocol services stay inside Docker networks. Only the allowlisted HTTP
controller is published, and only on `127.0.0.1:9400`.

## Defensive Runbook Compiler bridge

The Runbook Compiler demo uses this range as its bounded physical-system
adapter. Set `ROYAL_DUKE_CONTROLLER_URL=http://host.docker.internal:9400`
for the Compiler's `royal-duke-worker`, and attach this controller to Control
with `FLEET_API` plus the shared `FLEET_BRIDGE_TOKEN`. Control rejects exercise,
approval, report, and provenance traffic without that bridge credential. The
bridge exposes no arbitrary tag-write or shell surface.

The controller's defensive endpoints are limited to evidence preservation,
remote-write containment, restoration preparation, and the single allowlisted
`POST /api/v1/defensive/restore-pump` operation. Runbook Compiler's human
approval remains the authority boundary before that operation is dispatched.
Capability reads use `GET /api/v1/state?sync=false` so Broker calls cannot form
a circular callback through Control; the ordinary polling loop reports the
result asynchronously.

## Run

```sh
pnpm demo:up
curl -fsS http://127.0.0.1:9400/health
curl -fsS http://127.0.0.1:9400/api/v1/state | jq
pnpm demo:range:smoke
```

Open the local site at `http://localhost:3000/?range=http://127.0.0.1:9400`.
The attack-surface panel can advance the prerequisite-gated range actions and
will replace the documentary pressure values with OT-sim telemetry.

Stop the range without deleting the pinned source files:

```sh
pnpm demo:down
```

## Attack chain

The scenario requires identity, path, knowledge, integrity, and controller
authority in order. Network visibility alone never satisfies the chain:

1. Establish an approved vendor maintenance session.
2. Resolve its brokered path into the engineering enclave.
3. Acquire the controller project and station context.
4. Insert a hostile instruction into attacker-controlled session evidence.
5. Obtain operator-view authority and freeze displayed pressure.
6. Obtain controller-write authority; the gateway translates an allowlisted
   update into the Modbus coil write.
7. Attempt another controller write after containment and record the block.
8. Record a physical consequence only after independent pressure crosses the
   52 PSI threshold.

This is a defensive, isolated simulator. The documentary map is a projection
of `scenario.json`; production topology, Siemens firmware behavior, and real
facility control authority are outside its evidence boundary.
