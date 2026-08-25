# Madame Michu

Madame Michu is a Thunderbird mail concierge powered by the LLM provider of your choice. She turns incoming mail into useful daily, weekly and monthly briefings, searches your local mailbox and calendars through natural conversation, and keeps the experience lively with the personality of a sharp-tongued, thoroughly unimpressed secretary.

The extension is designed for Thunderbird 128 and later. Its interface is available in French and English.

> Madame Michu can work with a fully local Ollama installation. Remote and internal company LLM services are also supported, but may receive message excerpts when a feature requires them. Review the [privacy section](#privacy-and-data-handling) before enabling a remote provider.

## What it does

- Builds separate **daily**, **weekly** and **monthly** mail reports.
- Sorts noteworthy messages into **Urgent**, **Important**, **Info** and **Other** categories.
- Highlights the sender, expected action and practical need for each report item.
- Keeps links to the original Thunderbird messages used as sources.
- Detects appointments in messages and can add them to a Thunderbird calendar while avoiding duplicates.
- Answers natural-language questions using locally indexed mail and active calendars.
- Maintains conversational context so follow-up questions do not need to repeat the subject.
- Falls back to local lexical search when no embedding model is configured or available.
- Displays the next calendar appointment, a configurable RSS/Atom news ticker and local weather in a compact information bar.
- Supports several ordered LLM profiles and automatically tries the next active profile when one fails.

Madame Michu does not perform general web searches. Ordinary conversation is handled by the configured LLM, while factual mailbox answers are grounded in locally indexed messages, saved reports and Thunderbird calendars.

## Supported LLM providers

| Provider | Chat | Embeddings | Notes |
| --- | :---: | :---: | --- |
| Ollama | Yes | Yes | Recommended for an entirely local setup. |
| OpenAI-compatible API | Yes | Yes | Works with OpenAI, Argo and compatible internal services. |
| Anthropic Messages API | Yes | No | Requires an Anthropic API key; a consumer Claude subscription is not an API account. |
| ChatGPT Plus/Pro via Codex OAuth | Yes | No | Experimental connector for eligible ChatGPT subscriptions. |

Multiple profiles can be enabled and reordered. Madame Michu uses the preferred profile first, then tries the remaining active profiles in order if the request fails.

## Requirements

- Thunderbird **128.0 or later**. The current manifest supports versions up to 154.x.
- At least one supported LLM provider.
- A writable Thunderbird calendar if automatic appointment creation is required.
- An embedding model only if semantic mail search is desired. Lexical search remains available without one.

For a local Ollama setup:

```bash
ollama serve
ollama pull llama3.1
ollama pull nomic-embed-text
```

The first model handles reports and conversation. The second is optional and enables semantic mail search.

## Install the packaged extension

1. Download the latest `madame-michu-<version>.xpi` file from the project releases or the [`dist`](dist/) directory.
2. Open Thunderbird.
3. Open **Tools → Add-ons and Themes**, or press `Ctrl+Shift+A`.
4. Select the gear menu in the Add-ons Manager.
5. Choose **Install Add-on From File…**.
6. Select the downloaded XPI and confirm the installation.
7. Accept Thunderbird's full-access warning. It is required because the extension includes a small Experiment API bridge for Lightning calendar integration.
8. Open Madame Michu from the Thunderbird toolbar, then use the cog button to configure an LLM profile.

Development builds may be unsigned. If Thunderbird refuses a packaged development build, load the source temporarily using the procedure below.

## Load from source for development

1. Clone or download this repository.
2. In Thunderbird, open **Tools → Add-ons and Themes**.
3. Open the gear menu and select **Debug Add-ons**.
4. Select **Load Temporary Add-on…**.
5. Choose the repository's [`manifest.json`](manifest.json).
6. Use **Reload** on the debugging page after changing source files.

A temporary add-on is removed when Thunderbird restarts. If `manifest.json` or its `background.scripts` list changes, remove and load the temporary add-on again rather than relying only on **Reload**.

## First-time configuration

Open Madame Michu's settings from Thunderbird's Add-ons Manager or with the cog button in the main interface.

### 1. Configure an LLM profile

1. Select an existing profile or choose **Add**.
2. Choose the provider type.
3. Enter its base URL, exact chat model name and API key when required.
4. Optionally enter an embedding model for Ollama or an OpenAI-compatible provider.
5. Use **Load available models** or enter the model name manually.
6. Select **Test connection**.
7. Keep the profile active and choose it as the preferred profile.

Remote providers must use HTTPS. Plain HTTP is accepted only for loopback addresses such as `localhost` and `127.0.0.1`.

For **ChatGPT Plus/Pro via Codex OAuth**, select **Sign in with ChatGPT**, complete authentication in the OpenAI tab, then choose a model. If the final browser page cannot reach localhost, copy its complete URL into the manual callback field in the settings page. This connector is experimental because the subscription backend may evolve independently of the public API.

### 2. Choose mail and calendar sources

- Keep **All mailboxes connected to Thunderbird** enabled, or select specific source accounts.
- Choose which folders are scanned for reports and indexed for chat.
- Configure the report schedule and optional silent refresh interval.
- Select the confidence threshold and destination calendar for detected appointments.

Drafts, Sent, Trash, Junk, Templates and Outbox folders are ignored automatically when all folders are selected.

### 3. Review privacy consent

If any active provider is remote, read the disclosure and explicitly allow data to be sent to the configured provider. This permission is requested while saving the settings and can be withdrawn later.

## Using Madame Michu

Click the toolbar button to open the main interface.

- Use **Day**, **Week** and **Month** to switch between independently stored reports.
- Use **Regenerate report** to force a new report for the selected period.
- Ask natural questions such as “What is new?”, “What happened in my mail yesterday?”, “When is my next meeting?” or “What did Alice say about the project?”.
- Continue with normal follow-up questions: Madame Michu keeps the conversation context and remembers what both sides have just said.
- Expand **Sources** below an answer to inspect and open the messages actually used.

On first launch, all three missing report periods are generated. Later automatic checks refresh the daily report only when relevant mail has changed, which avoids unnecessary LLM calls.

## Privacy and data handling

Mail, calendars, reports, settings and the search index are handled inside the Thunderbird profile. Madame Michu has no project-operated backend and includes no telemetry.

Data transmission depends on the selected provider:

- With local Ollama, prompts and message excerpts stay on the computer.
- With a remote or internal provider, questions, prompts, message subjects, senders, dates, excerpts and embedding text may be transmitted when needed and after consent.
- API keys and OAuth tokens are stored in the local Thunderbird profile. This storage is not an encrypted secrets vault.
- Weather requests send only the configured city or its coordinates to Open-Meteo. They never include mail or calendar content.
- The news ticker fetches only the configured RSS or Atom feed and filters selected topics locally.

The extension cannot verify a third-party provider's retention, logging or reuse practices. Prefer a local model or an internal service whose guarantees are known. See the full [privacy policy](PRIVACY.md).

## Build and test

The project uses plain JavaScript, HTML and CSS. It has no runtime npm dependencies, bundler, transpiler or minifier.

```bash
npm run check
npm test
npm run package
```

The packaged XPI is written to `dist/`. To also create the reviewer source archive:

```bash
npm run package:source
```

Detailed reproducible-build instructions are available in [`SOURCE_BUILD.md`](SOURCE_BUILD.md).

## Project documentation

- [`ARCHITECTURE.md`](ARCHITECTURE.md) — runtime boundaries, data flow and technical invariants.
- [`CONTRIBUTING.md`](CONTRIBUTING.md) — development conventions and contribution workflow.
- [`PRIVACY.md`](PRIVACY.md) — complete privacy and data-transmission policy.
- [`SOURCE_BUILD.md`](SOURCE_BUILD.md) — reproducible build instructions for reviewers.
- [`RELEASE.md`](RELEASE.md) — release preparation notes.

## Known limitations

- Calendar integration relies on a privileged Thunderbird Experiment API and should be retested for each new major Thunderbird release.
- Semantic search quality depends on the selected embedding model. Lexical search is used when embeddings are unavailable.
- LLM output quality and latency vary by provider and model.
- The ChatGPT/Codex subscription connector is experimental and does not provide embeddings.
- The extension searches mail and calendars but deliberately does not browse the general web.

## License

Madame Michu is free software released under the [GNU Affero General Public License v3.0](LICENSE).
