# pixelclaw

A pixel art editor built for an AI agent to drive by command. The agent draws with exact
commands, sees exact feedback and checks its own work; people watch and edit in a live browser
view. All art is indexed colour, and every document is a deterministic tape of commands.

```sh
npm install -g pixelclaw            # Node.js 22.18 or later
pixelclaw new ~/art/my-game.pclaw --palette my-palette.gpl
claude mcp add pixelclaw -- pixelclaw serve --project ~/art/my-game.pclaw
pixelclaw skill install             # the Claude Code skill
pixelclaw --help
```

The optional worker (a headless Claude Code session that works requests from the dashboard) is
off by default and spends money on your Anthropic account when turned on. The optional OpenAI
underlay provider reads `OPENAI_API_KEY` from the environment and never writes it anywhere.

Documentation, walkthroughs and source: [github.com/retrodigio/pixelclaw](https://github.com/retrodigio/pixelclaw).
Licence: MIT. The bundled third-party licences are in `dist/THIRD_PARTY_LICENSES.txt`.
