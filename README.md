# Thought Garden

Thought Garden is an AI-powered spatial thinking canvas. Instead of chatting with AI linearly, ideas grow spatially as connected thoughts. A question can branch into an insight, risk, challenge, or a new direction.

```text
Idea
├── Question
├── Insight
├── Risk
│   ├── Risk
│   └── Challenge
└── Direction
```

## Setup

Requires Node.js 20.9+ and pnpm.

```bash
pnpm install
cp .env.example .env.local
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000). Set `DEEPSEEK_API_KEY` in `.env.local` to use DeepSeek Flash:

```dotenv
DEEPSEEK_API_KEY=your_key
DEEPSEEK_BASE_URL=https://api.deepseek.com
DEEPSEEK_MODEL=deepseek-flash
```

All five actions use `deepseek-flash` without Thinking Mode. For offline demo responses, explicitly set `NEXT_PUBLIC_AI_MOCK=true`. The API key is read only by the server route.

## Use

- Double-click the canvas or press `N` to plant a thought; double-click a node to edit it.
- Select a thought and use its nearby toolbar to expand, dig deeper, challenge it, or find risks.
- Drag from a node handle to connect thoughts. Hold Shift and drag to select multiple nodes.
- Use `⌘/Ctrl + K` for canvas commands and `⌘/Ctrl + F` to find a thought.
- Undo and redo with `⌘/Ctrl + Z` and `⌘/Ctrl + Shift + Z`.
- The canvas saves to this browser automatically. Import validates the JSON before changing the canvas.

## Architecture

```text
Canvas → Selected Thought → Local Context → /api/ai/expand
       → Validated Structured Nodes → Fan-out Layout → Canvas
```

The client sends only the selected thought, its parent, siblings, and direct children. The server validates both the request and the model's JSON response. The app stores thoughts, edges, theme, and viewport in localStorage. There is no account or cloud sync in this MVP.

## Checks

```bash
pnpm lint
pnpm typecheck
pnpm build
```
