[README.md](https://github.com/user-attachments/files/32415180/README.md)
# Ledger Phase 1 — Fair Candidate Engine

This update changes the monthly AI contribution analysis so that:

- Existing holdings, watchlist assets, and scanner candidates compete in one neutral candidate pool.
- Existing ownership is neither rewarded nor penalized.
- Ledger calculates current allocation and the allocation after directing the full monthly contribution to each candidate.
- The AI receives asset type/exposure metadata for scanner candidates.
- The AI must compare every supplied candidate before choosing INVEST, PARTIAL, or WAIT.
- The AI can still recommend an existing holding when adding to it fits the portfolio better.
- The AI can recommend a watchlist/scanner asset when it fits better.
- The frontend displays the candidate comparison so you can see why the recommendation was selected.
- The Vercel API uses Structured Outputs to enforce the response schema and validates that the recommended ticker came from Ledger's candidate pool.

## Deploy

Repository structure:

    MoneyPortfolio/
    ├── api/
    │   └── analyze.js
    └── index.html

Replace your current `index.html` with this version and replace `api/analyze.js` with the new backend.

The existing `/api/opportunities` scanner is intentionally left untouched.

## Fairness test

With your real portfolio restored and your watchlist containing VXUS and BND:

1. Set monthly contribution to €100.
2. Run Analyze portfolio.
3. Check the "Fair candidate comparison" table.
4. Record the Asset Score, Portfolio Fit, current weight, post-€100 weight, and action for VUAA, VXUS, BND and the other candidates.
5. Change only the monthly contribution (for example €500) and run again.
6. Portfolio Score and Asset Scores should remain materially stable because the portfolio itself did not change. Portfolio fit/post-allocation and the contribution decision may change because the contribution scenario changed.

The goal is not to force Ledger away from VUAA. The goal is to make VUAA win only when the supplied portfolio data and candidate comparison support adding to it.
