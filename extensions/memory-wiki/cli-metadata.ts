import { definePluginEntry } from "kaijibot/plugin-sdk/plugin-entry";

export default definePluginEntry({
  id: "memory-wiki",
  name: "Memory Wiki",
  description: "Persistent wiki compiler and Obsidian-friendly knowledge vault for KaijiBot.",
  register(api) {
    api.registerCli(
      async ({ program }) => {
        const { registerWikiCli } = await import("./src/cli.js");
        registerWikiCli(program);
      },
      {
        descriptors: [
          {
            name: "wiki",
            description: "Inspect and initialize the memory wiki vault",
            hasSubcommands: true,
          },
        ],
      },
    );
  },
});
