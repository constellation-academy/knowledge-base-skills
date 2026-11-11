---
type: reference
title: About ADRs
description: How Architecture Decision Records work in this knowledge base — when to write one, statuses, acceptance and numbering.
tags: [adr, process]
---

# Architecture Decision Records (ADRs)

An Architecture Decision Record captures a significant technical decision: what was chosen, why, and which alternatives were rejected. ADRs are the memory of the team's architecture.

## When to write an ADR

Write an ADR when a decision is:

- **Hard to reverse:** changing course later is expensive.
- **Non-obvious:** the reasoning cannot be read from the code or the ticket alone.
- **Cross-cutting:** it affects several systems, teams or long-lived contracts.
- **Contested:** reasonable people disagree, and the reasoning needs to be on record.

A one-off clarification that only affects one ticket belongs in that ticket, not in an ADR.

## Readability

- **One ADR, one decision.** The title names that decision.
- **Context** is the problem in a few lines. **Consequences** are a few bullets.
- **State each rule directly**, in plain language, with a bold lead sentence.
- **No implementation detail** such as file names or configuration; link the ticket or pull request instead.
- **Alternatives only if they were really weighed.**
- **Every term the ADR relies on is defined in the [Glossary](../glossary.md)** by the time it is accepted.

## Status lifecycle

The `status` frontmatter field and the body's `**Status:**` line always agree.

| Status | Meaning |
| --- | --- |
| `Proposed` | Under discussion in its open pull request, not yet decided |
| `Accepted` | Decided |
| `Postponed` | Deferred: not rejected, not active yet |
| `Superseded` | Replaced by a newer ADR, written `Superseded by ADR-NNNN` |

## Acceptance

Anyone on the team can propose an ADR. It starts as `Proposed` in its own pull request and is never created as `Accepted`. The person who decides for the team, named in the [README](../README.md#decisions), accepts it by setting its status to `Accepted` in that same pull request and merging it.

## Immutability

An accepted ADR is not changed. When a decision is revisited, write a new ADR that links the original, and set the original's status to `Superseded by ADR-NNNN` with a link to the new one. An accepted ADR may be updated in place only when what was chosen and why stay the same.

## Format and numbering

Every ADR follows the [ADR Template](../templates/adr-template.md). Numbers have four digits, without gaps, in creation order: take the highest number in `adr/` and add one. The file is named `ADR-NNNN-<short-slug>.md`.
