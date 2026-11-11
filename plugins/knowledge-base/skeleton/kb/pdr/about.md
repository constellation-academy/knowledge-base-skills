---
type: reference
title: About PDRs
description: How Product Decision Records work in this knowledge base and how they differ from ADRs.
tags: [pdr, process]
---

# Product Decision Records (PDRs)

A Product Decision Record captures a significant product decision: what the product must do, why, and which alternatives were rejected. It is the same kind of record as an [ADR](../adr/about.md), written from the product side instead of the technical side.

## When to write a PDR

Write a PDR when a product decision is hard to reverse, non-obvious, cross-cutting or contested, the same tests as for an [ADR](../adr/about.md#when-to-write-an-adr). A one-off clarification belongs in its ticket.

## Rules shared with ADRs

Readability, status lifecycle, acceptance and numbering work as for [ADRs](../adr/about.md), with `PDR-NNNN` and the files in `pdr/`. Two differences:

- **The Decision section must be buildable.** "Behaves sensibly on a retry" is not a decision; a rule someone can implement and test is.
- **No in-place changes.** Any change to an accepted PDR needs a new PDR that supersedes it.

Every PDR follows the [PDR Template](../templates/pdr-template.md).
