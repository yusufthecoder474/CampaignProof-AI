# Data provenance

Source: [UCI Bank Marketing](https://archive.ics.uci.edu/dataset/222/bank+marketing), DOI [10.24432/C5K306](https://doi.org/10.24432/C5K306).
S. Moro, P. Rita, and P. Cortez. Bank Marketing (2014). UCI Machine Learning Repository.
Dataset license: [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). Project source code uses MIT separately.

The original `bank-additional-full.csv` and `bank-additional-names.txt` are retained without modification. 41,188 Portuguese banking contacts, May 2008–November 2010, in source chronological order. Exact dates and customer identifiers are unavailable. Row order is the temporal split proxy; repeated customers cannot be grouped reliably. This is not Indian consumer data.

Derived artifacts: allowlisted features, chronological 60/20/20 split, training-only preprocessing, Logistic Regression coefficients, and a seeded 500-record demonstration pool from the final test partition. Test labels are in `artifacts/seed.sql` for the local backend; never serve that file to the frontend. Public historical data cannot be considered a secure blind test for pretrained LLMs.

Download with `python ml/prepare.py`. If download fails, obtain the original `bank-additional.zip` from UCI and extract `bank-additional-full.csv` here. Do not substitute `bank.csv` or the randomly sampled additional variant.
