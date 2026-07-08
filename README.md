# SalesmanAI Monorepo

Ei repository-te ekhon root level-e tin ta alada deployable source ache:

- `root app`: React + Vite dashboard frontend
- `backend/`: SalesmanAI backend API, webhook, Messenger/WhatsApp logic
- `AIStudioToAPI/`: full AI Studio to API project source

Erokom kore rakhle ek jaigai code thakbe, kintu VPS-e chaile alada port, alada process, ar alada deploy target diye run kora jabe.

## Project Structure

```text
salesmanai-salesmanai-v2/
|-- backend/
|-- AIStudioToAPI/
|-- src/
|-- public/
|-- package.json
`-- README.md
```

## Local Setup

Requirement:

- Node.js 22+
- npm

Initial install:

```sh
npm run install:all
```

## Run Commands

Frontend:

```sh
npm run dev:frontend
```

Backend:

```sh
npm run dev:backend
```

AI Studio proxy:

```sh
npm run dev:aistudio
```

Production mode:

```sh
npm run start:backend
npm run start:aistudio
```

AI Studio auth setup:

```sh
npm run setup:aistudio-auth
```

## AIStudioToAPI Integration

`AIStudioToAPI` ke root-level folder hisebe full source shoho add kora hoyeche:

- `AIStudioToAPI/`

Eitar advantage:

- backend-er moto alada full project hisebe thakbe
- VPS-e alada bhabe deploy kora jabe
- source mix hoye jabe na
- future-te upstream source compare/update kora shohoj hobe

Default proxy env example:

- `AIStudioToAPI/.env.example`

Typical local port layout:

- Frontend: `5173`
- Backend: backend app-er nijer port
- AI Studio proxy: `7860`

## Recommended VPS Deployment

Same repo theke alada deploy:

- `app.example.com` -> root frontend
- `api.example.com` -> `backend/`
- `gemini.example.com` -> `AIStudioToAPI/`

Recommended:

- frontend static build hisebe deploy korun
- backend alada Node process hisebe run korun
- `AIStudioToAPI` alada Node process hisebe run korun
- Nginx/Coolify/PM2 diye route/manage korun

## Build Commands

Frontend build:

```sh
npm run build
```

AI Studio UI build:

```sh
npm run build:aistudio
```

## Notes

- `AIStudioToAPI/.env` git ignore kora ache
- `AIStudioToAPI/configs/auth/` git ignore kora ache
- `AIStudioToAPI/data/` git ignore kora ache
- AI Studio proxy-r nijer docs, env example, ar Dockerfile intact rakha hoyeche jate alada deploy kora jai
