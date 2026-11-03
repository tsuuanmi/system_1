# Experiments

The experiment registry records what was tried. Each experiment is registered with the hypothesis it tests, and the registry identifies it exactly and by a structured fingerprint. It answers whether the experiment repeats, relates to, or retries a recorded one, then pre-registers or refuses it. The code is in [feedback-core](../../packages/feedback-core/README.md).

Parked (row off, package frozen) by PROP-0022 change 6; see [docs/proposals/0022-lean-core.md](../proposals/0022-lean-core.md).

## Two keys

The registry identifies an experiment by an exact identity and by a structured fingerprint, both computed by pure functions pinned to versions.

## An experiment

An experiment moves through proposed, preregistered, running, evaluated, and closed states, and only the evaluation that holds it may move it.

## A registration

A registration is checked, answered against the recorded experiments, admitted or refused, and recorded with its hypothesis and decision in one transaction.

### The four answers

A registration is answered `EXACT_REPEAT`, `CONTEXT_CHANGED`, `RELATED`, or `NOVEL`, depending on how it matches the recorded experiments.

## Lessons

A lesson is knowledge drawn from verdicts, and it applies only while its invalidation predicates hold in the current environment.
