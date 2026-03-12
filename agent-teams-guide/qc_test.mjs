import net from 'net';
import crypto from 'crypto';

const CDP_HOST = '127.0.0.1';
const CDP_PORT = 9222;
const PAGE_ID = 'EDB963F77F0C5004F80EC60557E84A0E';

function buildFrame(payload) {
  const len = payload.length;
  const mask = crypto.randomBytes(4);
  let header;
  if (len < 126) {
    header = Buffer.alloc(6);
    header[0] = 0x81;
    header[1] = 0x80 | len;
    mask.copy(header, 2);
  } else {
    header = Buffer.alloc(8);
    header[0] = 0x81;
    header[1] = 0x80 | 126;
    header.writeUInt16BE(len, 2);
    mask.copy(header, 4);
  }
  const masked = Buffer.alloc(len);
  for (let i = 0; i < len; i++) masked[i] = payload[i] ^ mask[i % 4];
  return Buffer.concat([header, masked]);
}

function wsConnect(host, port, path) {
  return new Promise((resolve, reject) => {
    const key = crypto.randomBytes(16).toString('base64');
    const socket = net.createConnection({ host, port });
    let buf = Buffer.alloc(0);
    let handshakeDone = false;
    const listeners = new Map();
    let msgId = 1;

    socket.on('connect', () => {
      const req = 'GET ' + path + ' HTTP/1.1\r\nHost: ' + host + ':' + port + '\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: ' + key + '\r\nSec-WebSocket-Version: 13\r\n\r\n';
      socket.write(req);
    });

    socket.on('data', (chunk) => {
      buf = Buffer.concat([buf, chunk]);
      if (!handshakeDone) {
        const str = buf.toString('ascii');
        if (str.includes('\r\n\r\n')) {
          if (str.includes('101')) {
            handshakeDone = true;
            const idx = buf.indexOf('\r\n\r\n');
            buf = buf.slice(idx + 4);
            resolve(ws);
          } else {
            reject(new Error('WS upgrade failed: ' + str.slice(0, 200)));
            socket.destroy();
          }
        }
        return;
      }
      while (buf.length >= 2) {
        const opcode = buf[0] & 0x0f;
        let payloadLen = buf[1] & 0x7f;
        let offset = 2;
        if (payloadLen === 126) {
          if (buf.length < 4) break;
          payloadLen = buf.readUInt16BE(2);
          offset = 4;
        } else if (payloadLen === 127) {
          if (buf.length < 10) break;
          payloadLen = Number(buf.readBigUInt64BE(2));
          offset = 10;
        }
        if (buf.length < offset + payloadLen) break;
        const payload = buf.slice(offset, offset + payloadLen);
        buf = buf.slice(offset + payloadLen);
        if (opcode === 1) {
          try {
            const msg = JSON.parse(payload.toString());
            if (msg.id && listeners.has(msg.id)) {
              const cb = listeners.get(msg.id);
              listeners.delete(msg.id);
              if (msg.error) cb.reject(new Error(msg.error.message));
              else cb.resolve(msg.result);
            }
          } catch (_) {}
        }
      }
    });

    socket.on('error', reject);

    const ws = {
      send(method, params) {
        params = params || {};
        return new Promise((res, rej) => {
          const id = msgId++;
          listeners.set(id, { resolve: res, reject: rej });
          setTimeout(() => {
            if (listeners.has(id)) {
              listeners.delete(id);
              rej(new Error('Timeout: ' + method));
            }
          }, 8000);
          const payload = Buffer.from(JSON.stringify({ id, method, params }));
          socket.write(buildFrame(payload));
        });
      },
      close() { socket.destroy(); }
    };
  });
}

async function evaluate(ws, expr) {
  const r = await ws.send('Runtime.evaluate', {
    expression: expr,
    returnByValue: true,
    awaitPromise: true,
  });
  return r && r.result && r.result.value;
}

function pass(label) { console.log('  PASS:', label); }
function fail(label, detail) { console.log('  FAIL:', label, detail ? '-- ' + detail : ''); }
function info(label, val) { console.log('  INFO:', label + ':', val); }

