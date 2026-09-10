# Construct Lifecycle component inventory

Source: the existing Construct Lifecycle web application in `artifacts/cabinet-projects`.
App pages and business-specific compositions are excluded.

| Family | Build contract | Dependencies | Evidence | Chunk | Status |
| --- | --- | --- | --- | --- | --- |
| Button | [button.md](components/button.md) | React | Used throughout shell, forms, pages, and error recovery | 1 | implemented |
| Badge | [badge.md](components/badge.md) | React | Used for project stages and operational status | 1 | implemented |
| Modal | [modal.md](components/modal.md) | Button, lucide-react | Used by project create/edit workflows | 1 | implemented |
| Loading Panel | [loading-panel.md](components/loading-panel.md) | React | Shared loading treatment across protected views | 1 | implemented |
| Empty State | [empty-state.md](components/empty-state.md) | React, lucide-react | Shared zero-data treatment | 1 | implemented |
| Error Panel | [error-panel.md](components/error-panel.md) | Button, lucide-react | Shared request failure recovery | 2 | implemented |
| Stat Card | [stat-card.md](components/stat-card.md) | React, lucide-react | Dashboard summary metrics | 2 | implemented |
| Page Title | [page-title.md](components/page-title.md) | React | Shared page hierarchy and action slot | 2 | implemented |
| Activity List | [activity-list.md](components/activity-list.md) | Empty State | Repeated project activity timeline | 2 | implemented |