

## Plan: Add a "Dashboard" tab to the ATS page

Inspired by SaaS tools like Lemlist, Teamtailor, and recruitment analytics dashboards, I'll create a rich analytics dashboard as the first tab in the ATS view.

### Dashboard Layout (brutal design, responsive)

```text
Desktop (2-col grid):
┌─────────────────────────────┬──────────────────────────┐
│  Pipeline Funnel (BarChart) │  Source Breakdown (Pie)  │
├─────────────────────────────┼──────────────────────────┤
│  Activity Over Time (Area)  │  Top Jobs (horizontal)   │
├─────────────────────────────┴──────────────────────────┤
│  Recent Activity Feed (latest stage changes)           │
└────────────────────────────────────────────────────────┘

Mobile: single column, stacked
```

### What gets built

1. **New component `src/components/ats/ATSDashboard.tsx`**
   - Receives `candidates: ATSCandidate[]` and `stages: ATS_STAGES`
   - Uses `recharts` (already installed) with the project's `ChartContainer`/`ChartTooltip` wrappers
   - **Pipeline Funnel**: Horizontal bar chart showing count per stage (Nouveau → Gagné), ordered by pipeline progression, with stage colors
   - **Source Breakdown**: Donut/pie chart showing candidates by source (local, sequence, inmail)
   - **Activity Over Time**: Area chart grouping candidates by `createdAt` date (last 30 days), showing new candidates added per day
   - **Top Jobs**: Horizontal bar chart of top 5 jobs by candidate count
   - **Recent Activity**: Simple list of the 10 most recent candidates with stage badge and timestamp
   - **KPI Cards row** at top: Total, Response Rate, Conversion Rate, Avg time in pipeline (computed from data)

2. **Update `src/pages/ATS.tsx`**
   - Add `dashboard` to the `viewTabs` array with a `BarChart3` icon, as the **first** tab
   - Default `activeView` to `'dashboard'`
   - Add `TabsContent` for dashboard view rendering `ATSDashboard`
   - Update the type for `activeView` state

3. **Design system consistency**
   - All cards use `border border-foreground` brutal style (no rounded corners, no shadows)
   - Chart colors use the existing `brutal-accent` and foreground palette
   - Responsive: 2-col grid on `md:`, single col on mobile
   - Compact spacing matching the existing ATS brutal aesthetic

### Data source
All data is derived client-side from the existing `candidates` array (already loaded by `useATSData`). No new API calls or database queries needed.

