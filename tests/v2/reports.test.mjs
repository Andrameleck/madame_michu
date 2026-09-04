import assert from "node:assert/strict";
import test from "node:test";

import { createMemoryBackend, setStorageBackend } from "../../src/core/storage.js";
import { invalidateConfigCache, saveConfig } from "../../src/core/settings.js";
import { generateReport } from "../../src/features/reports/service.js";
import { setLogLevel } from "../../src/core/logger.js";

setLogLevel("silent");

test("decoupe un rapport long et fusionne tous les lots", async () => {
  setStorageBackend(createMemoryBackend());
  invalidateConfigCache();
  await saveConfig({
    llm: {
      profiles: [{
        id: "local",
        label: "Local",
        provider: "ollama",
        model: "test",
        baseUrl: "http://localhost:11434",
        enabled: true,
      }],
    },
    mail: { allFolders: true, maxMessagesPerRun: 200, maxBodyChars: 4000 },
  });

  const now = new Date("2026-09-03T12:00:00.000Z");
  const headers = Array.from({ length: 85 }, (_, index) => ({
    id: index + 1,
    subject: `Message ${index + 1}`,
    author: "Alice <alice@example.test>",
    recipients: [],
    date: new Date(now.getTime() - index * 60_000),
    folder: { name: "Inbox" },
    read: false,
  }));

  globalThis.messenger = {
    messages: {
      query: async () => ({ messages: headers }),
      get: async (id) => headers[id - 1],
      getFull: async () => ({ contentType: "text/plain", body: "x".repeat(4000) }),
    },
    accounts: { list: async () => [] },
  };

  const batchSizes = [];
  globalThis.fetch = async (_url, options) => {
    const request = JSON.parse(options.body);
    const ids = [...request.messages.at(-1).content.matchAll(/^### message (\d+)$/gm)]
      .map((match) => match[1]);
    batchSizes.push(ids.length);
    return {
      ok: true,
      status: 200,
      text: async () => JSON.stringify({
        model: "test",
        message: {
          content: JSON.stringify({
            overview: `Lot de ${ids.length} messages.`,
            entries: ids.map((id) => ({
              subject: `Message ${id}`,
              sender: "Alice",
              importance: "info",
              summary: `Resume ${id}`,
              messageIds: [id],
            })),
            events: [],
          }),
        },
      }),
    };
  };

  const report = await generateReport("month", { force: true, now });

  assert.deepEqual(batchSizes.sort((a, b) => b - a), [40, 40, 5]);
  assert.equal(report.messageCount, 85);
  assert.equal(report.entries.length, 85);
  assert.equal(report.entries[0].messageIds[0], "1");
});
