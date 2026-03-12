const net = require('net');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

function buildFrame(p){const l=p.length,m=crypto.randomBytes(4);let h;if(l<126){h=Buffer.alloc(6);h[0]=0x81;h[1]=0x80|l;m.copy(h,2);}else{h=Buffer.alloc(8);h[0]=0x81;h[1]=0x80|126;h.writeUInt16BE(l,2);m.copy(h,4);}const r=Buffer.alloc(l);for(let i=0;i<l;i++)r[i]=p[i]^m[i%4];return Buffer.concat([h,r]);}

const PAGE_ID = 'EDB963F77F0C5004F80EC60557E84A0E';
const s = net.createConnection({host:'127.0.0.1',port:9222});
const key = crypto.randomBytes(16).toString('base64');
let buf=Buffer.alloc(0),done=false,msgId=1;
const pd=new Map();

function send(m,p){return new Promise(function(res,rej){const i=msgId++;pd.set(i,{res:res,rej:rej});setTimeout(function(){if(pd.has(i)){pd.delete(i);rej(new Error('Timeout:'+m));}},15000);s.write(buildFrame(Buffer.from(JSON.stringify({id:i,method:m,params:p||{}}))));});}
function evaluate(expr){return send('Runtime.evaluate',{expression:expr,returnByValue:true,awaitPromise:true}).then(function(r){return r&&r.result&&r.result.value;});}
function sleep(ms){return new Promise(function(r){setTimeout(r,ms);});}
function pass(l){console.log('  PASS:',l);}
function fail(l,d){console.log('  FAIL:',l,d?'-- '+d:'');}
function info(l,v){console.log('  INFO:',l+':',v);}

