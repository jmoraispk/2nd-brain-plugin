import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";

async function fixture() {
  const events=new Map();
  const emit=(name,value)=>events.get(name)?.(value);
  const sdk={on:(name,callback)=>events.set(name,callback),start:async()=>{emit("call-start");return {id:"test-call"};},
    stop:async()=>{emit("call-end");},setMuted:()=>{}};
  globalThis.__VoiceTestSdk=sdk;
  const result=await build({entryPoints:["src/voiceInterviewModal.ts"],bundle:true,format:"esm",platform:"node",write:false,
    plugins:[{name:"voice-host",setup(api){
      api.onResolve({filter:/^obsidian$/},()=>({path:"obsidian",namespace:"host"}));
      api.onLoad({filter:/.*/,namespace:"host"},()=>({contents:`
        export class App {}
        export async function requestUrl(){throw new Error("unexpected network");}
        export class TFile {} export class TFolder {}
        export class Notice {constructor(text){globalThis.__voiceNotices.push(text);}}
        export class Modal {
          constructor(app){this.app=app;this.modalEl={addClass(){}};this.contentEl={empty(){}};}
          close(){this.onClose();globalThis.__voiceClosed();}
        }
      `}));
      api.onResolve({filter:/^@vapi-ai\/web$/},()=>({path:"sdk",namespace:"sdk"}));
      api.onLoad({filter:/.*/,namespace:"sdk"},()=>({contents:"export default class Vapi { constructor(){return globalThis.__VoiceTestSdk;} }"}));
    }}]});
  const {VoiceCallModal}=await import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].contents).toString("base64")}`);
  const drafts=[];
  const errors=[];
  const plugin={settings:{voiceUserName:"João",voiceTalkativeness:5},errorLog:{push:(scope,error)=>errors.push({scope,error})}};
  globalThis.__voiceNotices=[];
  let closedResolve;
  const closed=new Promise(resolve=>{closedResolve=resolve;});
  globalThis.__voiceClosed=closedResolve;
  const modal=new VoiceCallModal({},plugin,{mode:"capture",context:"Compact memory",existingDraft:"Typed opening",targetDate:"2026-09-30",onDraft:draft=>drafts.push(draft)});
  modal.requestMicrophonePermission=async()=>{};
  await modal.startCall("public-test-key","test-assistant");
  return {modal,emit,drafts,errors,closed,notices:globalThis.__voiceNotices};
}

test("hang-up returns an unfinished user utterance rather than losing the call",async()=>{
  const {modal,emit,drafts,closed}=await fixture();
  emit("message",{type:"transcript",role:"user",transcriptType:"partial",transcript:"I finished debugging today."});
  await modal.endCall();
  await closed;
  assert.equal(drafts.length,1);
  assert.match(drafts[0],/> I finished debugging today\./);
  assert.match(drafts[0],/still being transcribed/i);
});

test("a queued final turn after automatic call-end is included once",async()=>{
  const {emit,drafts,closed}=await fixture();
  emit("message",{type:"transcript",role:"user",transcriptType:"final",transcript:"First thought."});
  emit("call-end");
  emit("message",{type:"transcript",role:"user",transcriptType:"final",transcript:"Last thought."});
  await closed;
  assert.equal(drafts.length,1);
  assert.match(drafts[0],/> First thought\./);
  assert.match(drafts[0],/> Last thought\./);
});

test("final transcription replaces a partial during hang-up, and cancellation preserves the draft",async()=>{
  const {modal,emit,drafts,closed}=await fixture();
  emit("message",{type:"transcript",role:"user",transcriptType:"partial",transcript:"I finished"});
  const ending=modal.endCall();
  emit("message",{type:"transcript",role:"user",transcriptType:"final",transcript:"I finished debugging."});
  await ending;
  await closed;
  assert.equal(drafts.length,1);
  assert.match(drafts[0],/> I finished debugging\./);
  assert.doesNotMatch(drafts[0],/still being transcribed/);
  const second=await fixture();
  second.emit("message",{type:"transcript",role:"user",transcriptType:"final",transcript:"Discarded."});
  second.modal.close();
  second.emit("call-end");
  assert.deepEqual(second.drafts,[]);
});

test("cancelling during the transcript drain never replaces the draft",async()=>{
  const {modal,emit,drafts}=await fixture();
  emit("message",{type:"transcript",role:"user",transcriptType:"final",transcript:"Keep my existing draft."});
  const ending=modal.endCall();
  modal.close();
  await ending;
  assert.deepEqual(drafts,[]);
});
