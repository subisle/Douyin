# ADR 0001: iLink Agent Runtime Contract

- Status: Accepted
- Date: 2026-07-23
- Scope: server-side Weixin iLink agent runtime

## Decision

The first production topology has two deployable processes:

1. `next-web`: authenticated control plane and protected data APIs.
2. `ilink-worker`: account lease, polling, durable inbox dispatch, workflow execution, artifact handling, and outbox delivery.

Workflow and scheduler loops remain modules inside `ilink-worker` until measured load or fault isolation requires a separate process. Adding a framework is not a release dependency.

The executable schema in `migrations/` is the only database truth. This ADR owns cross-document contracts and ordering. Product plans may describe milestones but must not redefine types, tables, or topology.

## Runtime Result

```ts
type AgentResult = {
  runId: string;
  sessionId: string;
  workflowId: string;
  workflowVersion: number;
  runtimeVersion: string;
  status: "succeeded" | "waiting_input" | "waiting_approval" | "failed";
  reply: string;
  route: "system" | "command" | "fast-route" | "agent" | "fallback";
  artifacts: ArtifactRef[];
  sources: SourceRef[];
  usage: { modelCalls: number; toolCalls: number; inputTokens?: number; outputTokens?: number };
  pendingApproval?: { actionId: string; expiresAt: string };
  errorCode?: string;
  traceId: string;
};
```

MVP adapters may omit fields only at their external boundary. Persisted runs and new internal code use the complete contract.

`runtimeVersion` is an immutable manifest digest over code build SHA, workflow, prompt, tool policy/schema, model profile, RAG index, feature flags, and database schema version.

## Persistence

Migration `001_ilink_runtime` establishes the transport foundation:

- `ilink_accounts`
- `ilink_update_cursors`
- `bot_runner_leases`
- `inbox_messages`
- `outbox_messages`
- `artifacts`
- `import_records`

Later migrations add sessions, runs, steps, effects, approvals, audit, knowledge versions, schedules, and evaluations. Every tenant-owned row carries the applicable `workspace_id`, `account_id`, `session_id`, and actor identity.

Credentials, cursors, message bodies, context tokens, and media parameters are encrypted fields with a key identifier. Metadata remains minimal. Inbox, Outbox, and Artifact rows have retention and expiry fields.

## Delivery Invariants

1. Account lease acquisition increments a fencing token in one conditional database update.
2. Text updates are inserted into Inbox in the same transaction that advances the cursor.
3. Media is copied to durable Artifact staging before the transaction advances the cursor.
4. A session mailbox has a monotonic sequence and one active claim; waiting runs release the claim.
5. Business writes, run-step state, and effect ledger entries share one database transaction.
6. Business transactions create Outbox rows; network sends never occur inside the business transaction.
7. A stable `client_id` is reused. Ambiguous upstream timeouts enter `unknown/reconcile`; retry behavior is gated by a verified iLink idempotency contract.

The runtime targets effectively-once processing. It does not claim distributed exactly-once delivery.

## Identity And Approval

The model emits an action intent only. The server resolves identity and policy, computes canonical arguments and impact preview, then creates an immutable proposal containing a nonce hash, data version, expiry, and idempotency key. Approval consumption is atomic.

iLink may request an administrative change and display its status. Prompt, model, workflow, tool-policy publishing, credential rotation, and rollback are completed only in a step-up authenticated Web session.

## Implementation Order

1. Remove embedded credentials, enforce authentication, and create a reproducible Git baseline.
2. Apply migrations and implement database lease/fencing, encrypted Inbox/Cursor, Artifact staging, and Outbox.
3. Extract the pure Node iLink adapter and complete real-account text/media contract tests.
4. Add Session/Run/Step/effect/approval state and crash-point recovery tests.
5. Ship read capabilities, then artifacts, confirmed writes, and collector-backed capabilities.
6. Add scheduling, subscriptions, evaluation, and bounded multi-agent workflows after measured demand.

## Release Evidence

Each capability is one machine-readable action with separate `implementationStatus`, `accessMode`, `executionMode`, and evidence fields. A module-level row is not sufficient evidence for multiple actions.