async function runMissionTest() {
  await send('Runtime.enable');

  console.log('\n=== MISSION LAUNCH FLOW TEST ===');

  // Navigate to mission page
  await evaluate('window.location.hash = "#/mission"');
  await sleep(1500);

  // If mission dashboard is showing (from previous run), click New Mission first
  const newMissionExists = await evaluate('[...document.querySelectorAll("button")].some(function(b){return b.textContent.includes("New Mission");})');
  if(newMissionExists) {
    console.log('  INFO: Found existing mission dashboard — clicking New Mission to reset');
    await evaluate('[...document.querySelectorAll("button")].find(function(b){return b.textContent.includes("New Mission");}).click()');
    await sleep(1000);
  }

  // Check initial state - launcher visible
  const launcherVisible = await evaluate('!!document.querySelector("textarea")');
  if(launcherVisible) pass('MissionLauncher visible on /mission'); else fail('MissionLauncher not visible');

  // Fill in the form
  console.log('\n--- Filling launch form ---');
  // Textarea
  await evaluate('var ta=document.querySelector("textarea");var s=Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,"value").set;s.call(ta,"Write a hello world function in a file called hello.js");ta.dispatchEvent(new Event("input",{bubbles:true}));');
  await sleep(300);

  const taVal = await evaluate('document.querySelector("textarea").value');
  info('textarea value', taVal && taVal.slice(0,50));
  if(taVal && taVal.length > 5) pass('Textarea filled'); else fail('Textarea fill failed');

  // Path input
  await evaluate('var inp=[...document.querySelectorAll("input")].find(function(i){return i.type==="text"&&(i.placeholder||"").includes("D:");});if(inp){var s=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value").set;s.call(inp,"D:/multiAIAgentsClaude/test-calculator");inp.dispatchEvent(new Event("input",{bubbles:true}));}');
  await sleep(300);

  const pathVal = await evaluate('[...document.querySelectorAll("input")].find(function(i){return i.type==="text"&&(i.value||"").includes("multiAI");}) && [...document.querySelectorAll("input")].find(function(i){return i.type==="text"&&(i.value||"").includes("multiAI");}).value');
  info('path value', pathVal);
  if(pathVal && pathVal.includes('multiAI')) pass('Path filled'); else fail('Path fill failed');

  // Check launch button enabled
  const launchBtnEnabled = await evaluate('[...document.querySelectorAll("button")].find(function(b){return b.textContent.includes("Launch Mission");})'
    + '&& ![...document.querySelectorAll("button")].find(function(b){return b.textContent.includes("Launch Mission");}).disabled');
  if(launchBtnEnabled) pass('Launch button enabled'); else fail('Launch button still disabled');

  // Click Launch
  console.log('\n--- Clicking Launch Mission ---');
  await evaluate('[...document.querySelectorAll("button")].find(function(b){return b.textContent.includes("Launch Mission");}) && [...document.querySelectorAll("button")].find(function(b){return b.textContent.includes("Launch Mission");}).click()');

  // Wait for mission to start launching (up to 10s)
  let launched = false;
  for(let i = 0; i < 20; i++) {
    await sleep(500);
    const dashboardVisible = await evaluate('!!document.querySelector("[data-testid=mission-dashboard]") || document.body.innerHTML.includes("Launching") || document.body.innerHTML.includes("Planning") || document.body.innerHTML.includes("Running") || document.body.innerHTML.includes("Stop") && !document.body.innerHTML.includes("Launch Mission")');
    if(dashboardVisible) {
      launched = true;
      break;
    }
  }

  if(launched) pass('Mission dashboard appeared after launch'); else fail('Mission did not start (timeout 10s)');

  // Check current view (simplified, no large DOM serialization)
  const hasStop = await evaluate('document.body.innerHTML.includes("Stop")');
  const hasStatus = await evaluate('[...document.querySelectorAll("span")].some(function(e){return ["Running","Launching","Planning","Completed"].includes(e.textContent.trim());})');
  info('has Stop button', hasStop);
  info('has status text', hasStatus);

  // Check status badge
  const statusText = await evaluate('[...document.querySelectorAll("span,div")].find(function(e){return ["Running","Launching","Planning","Completed"].some(function(s){return e.textContent.trim()===s;})}) && [...document.querySelectorAll("span,div")].find(function(e){return ["Running","Launching","Planning","Completed"].some(function(s){return e.textContent.trim()===s;})}).textContent.trim()');
  info('status badge', statusText);
  if(statusText) pass('Status badge shows: ' + statusText); else fail('No status badge found');

  // Check for Stop button (simple boolean, no element ref)
  const stopBtnVisible = await evaluate('document.body.innerHTML.includes("Stop")');
  if(stopBtnVisible) pass('Stop button visible'); else fail('Stop button not visible');

  // Wait a bit for mission to progress
  console.log('\n--- Waiting for mission to progress (5s) ---');
  await sleep(5000);

  // Check logs appeared
  const logEntries = await evaluate('document.querySelectorAll("[class*=log],[class*=Log],[class*=activity]").length');
  info('log entries count', logEntries);

  // Check agents appeared
  const agentCards = await evaluate('document.querySelectorAll("[class*=agent],[class*=Agent]").length');
  info('agent cards count', agentCards);

  // TEST: Click Stop
  console.log('\n--- Clicking Stop ---');
  const currentStatus = await evaluate('[...document.querySelectorAll("button")].find(function(b){return b.textContent.includes("Stop");}) && "stop-visible"');
  if(!currentStatus) {
    info('Stop button', 'not visible — mission may already be done');
  } else {
    await evaluate('[...document.querySelectorAll("button")].find(function(b){return b.textContent.includes("Stop");}).click()');
    await sleep(2000);
    const afterStop = await evaluate('"stopped:" + (document.body.innerHTML.includes("Stopped") || document.body.innerHTML.includes("stopped") || document.body.innerHTML.includes("New Mission"))');
    info('after stop', afterStop);
    if(afterStop && afterStop !== 'stopped:false') pass('Mission stopped'); else fail('Stop may have failed');
  }

  // Wait for completion
  await sleep(3000);

  // Check New Mission button (boolean check only)
  const newMissionBtnVisible = await evaluate('document.body.innerHTML.includes("New Mission")');
  if(newMissionBtnVisible) pass('New Mission button visible after stop/complete'); else fail('New Mission button not visible');

  // Check history file was saved
  const userprofile = process.env.USERPROFILE || 'C:/Users/pnguyentrong.DESKTOP-S1NJLTS';
  const historyPath = path.join(userprofile, '.claude', 'agent-teams-history.json');
  if(fs.existsSync(historyPath)) {
    const history = JSON.parse(fs.readFileSync(historyPath, 'utf8'));
    info('history file entries', history.length);
    if(history.length > 0) pass('History file exists and has entries'); else fail('History file empty');
  } else {
    fail('History file not found at ' + historyPath);
  }

  // Check snapshots dir
  const snapshotsDir = path.join(userprofile, '.claude', 'agent-teams-snapshots');
  if(fs.existsSync(snapshotsDir)) {
    const files = fs.readdirSync(snapshotsDir);
    info('snapshot files count', files.length);
    if(files.length > 0) pass('Mission snapshots saved to disk: ' + files.join(', '));
    else fail('No snapshot files in ' + snapshotsDir);
  } else {
    fail('Snapshots dir not found: ' + snapshotsDir);
  }

  // Click New Mission
  console.log('\n--- Click New Mission ---');
  const newMissionBtnVisible2 = await evaluate('document.body.innerHTML.includes("New Mission")');
  if(newMissionBtnVisible2) {
    await evaluate('[...document.querySelectorAll("button")].find(function(b){return b.textContent.includes("New Mission");}).click()');
    await sleep(1000);
    const backToLauncher = await evaluate('!!document.querySelector("textarea")');
    if(backToLauncher) pass('Back to launcher after New Mission'); else fail('Did not return to launcher');
  }

  // Check history panel appears in launcher view
  const historyPanel = await evaluate('document.body.innerHTML.includes("Mission History")');
  info('history panel visible', historyPanel);
  if(historyPanel) pass('MissionHistoryPanel visible in launcher view'); else fail('MissionHistoryPanel not showing');

  console.log('\n=== MISSION FLOW TEST COMPLETE ===');
  s.destroy();
  process.exit(0);
}

s.on('connect',function(){s.write('GET /devtools/page/'+PAGE_ID+' HTTP/1.1\r\nHost: 127.0.0.1:9222\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: '+key+'\r\nSec-WebSocket-Version: 13\r\n\r\n');});
s.on('data',function(chunk){buf=Buffer.concat([buf,chunk]);if(!done){var str=buf.toString('ascii');if(str.includes('\r\n\r\n')&&str.includes('101')){done=true;buf=buf.slice(buf.indexOf('\r\n\r\n')+4);runMissionTest().catch(function(e){console.error('FATAL:',e.message,e.stack);process.exit(1);});}}while(buf.length>=2){var pl=buf[1]&0x7f,off=2;if(pl===126){if(buf.length<4)break;pl=buf.readUInt16BE(2);off=4;}if(buf.length<off+pl)break;var pay=buf.slice(off,off+pl);buf=buf.slice(off+pl);try{var msg=JSON.parse(pay.toString());if(msg.id&&pd.has(msg.id)){var cb=pd.get(msg.id);pd.delete(msg.id);if(msg.error)cb.rej(new Error(msg.error.message));else cb.res(msg.result);}}catch(_){}}});
s.on('error',function(e){console.error('socket:',e.message);});
