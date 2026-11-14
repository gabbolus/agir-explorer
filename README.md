# Age Group Income Ratio Explorer

An interactive dashboard on **age-income gaps** in 37 countries, 2004–2024, extending Guaitoli and Pancrazi (2026), *European Economic Review* ([doi:10.1016/j.euroecorev.2026.105408](https://doi.org/10.1016/j.euroecorev.2026.105408)).

The **Age Group Income Ratio** is the average disposable income of people aged 55–64 divided by that of people aged 25–34. With the dashboard you can:

- follow the Age Group Income Ratio over time for high-income and middle-income countries, and for up to six individual countries, with a plain-language reading of each line;
- compare all countries, or just the ones you pick, in two chosen periods;
- choose any two periods (3-year waves or single survey years) and split the change in the age-income gap into **wages, employment, transfer income, transfer share and other income**;
- see the numbers as data tables, download them as CSV (and the lower charts as PNG images), and copy a link that opens the dashboard with the same choices.

**Live site:** [https://gabbolus.github.io/agir-explorer/](https://gabbolus.github.io/agir-explorer/)

## The paper

Guaitoli, G. and Pancrazi, R. (2026), "Age-Income Gaps: The Role of Skill Congestion", *European Economic Review*, 188, 105408. https://doi.org/10.1016/j.euroecorev.2026.105408

**Abstract.** We study age-income gaps across 32 countries over 2004–2018 using harmonized microdata from the Luxembourg Income Study. We document a striking divergence: the ratio of disposable income of late-career workers (aged 55–64) relative to early-career workers (aged 25–34), which we name the Age Group Income Ratio (AGIR), rose by 18 percentage points in rich countries but fell by 8 percentage points in poor economies. This divergence operates primarily through the employment margin, which accounts for two-thirds of rising AGIR in rich countries and that conventional age-earnings measures miss entirely. To explain these patterns, we develop an overlapping generations model that discriminates among six competing mechanisms. In rich countries, skill congestion – late-career cohorts catching up with early-career workers in educational attainment and crowding them out of skilled labour markets – is the dominant driver of both margins. In poor countries, productivity growth dominates and skill congestion reduces rather than raises income inequality, as the young are expanding their college attainment more rapidly than the old.

The dashboard extends the paper's data beyond 2018 and adds new countries.

## Data and methods

- **Source:** Luxembourg Income Study (LIS) Database, accessed through LISSY in October 2026. All figures are aggregate statistics computed by the authors. No microdata are included.
- **Income:** personal labour income plus transfers (pensions, unemployment, family and education benefits), net of personal income taxes, in constant prices.
- **Growth Rate Differential (GRD):** annual income growth of 55–64 year-olds minus that of 25–34 year-olds, split exactly into the components listed above.
- **Group averages:** to keep the same countries in every period, a country without a survey in a period enters the average with its latest available value. Points that rely on these carried-forward values are shown with hollow markers and described as including carried-forward values. Individual country lines show observed values only.
- **Full dataset:** [`data/agir_data.csv`](data/agir_data.csv), described in the [codebook](data/CODEBOOK.md).

Full details are in the "Data and methods" section of the dashboard and in the paper.

## How to cite

Please cite the paper and the LIS data:

Guaitoli, G. and Pancrazi, R. (2026), "Age-Income Gaps: The Role of Skill Congestion", *European Economic Review*, 188, 105408. https://doi.org/10.1016/j.euroecorev.2026.105408

Luxembourg Income Study (LIS) Database, (multiple countries; microdata runs completed on 22 October 2026). Luxembourg: LIS.

```bibtex
@article{GuaitoliPancrazi2026,
  author  = {Guaitoli, Gabriele and Pancrazi, Roberto},
  title   = {Age-Income Gaps: The Role of Skill Congestion},
  journal = {European Economic Review},
  volume  = {188},
  pages   = {105408},
  year    = {2026},
  doi     = {10.1016/j.euroecorev.2026.105408}
}
```

## Links to a view

The address records the current choices, so a copied link opens the same view. For example, `?lines=Italy,Spain&from=2007&to=2022` shows Italy and Spain, from 2007–09 to 2022–24. Parameters: `lines` (countries, comma-separated), `averages` (`high`, `middle` or `none`), `periods=years`, `from` and `to` (first year of the wave, or the survey year), `rank` (`change` or `name`, for the all-countries chart) and `sort` (`name`, `wages`, `employment`, `transfer-income`, `transfer-share`, for the drivers chart). The all-countries chart and the drivers chart each have their own country choice: `ov` and `dr` take a comma-separated list of countries, `high`, `middle` or `none` (omitted when all countries are shown), and `ova` and `dra` take `high`, `middle` or `none` for the group averages (omitted when both are shown).

## Files

| File | Content |
|---|---|
| `index.html` | page layout and text |
| `assets/app.js` | calculations and charts (runs in the browser) |
| `assets/plotly-basic.min.js` | Plotly.js 2.35.2, basic bundle, hosted with the site (MIT licence, © Plotly, Inc.) |
| `assets/style.css` | styling, light and dark mode |
| `assets/preview.png` | image shown when the link is shared |
| `assets/favicon.svg`, `assets/favicon-32.png`, `assets/apple-touch-icon.png` | site icons |
| `data/agir_data.js` | country × period × age-group levels loaded by the dashboard, generated from the LISSY output |
| `data/agir_data.csv` | the same table as a CSV file |
| `data/CODEBOOK.md` | description of the variables and of how the dashboard uses them |

`data/agir_data.js` and `data/agir_data.csv` are written by `read_agir_ext_log.R`; do not edit them by hand. The script leaves South Africa out (`dash_exclude`), because its survey changed in 2023 and the series is not comparable across the break. The dashboard covers 37 countries.

## Page structure

The three scripts (Plotly, data, app) are loaded with `defer`, so the text appears before the charts do; the chart areas show a placeholder until they are drawn. The `?v=` tags on the style, data and script files are cache tags: change them whenever those files change.

## Licence

Code: MIT licence (see `LICENSE`). The data are aggregate statistics computed by the authors from the LIS Database.
