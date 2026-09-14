import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const TABLE = [
  "| Project / workstream | Apparent achievements | Work and topics |",
  "| --- | --- | --- |",
  "| DayTrace | Shipped package | TypeScript, npm |",
].join("\n");

test("loads a dated DayTrace summary and preserves its workstream table verbatim", async () => {
  const review = await loadModule();
  const expectedPath =
    "🤖 AI/Activity/Daytrace/Summaries/2026/Q3/W38/2026-09-14.md";
  const file = new globalThis.__ReviewTFile(expectedPath);
  const app = {
    vault: {
      getAbstractFileByPath: (candidate) => candidate === expectedPath ? file : null,
      read: async () => `# DayTrace\n\n${TABLE}\n\n## Notes\nDone.`,
    },
  };

  assert.deepEqual(await review.loadDaytraceReviewSource(app, "2026-09-14"), {
    date: "2026-09-14",
    path: expectedPath,
    content: `# DayTrace\n\n${TABLE}\n\n## Notes\nDone.`,
    table: TABLE,
  });
});

test("renders exact tables in ascending date order", async () => {
  const review = await loadModule();
  const earlier = TABLE.replace("DayTrace", "Plugin");
  assert.equal(
    review.renderDaytraceReviewAppendix([
      { date: "2026-09-14", path: "later.md", content: TABLE, table: TABLE },
      { date: "2026-09-13", path: "earlier.md", content: earlier, table: earlier },
    ]),
    `## Activity\n\n### 2026-09-13\n\n${earlier}\n\n### 2026-09-14\n\n${TABLE}`
  );
});

test("missing and malformed summaries do not fabricate an Activity appendix", async () => {
  const review = await loadModule();
  const app = { vault: { getAbstractFileByPath: () => null, read: async () => "" } };

  assert.equal(await review.loadDaytraceReviewSource(app, "2026-09-14"), undefined);
  assert.equal(review.extractDaytraceWorkstreamTable("# no table"), undefined);
  assert.equal(
    review.extractDaytraceWorkstreamTable(
      "| Project / workstream | Apparent achievements | Work and topics |\nnot a divider"
    ),
    undefined
  );
  assert.equal(review.renderDaytraceReviewAppendix([]), "");
});

let modulePromise;
function loadModule() {
  modulePromise ??= build({
    entryPoints: [path.join(repoRoot, "src", "daytraceReview.ts")],
    bundle: true,
    format: "esm",
    platform: "node",
    write: false,
    plugins: [obsidianStubPlugin()],
  }).then(({ outputFiles }) =>
    import(`data:text/javascript;base64,${Buffer.from(outputFiles[0].text).toString("base64")}`)
  );
  return modulePromise;
}

function obsidianStubPlugin() {
  return {
    name: "obsidian-daytrace-review-stub",
    setup(buildApi) {
      buildApi.onResolve({ filter: /^obsidian$/ }, () => ({
        path: "obsidian",
        namespace: "review-stub",
      }));
      buildApi.onLoad({ filter: /.*/, namespace: "review-stub" }, () => ({
        contents: `
          export class TFile {
            constructor(path) { this.path = path; }
          }
          export class TFolder {}
          globalThis.__ReviewTFile = TFile;
        `,
        loader: "js",
      }));
    },
  };
}
