# ADR-003: modular monolith

## Decision

Keep one v2 product boundary with explicit application and package boundaries. Modules communicate through contracts and ports; provider integrations, billing and workers remain replaceable boundaries.

## Why

This supports fast product development and transactional consistency without the operational cost of distributed services. A module can later be extracted when measured load, ownership or reliability requirements justify it.

## Guardrail

No web code calls provider APIs directly. No worker or future Hermes code receives raw provider credentials. Domain modules will be introduced only after foundation and identity boundaries are ready.