async function main() {
  console.log('=== QC Test: agent-teams-guide Tauri WebView ===');

  const ws = await wsConnect(CDP_HOST, CDP_PORT, '/devtools/page/' + PAGE_ID);
  await ws.send('Runtime.enable');

  // Track errors
  await ws.send('Runtime.evaluate', {
    expression: 'window.__qcErrors = []; window.addEventListener("unhandledrejection", function(e) { window.__qcErrors.push("unhandled: " + e.reason); }); true',
    returnByValue: true,
  });

  // TEST 1: Tauri IPC
  console.log('\n--- TEST 1: Tauri IPC ---');
  const tauriExists = await evaluate(ws, '!!(window.__TAURI_INTERNALS__)');
  if (tauriExists) pass('__TAURI_INTERNALS__ present'); else fail('Tauri IPC missing');

  const sysInfo = await evaluate(ws, '(async function() { try { return await window.__TAURI_INTERNALS__.invoke("get_system_info"); } catch(e) { return { error: e.message }; } })()');
  if (sysInfo && sysInfo.error) {
    fail('invoke(get_system_info)', sysInfo.error);
  } else {
    pass('invoke(get_system_info) works');
    info('claude_available', sysInfo && sysInfo.claude_available);
    info('agent_teams_enabled', sysInfo && sysInfo.agent_teams_enabled);
    info('settings_path', sysInfo && sysInfo.settings_path);
  }

  // TEST 2: Sidebar
  console.log('\n--- TEST 2: Sidebar ---');
  const sidebarFound = await evaluate(ws, '!!document.querySelector("aside")');
  if (sidebarFound) pass('Sidebar renders'); else fail('Sidebar missing');

  const navText = await evaluate(ws, 'JSON.stringify([...document.querySelectorAll("aside button span")].map(function(e){return e.textContent.trim();}).filter(function(t){return t.length>2&&t.length<30;}).slice(0,8))');
  info('Nav items', navText);

  // TEST 3: Mission Control
  console.log('\n--- TEST 3: Mission Control ---');
  await evaluate(ws, 'window.location.hash = "#/mission"');
  await new Promise(function(r) { setTimeout(r, 1500); });

  const h1 = await evaluate(ws, 'document.querySelector("h1") && document.querySelector("h1").textContent');
  if (h1 && h1.includes('Mission')) pass('h1 = "' + h1 + '"'); else fail('h1 wrong', h1);

  const hasTextarea = await evaluate(ws, '!!document.querySelector("textarea")');
  if (hasTextarea) pass('Textarea found'); else fail('No textarea');

  const placeholder = await evaluate(ws, 'document.querySelector("textarea") && document.querySelector("textarea").placeholder');
  if (placeholder && placeholder.length > 10) pass('Placeholder set'); else fail('No placeholder');
  info('placeholder', placeholder && placeholder.slice(0, 60));

  const launchDisabled = await evaluate(ws, '[...document.querySelectorAll("button")].find(function(b){return b.textContent.includes("Launch")}) && [...document.querySelectorAll("button")].find(function(b){return b.textContent.includes("Launch")}).disabled');
  if (launchDisabled === true) pass('Launch disabled on empty form'); else fail('Launch should be disabled', String(launchDisabled));

  const modelBtnsJson = await evaluate(ws, 'JSON.stringify([...document.querySelectorAll("button")].filter(function(b){return ["Sonnet","Opus","Haiku"].some(function(m){return b.textContent.includes(m);});}).map(function(b){return b.textContent.replace(/\\s+/g," ").trim().slice(0,20);}))');
  const modelBtns = JSON.parse(modelBtnsJson || '[]');
  if (modelBtns.length >= 3) pass(modelBtns.length + ' model buttons'); else fail('Model buttons missing', modelBtnsJson);

  const slider = await evaluate(ws, '!!document.querySelector("input[type=range]")');
  if (slider) pass('Team size slider found'); else fail('No slider');

  // TEST 4: Fill form
  console.log('\n--- TEST 4: Form fill ---');
  await evaluate(ws, 'var ta = document.querySelector("textarea"); var setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set; setter.call(ta, "Build a todo app"); ta.dispatchEvent(new Event("input", { bubbles: true }));');
  await new Promise(function(r) { setTimeout(r, 400); });

  await evaluate(ws, 'var inp = [...document.querySelectorAll("input")].find(function(i){return i.type==="text"&&(i.placeholder||"").includes("D:");}); if(inp){var s=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value").set;s.call(inp,"D:/multiAIAgentsClaude");inp.dispatchEvent(new Event("input",{bubbles:true}));}');
  await new Promise(function(r) { setTimeout(r, 400); });

  const launchEnabled = await evaluate(ws, '[...document.querySelectorAll("button")].find(function(b){return b.textContent.includes("Launch Mission")}) && [...document.querySelectorAll("button")].find(function(b){return b.textContent.includes("Launch Mission")}).disabled');
  if (launchEnabled === false) pass('Launch enabled after fill'); else fail('Launch still disabled after fill', String(launchEnabled));

  // TEST 5: Playground
  console.log('\n--- TEST 5: Playground ---');
  await evaluate(ws, 'window.location.hash = "#/playground"');
  await new Promise(function(r) { setTimeout(r, 1500); });

  const tplJson = await evaluate(ws, 'JSON.stringify([...document.querySelectorAll("button")].filter(function(b){return ["Code Review","Debug","Research","Migration","Refactor","Documentation","Security"].some(function(t){return b.textContent.includes(t);});}).map(function(b){return b.textContent.replace(/\\s+/g," ").trim().slice(0,20);}))');
  const tpls = JSON.parse(tplJson || '[]');
  if (tpls.length >= 4) pass(tpls.length + ' templates found'); else fail('Templates missing', tplJson);
  info('templates', JSON.stringify(tpls.slice(0, 6)));

  await evaluate(ws, '[...document.querySelectorAll("button")].find(function(b){return b.textContent.includes("Code Review");}) && [...document.querySelectorAll("button")].find(function(b){return b.textContent.includes("Code Review");}).click()');
  await new Promise(function(r) { setTimeout(r, 500); });
  const fieldsCount = await evaluate(ws, 'document.querySelectorAll("input[type=text]").length');
  if (Number(fieldsCount) > 0) pass('Fields appear after template click: ' + fieldsCount); else fail('No fields after click');

  // TEST 6: IPC load_history
  console.log('\n--- TEST 6: IPC load_history ---');
  const loadHist = await evaluate(ws, '(async function() { try { var h = await window.__TAURI_INTERNALS__.invoke("load_history"); return { ok: true, count: Array.isArray(h) ? h.length : -1 }; } catch(e) { return { error: e.message }; } })()');
  if (loadHist && loadHist.error) fail('load_history', loadHist.error);
  else pass('load_history works, count=' + (loadHist && loadHist.count));

  // TEST 7: IPC get_mission_history
  console.log('\n--- TEST 7: IPC get_mission_history ---');
  const mhResult = await evaluate(ws, '(async function() { try { var h = await window.__TAURI_INTERNALS__.invoke("get_mission_history"); return { ok: true, count: Array.isArray(h) ? h.length : -1 }; } catch(e) { return { error: e.message }; } })()');
  if (mhResult && mhResult.error) fail('get_mission_history', mhResult.error);
  else pass('get_mission_history works, count=' + (mhResult && mhResult.count));

  // TEST 8: get_mission_detail with bad id
  console.log('\n--- TEST 8: IPC get_mission_detail ---');
  const detailResult = await evaluate(ws, '(async function() { try { await window.__TAURI_INTERNALS__.invoke("get_mission_detail", { missionId: "nonexistent" }); return { ok: true }; } catch(e) { return { expectedError: e.message }; } })()');
  if (detailResult && detailResult.expectedError) pass('get_mission_detail errors gracefully for unknown id');
  else if (detailResult && detailResult.ok) pass('get_mission_detail returned ok');
  else fail('get_mission_detail unexpected', JSON.stringify(detailResult));

  // TEST 9: check_claude_available
  console.log('\n--- TEST 9: IPC check_claude_available ---');
  const claudeAvail = await evaluate(ws, '(async function() { try { var v = await window.__TAURI_INTERNALS__.invoke("check_claude_available"); return { ok: true, version: v }; } catch(e) { return { error: e.message }; } })()');
  if (claudeAvail && claudeAvail.error) fail('check_claude_available', claudeAvail.error);
  else { pass('check_claude_available works'); info('version', claudeAvail && claudeAvail.version); }

  // TEST 10: Console errors
  console.log('\n--- TEST 10: Console errors ---');
  const errors = await evaluate(ws, 'JSON.stringify(window.__qcErrors || [])');
  const errList = JSON.parse(errors || '[]');
  if (errList.length === 0) pass('No unhandled errors');
  else {
    fail(errList.length + ' error(s) found');
    errList.slice(0, 5).forEach(function(e) { console.log('    >', String(e).slice(0, 120)); });
  }

  console.log('\n=== QC DONE ===');
  ws.close();
}

main().catch(function(e) { console.error('FATAL:', e.message); process.exit(1); });
