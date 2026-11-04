# Statistics

The statistics library turns one metric's paired values per case into the interval that the [verdict rule](evaluations.md#the-verdict-rule) reads. It is pure inference: it holds no threshold and decides nothing. Its one method is the exact paired sign-flip test and the confidence interval that inverts it.

Parked (row off, package frozen) by PROP-0022 change 6; see [docs/proposals/0022-lean-core.md](../proposals/0022-lean-core.md).

## The sign-flip test

The test enumerates every sign vector over the paired differences, so its p-values are exact for 2 to 20 pairs.

## The interval

The interval of the mean difference is the set of shifts the two-sided test does not reject, bounded by the `K`-th smallest and largest subset means.

## The analysis method

The `sign-flip` method gives the interval of the mean paired difference and an unbounded candidate level, and it refuses any input outside its domain.

## Golden tests

The library's p-values and interval bounds are checked against SciPy's `permutation_test` on fixed datasets, and no decision is made until those goldens are verified.

## Where the design leaves room

Monte Carlo above 20 cases, other methods such as a paired bootstrap, and pre-trial checks are not offered, because the experiment record cannot yet carry what they need.
