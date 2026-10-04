import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";

async function fixture() {
  const result = await build({ entryPoints: ["src/voiceMemoryVault.ts"], bundle: true, format: "esm", platform: "node", write: false,
    plugins: [{name:"obsidian",setup(api){
      api.onResolve({filter:/^obsidian$/},()=>({path:"obsidian",namespace:"stub"}));
      api.onLoad({filter:/.*/,namespace:"stub"},()=>({contents:`
        export class TFile { constructor(path) { this.path=path;this.name=path.split('/').at(-1); } }
        export class TFolder {}
        globalThis.__VoiceMemoryTFile=TFile;
      `}));
    }}]
  });
  const mod = await import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].contents).toString("base64")}`);
  const files = new Map();
  const seed = (path, text) => {const f=new globalThis.__VoiceMemoryTFile(path); f.text=text;files.set(path,f);return f;};
  const app={vault:{getAbstractFileByPath:path=>files.get(path),read:async f=>f.text,
    process:async(f,update)=>{f.text=update(f.text);},
    create:async (path,text)=>seed(path,text),modify:async(f,text)=>{f.text=text;},createFolder:async()=>{}}};
  return {mod,app,files,seed};
}

test("saved evidence creates bounded memory and later calls use it without reading raw logs", async()=>{
  const {mod,app,files,seed}=await fixture();
  seed("🧑 Me/Logs/2026-10-04.md","RAW LOG MUST NOT BE READ");
  const requests=[];
  const store=new mod.VoiceMemoryStore(app,async req=>{
    requests.push(req);
    return JSON.stringify({threads:[{date:"2026-10-04",text:"Plans to ship voice agent Tuesday."}],updates:[]});
  });
  assert.equal(files.has("🤖 AI/Voice Memory.md"),false);
  await store.remember("I plan to ship the voice agent Tuesday.","2026-10-04","2026-10-04");
  const context=await store.callContext({today:"2026-10-04",mode:"capture",settings:{customCommands:[]}});
  assert.match(context,/Plans to ship voice agent Tuesday/);
  assert.doesNotMatch(context,/RAW LOG/);
  assert.match(requests[0].userMessage,/I plan to ship the voice agent Tuesday/);
  assert.equal(requests.length,1,"loading context must never generate memory");
});

test("concurrent saves merge serially; malformed memory preserves the previous file and queue recovers", async()=>{
  const {mod,app,files}=await fixture();
  let calls=0;
  const store=new mod.VoiceMemoryStore(app,async req=>{
    calls++;
    if(calls===2)throw new Error("provider unavailable");
    if(calls===3)return "INVALID JSON";
    if(calls===4)assert.match(req.userMessage,/First saved fact/);
    return JSON.stringify({threads:[{date:"2026-10-04",text:calls===1?"First saved fact":"First saved fact plus fourth update"}],updates:[]});
  });
  await store.remember("first", "2026-10-04","2026-10-04");
  const firstFile=files.get("🤖 AI/Voice Memory.md").text;
  const outcomes=await Promise.allSettled([
    store.remember("second","2026-10-04","2026-10-04"),
    store.remember("third","2026-10-04","2026-10-04"),
  ]);
  assert.deepEqual(outcomes.map(x=>x.status),["rejected","rejected"]);
  assert.equal(files.get("🤖 AI/Voice Memory.md").text,firstFile);
  await store.remember("fourth","2026-10-04","2026-10-04");
  assert.match(files.get("🤖 AI/Voice Memory.md").text,/fourth update/);
});

test("a manual edit during generation is preserved instead of overwritten", async()=>{
  const {mod,app,seed,files}=await fixture();
  const path="🤖 AI/Voice Memory.md";
  seed(path,"# Voice Memory\n\n## Ongoing threads\n\n- 2026-10-04 — Initial thread");
  let started,respond;
  const generating=new Promise(resolve=>{started=resolve;});
  const store=new mod.VoiceMemoryStore(app,async()=>{
    started();
    return new Promise(resolve=>{respond=resolve;});
  });
  const saving=store.remember("New fact","2026-10-04","2026-10-04");
  await generating;
  const manual="# Voice Memory\n\n## Ongoing threads\n\n- 2026-10-04 — MANUALLY EDITED THREAD";
  files.get(path).text=manual;
  respond(JSON.stringify({threads:[{date:"2026-10-04",text:"Initial thread plus new fact"}],updates:[]}));
  await assert.rejects(saving,/changed/i);
  assert.equal(files.get(path).text,manual);
});

test("simultaneous successful saves retain both facts", async()=>{
  const {mod,app,files}=await fixture();
  let calls=0;
  const store=new mod.VoiceMemoryStore(app,async req=>{
    if(++calls===2)assert.match(req.userMessage,/First thread/);
    return JSON.stringify({threads:[{date:"2026-10-04",text:calls===1?"First thread":"First thread and second thread"}],updates:[]});
  });
  await Promise.all([store.remember("first","2026-10-04","2026-10-04"),store.remember("second","2026-10-04","2026-10-04")]);
  assert.match(files.get("🤖 AI/Voice Memory.md").text,/First thread and second thread/);
});

test("weekly context selects the exact previous ISO week and excludes older or current reviews",async()=>{
  const {mod,app,seed}=await fixture();
  seed("🤖 AI/Reviews/Weekly/2025-W52.md","Correct previous week");
  seed("🤖 AI/Reviews/Weekly/2026-W01.md","WRONG CURRENT WEEK");
  seed("🧑 Me/Reviews/Weekly/2025-W51.md","WRONG STALE REFLECTION");
  const store=new mod.VoiceMemoryStore(app,async()=>{throw new Error("no generation on calls");});
  const input={today:"2026-01-01",mode:"review",currentReview:"Selected September review",settings:{customCommands:[]}};
  const context=await store.callContext(input);
  assert.match(context,/Selected September review/);
  assert.match(context,/2025-12-22 to 2025-12-28/);
  assert.match(context,/Correct previous week/);
  assert.doesNotMatch(context,/WRONG/);
});

test("weekly review context strips source fingerprint metadata before excerpting",async()=>{
  const {mod,app,seed}=await fixture();
  const metadata = Array.from({length:14},(_,i)=>`  - path: Logs/2026/Q3/W39/source-${i}.md\n    size: 12345\n    sha1: ${"a".repeat(40)}`).join("\n");
  seed("🤖 AI/Reviews/Weekly/2026-W39.md", `---\nsb-command: review-last-week\nsb-inputs:\n${metadata}\n---\n\n# Weekly review\n\nActually shipped the voice agent.`);
  seed("🧑 Me/Reviews/Weekly/2026-W39.md", `---\nperiod-anchor: 2026-09-21\nai-summary: \"[[AI summary]]\"\n---\n\n# My Review\n\nI want to refine the questions.`);
  const store=new mod.VoiceMemoryStore(app,async()=>"unused");
  const context=await store.callContext({today:"2026-10-04",mode:"capture",settings:{customCommands:[]}});
  assert.match(context,/Actually shipped the voice agent/);
  assert.match(context,/I want to refine the questions/);
  assert.doesNotMatch(context,/sb-inputs|sha1|period-anchor|ai-summary/);
});

