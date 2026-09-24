# Frontend dashboard architecture

This dashboard is being reorganized around a feature-first structure so it is easier to maintain and extend.

## Structure

```text
apps/dashboard/
├── index.html
├── app.js
├── styles.css
├── src/
│   ├── app.js
│   ├── config.js
│   ├── state/
│   │   └── store.js
│   ├── services/
│   │   ├── api.js
│   │   └── storage.js
│   ├── utils/
│   │   ├── format.js
│   │   └── ui.js
│   ├── features/
│   │   ├── auth/
│   │   │   └── auth.js
│   │   ├── dashboard/
│   │   │   └── dashboard.js
│   │   ├── whatsapp/
│   │   │   └── whatsapp.js
│   │   ├── routing/
│   │   │   └── routing.js
│   │   └── settings/
│   │       └── settings.js
│   └── styles/
│       ├── base.css
│       ├── layout.css
│       └── components.css
└── README.md
```

## Principles

- Feature-first organization instead of one giant file.
- Keep UI, API logic and business state separate.
- Use small modules with one responsibility.
- Create reusable utilities for numbers, dates and formatting.
- Prepare the app for future evolution (multi-page or component-driven rebuild).

## UX goals

- clearer navigation,
- lighter dashboard,
- faster scanning of leads,
- visible actions for critical tasks,
- more consistent spacing and states,
- better mobile support.

## Migration path

1. Keep the legacy dashboard working.
2. Move the app bootstrap to `src/app.js`.
3. Extract auth, routing and WhatsApp features into modules.
4. Replace global functions with state-driven UI updates.
5. Add design tokens and a cleaner component library.
6. Add real empty/error states and stronger feedback.
