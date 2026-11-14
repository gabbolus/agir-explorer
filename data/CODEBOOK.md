# Codebook: `agir_data.csv`

`agir_data.csv` holds the aggregate statistics behind the [Age Group Income Ratio Explorer](https://gabbolus.github.io/agir-explorer/). Every number in the dashboard is computed from this file. It contains no microdata.

The same table is loaded by the dashboard from `agir_data.js` (as the text variable `window.AGIR_CSV`). Both files are written by `read_agir_ext_log.R` from the LISSY output and should not be edited by hand.

**Source.** Luxembourg Income Study (LIS) Database, all waves available in October 2026, accessed through LISSY (microdata runs completed on 22 October 2026). The code follows Guaitoli, G. and Pancrazi, R. (2026), "Age-Income Gaps: The Role of Skill Congestion", *European Economic Review*, 188, 105408, https://doi.org/10.1016/j.euroecorev.2026.105408.

## Structure

One row per **country × period type × period × age group**. The file has 37 countries.

| Column | Type | Description |
|---|---|---|
| `Country` | text | Country name in English. |
| `pt` | text | Period type: `year` (single survey year) or `wave` (3-year wave). |
| `period` | integer | For `pt = year`, the survey year (2004–2024). For `pt = wave`, the wave number: 1 = 2004–06, 2 = 2007–09, 3 = 2010–12, 4 = 2013–15, 5 = 2016–18, 6 = 2019–21, 7 = 2022–24. |
| `yrm` | number | Average survey year in the period. Equal to `period` for single years. Used to annualise growth between two periods. |
| `ny` | integer | Number of survey years in the period (1 for single years). |
| `age` | integer | Age group: `2` = 25–34, `5` = 55–64. |
| `y` | number | Average disposable personal income of everyone in the age group, working or not: labour income plus transfers, net of personal income taxes. Constant prices, national currency (deflated with the CPI series supplied by LIS). |
| `yse` | number | Standard error of `y`. |
| `e` | share | Employment rate: share of the age group in employment. |
| `w` | number | Average net labour income of the employed. Personal income taxes are split between labour income and transfers in proportion to each person's amounts. |
| `w_raw` | number | Average labour income of the employed as reported, before taxes are split. |
| `p` | share | Share of the age group receiving any transfer (pensions, unemployment, family and education benefits). |
| `th` | number | Average net transfer among those who receive one (Θ in the dashboard). Set to 0 when nobody receives transfers (`p = 0`). |
| `n` | integer | Number of observations (unweighted). |

**Weights.** Statistics use LIS person weights. In waves, each survey year has the same total weight.

**Missing values.** An empty cell means the statistic is not available.

## How the dashboard uses it

- **Age Group Income Ratio (AGIR)** for a country and survey year: `y` (age 5) / `y` (age 2). Its standard error uses the delta method: AGIR × √((`yse`₅/`y`₅)² + (`yse`₂/`y`₂)²).
- **Wave AGIR**: the mean of the annual AGIRs in the wave, as in the paper (not the ratio of the wave rows of `y`).
- **Group averages**: simple means of country AGIRs. High-income countries (2004 GDP per capita, PPP, as in the paper): Australia, Austria, Belgium, Canada, Czechia, Denmark, Finland, France, Germany, Iceland, Ireland, Israel, Italy, Netherlands, Norway, Slovenia, Spain, Sweden, Switzerland, United Kingdom, United States. All others are middle-income. A country with no survey in a period enters the average with its latest value (carried forward).
- **Decomposition** of the Growth Rate Differential between periods 0 and 1, for each age group: `y = e·w + p·th + other`, so
  - wages: `e1 (w1 − w0)`
  - employment: `w0 (e1 − e0)`
  - transfer income: `p1 (th1 − th0)`
  - transfer share: `th0 (p1 − p0)`
  - other income: the rest of the change in `y`

  Each term is divided by `y0` and by the years between the periods (`yrm1 − yrm0`), in percentage points per year. The GRD is the 55–64 value minus the 25–34 value; the five terms add up to it exactly.