test("missing previous-week review omits weekly context; oversized selected review stays present and bounded",async()=>{
  const {mod,app,seed}=await fixture();
  seed("🧑 Me/Reviews/Weekly/2026-W39.md","Old review");
  const store=new mod.VoiceMemoryStore(app,async()=>"unused");
  const context=await store.callContext({today:"2026-10-12",mode:"review",currentReview:"SELECTED REVIEW "+"x".repeat(30000),settings:{customCommands:[]}});
  assert.ok(context.startsWith("## Current review\n\nSELECTED REVIEW"));
  assert.ok(context.length<=8000);
  assert.doesNotMatch(context,/Old review|Previous week's review/);
});

test("only agent speech cannot trigger a memory update",async()=>{
  const {mod,app,files}=await fixture();
  let calls=0;
  const store=new mod.VoiceMemoryStore(app,async()=>{calls++;return "unused";});
  await store.remember("<!-- second-brain-call:start -->\n**Agent said:**\n> You shipped it.\n<!-- second-brain-call:end -->","2026-10-04","2026-10-04");
  assert.equal(calls,0);
  assert.equal(files.has("🤖 AI/Voice Memory.md"),false);
});

test("review context retains both ongoing threads and the newest updates within its small memory budget",async()=>{
  const {mod,app,seed}=await fixture();
  seed("🤖 AI/Voice Memory.md", "# Voice Memory\n\n## Ongoing threads\n\n"+
    Array.from({length:10},(_,i)=>`- 2026-10-04 — Thread ${i}: ${"x".repeat(230)}`).join("\n")+
    "\n\n## Recent updates\n\n- 2026-10-04 — NEWEST UPDATE: tested the microphone.");
  const store=new mod.VoiceMemoryStore(app,async()=>"unused");
  const context=await store.callContext({today:"2026-10-04",mode:"review",currentReview:"SELECTED REVIEW "+"r".repeat(7000),settings:{customCommands:[]}});
  assert.match(context,/Thread 0/);
  assert.match(context,/NEWEST UPDATE/);
  assert.ok(context.length<=8000);
});
