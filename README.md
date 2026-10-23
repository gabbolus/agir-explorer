# Age Group Income Ratio Explorer

An interactive dashboard on **age-income gaps** in 37 countries, 2004–2024, extending Guaitoli and Pancrazi (2026), *European Economic Review* ([doi:10.1016/j.euroecorev.2026.105408](https://doi.org/10.1016/j.euroecorev.2026.105408)).

The **Age Group Income Ratio** is the average disposable income of people aged 55–64 divided by that of people aged 25–34. With the dashboard you can:

- follow the Age Group Income Ratio over time for high-income and middle-income countries, and for up to three individual countries;
- choose any two periods (3-year waves or single survey years) and split the change in the age-income gap into **wages, employment, transfer income, transfer share and other income**;
- see the numbers as a table and download them as CSV.

**Live site:** [https://gabbolus.github.io/agir-explorer/](https://gabbolus.github.io/agir-explorer/)

## The paper

Guaitoli, G. and Pancrazi, R. (2026), "Age-Income Gaps: The Role of Skill Congestion", *European Economic Review*. https://doi.org/10.1016/j.euroecorev.2026.105408

**Abstract.** We study age-income gaps across 32 countries over 2004–2018 using harmonized microdata from the Luxembourg Income Study. We document a striking divergence: the ratio of disposable income of late-career workers (aged 55–64) relative to early-career workers (aged 25–34), which we name the Age Group Income Ratio (AGIR), rose by 18 percentage points in rich countries but fell by 8 percentage points in poor economies. This divergence operates primarily through the employment margin, which accounts for two-thirds of rising AGIR in rich countries and that conventional age-earnings measures miss entirely. To explain these patterns, we develop an overlapping generations model that discriminates among six competing mechanisms. In rich countries, skill congestion – late-career cohorts catching up with early-career workers in educational attainment and crowding them out of skilled labour markets – is the dominant driver of both margins. In poor countries, productivity growth dominates and skill congestion reduces rather than raises income inequality, as the young are expanding their college attainment more rapidly than the old.

The dashboard extends the paper's data beyond 2018 and adds new countries.

## Data and methods

- **Source:** Luxembourg Income Study (LIS) Database, accessed through LISSY in October 2026. All figures are aggregate statistics computed by the authors. No microdata are included.
- **Income:** personal labour income plus transfers (pensions, unemployment, family and education benefits), net of personal income taxes, in constant prices.
- **Growth Rate Differential (GRD):** annual income growth of 55–64 year-olds minus that of 25–34 year-olds, split exactly into the margins listed above.
- **Group averages:** to keep the same countries in every period, a country without a survey in a period enters the average with its latest available value. Points that rely on these carried-forward values are marked as partially imputed. Individual country lines show observed values only.

Full details are in the "Data and methods" section of the dashboard and in the paper.

## Citation

Guaitoli, G. and Pancrazi, R. (2026), "Age-Income Gaps: The Role of Skill Congestion", *European Economic Review*. https://doi.org/10.1016/j.euroecorev.2026.105408
Data: Luxembourg Income Study (LIS) Database, (multiple countries; microdata runs completed on 22 October 2026). Luxembourg: LIS.

## Files

| File | Content |
|---|---|
| `index.html` | page layout and text |
| `assets/app.js` | calculations and charts (runs in the browser; uses Plotly.js) |
| `assets/style.css` | styling, light and dark mode |
| `data/agir_data.js` | country × period × age-group levels, generated from the LISSY output |
