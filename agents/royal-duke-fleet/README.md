# Royal Duke Agent Runtime fleet

This package deploys six tool-less ADK runtimes: five institutional specialists
and one deliberately vulnerable shadow analyst. Each deployment requests
`AGENT_IDENTITY`, so Google Cloud provisions a distinct lifecycle-bound agent
principal. The agents return recommendations only; Runbook Compiler Control and
Broker retain all workflow, grant, capability, approval, and mutation authority.

Run `pnpm fleet:deploy` after creating the gateway and Model Armor resources.
The script is idempotent by display name and writes live resource evidence to
the ignored `.local/royal-duke-agent-runtime.json` file.

