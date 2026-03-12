/**
 * QC Test Suite for agent-teams-guide Tauri App
 * Target: http://127.0.0.1:1420 (Tauri dev mode)
 *
 * Tests:
 *  1 - Sidebar navigation
 *  2 - Mission Control Page - Launcher
 *  3 - MissionHistoryPanel
 *  4 - Playground Page
 *  5 - Console errors
 */

import puppeteer from 'puppeteer';

const BASE_URL = 'http://127.0.0.1:1420';

// ── helpers ──────────────────────────────────────────────────────────────────
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

function pad(s, len = 60) {
  return String(s).padEnd(len, ' ');
}

const results = [];
function report(testName, subTest, status, detail = '') {
  const line = { testName, subTest, status, detail };
  results.push(line);
  const icon = status === 'PASS' ? '✔' : status === 'FAIL' ? '✘' : 'ℹ';
  console.log(`  ${icon} [${status}] ${subTest}${detail ? ' — ' + detail : ''}`);
}

// ── main ─────────────────────────────────────────────────────────────────────
(async () => {
  console.log('\n============================================================');
  console.log('  QC AUTO TEST — agent-teams-guide Tauri App');
  console.log('  Target:', BASE_URL);
  console.log('============================================================\n');

  // ── connectivity check ──────────────────────────────────────────────────
  console.log('[PRE-CHECK] Connectivity …');
  let connOk = false;
  try {
    const res = await fetch(BASE_URL, { signal: AbortSignal.timeout(5000) });
    connOk = res.ok || res.status === 200;
    console.log(`  App responded HTTP ${res.status} — ${connOk ? 'OK' : 'Unexpected'}`);
  } catch (e) {
    console.error('  FATAL: App is NOT reachable at', BASE_URL);
    console.error('  Error:', e.message);
    console.error('  Please start the dev server first: npm run dev (inside agent-teams-guide)');
    process.exit(1);
  }

  // ── launch browser ──────────────────────────────────────────────────────
  const browser = await puppeteer.launch({
    headless: true,                // run headless in CI; change to false to watch
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  const consoleErrors = [];
  const page = await browser.newPage();

  // Capture console errors globally
  page.on('console', msg => {
    if (msg.type() === 'error') {
      consoleErrors.push(msg.text());
    }
  });
  page.on('pageerror', err => {
    consoleErrors.push('[page-error] ' + err.message);
  });

  // Bypass Tauri invoke errors (they will fail in browser — expected)
  await page.setRequestInterception(false);

  // ──────────────────────────────────────────────────────────────────────────
  // TEST 1: Sidebar navigation
  // ──────────────────────────────────────────────────────────────────────────
  console.log('\n── TEST 1: Sidebar navigation ──────────────────────────────');

  await page.goto(BASE_URL, { waitUntil: 'networkidle0', timeout: 15000 });
  // Bypass Tauri setup: set localStorage flag so we skip onboarding redirect
  await page.evaluate(() => {
    localStorage.setItem('agent_teams_setup_done', '1');
  });

  // Navigate to / to trigger the "checked" state with flag set
  await page.goto(BASE_URL, { waitUntil: 'networkidle0', timeout: 15000 });
  await sleep(1000);

  // Check sidebar rendered
  const sidebarExists = await page.$('aside') !== null;
  report('Test 1', 'Sidebar element rendered', sidebarExists ? 'PASS' : 'FAIL',
    sidebarExists ? 'aside element found' : 'aside element not found');

  // Navigate to each nav item and verify URL hash/pathname
  const navItems = [
    { label: 'Tài liệu',        path: '/' },
    { label: 'Playground',      path: '/playground' },
    { label: 'Mission Control', path: '/mission' },
    { label: 'Dashboard',       path: '/dashboard' },
  ];

  for (const item of navItems) {
    try {
      // Find button in sidebar with exact label text
      const buttons = await page.$$('aside button');
      let found = false;
      for (const btn of buttons) {
        const text = await btn.evaluate(el => el.textContent.trim());
        if (text.includes(item.label)) {
          await btn.click();
          await sleep(800);
          found = true;
          break;
        }
      }
      if (!found) {
        report('Test 1', `Nav: ${item.label}`, 'FAIL', 'Button not found in sidebar');
        continue;
      }

      const url = page.url();
      const urlObj = new URL(url);
      const currentPath = urlObj.hash
        ? urlObj.hash.replace('#', '')  // hash-based routing
        : urlObj.pathname;

      // React Router in hash or history mode
      const pathMatch = currentPath === item.path || url.includes(item.path === '/' ? BASE_URL + '/' : item.path);
      report('Test 1', `Nav: ${item.label}`, pathMatch ? 'PASS' : 'FAIL',
        `URL: ${url} | Expected path: ${item.path}`);
    } catch (e) {
      report('Test 1', `Nav: ${item.label}`, 'FAIL', e.message);
    }
  }

  // ──────────────────────────────────────────────────────────────────────────
  // TEST 2: Mission Control Page – MissionLauncher
  // ──────────────────────────────────────────────────────────────────────────
  console.log('\n── TEST 2: Mission Control Page - Launcher ─────────────────');

  await page.goto(BASE_URL + '/#/mission', { waitUntil: 'networkidle0', timeout: 10000 });
  await sleep(1200);

  // Also try history-based route if hash didn't work
  let missionPageText = await page.evaluate(() => document.body.innerText);
  if (!missionPageText.includes('Mission Control')) {
    // Try navigating via sidebar
    const btns = await page.$$('aside button');
    for (const btn of btns) {
      const t = await btn.evaluate(el => el.textContent);
      if (t.includes('Mission Control')) {
        await btn.click();
        await sleep(1000);
        break;
      }
    }
  }

  // 2a. MissionLauncher renders (h1 "Mission Control")
  const h1Text = await page.evaluate(() => {
    const h1 = document.querySelector('h1');
    return h1 ? h1.textContent.trim() : null;
  });
  report('Test 2', 'MissionLauncher h1 "Mission Control"',
    h1Text === 'Mission Control' ? 'PASS' : 'FAIL',
    `Found h1: "${h1Text}"`);

  // 2b. Textarea "Yêu cầu của bạn" has placeholder
  const textareaPlaceholder = await page.evaluate(() => {
    const ta = document.querySelector('textarea');
    return ta ? ta.placeholder : null;
  });
  report('Test 2', 'Textarea has placeholder',
    textareaPlaceholder && textareaPlaceholder.length > 0 ? 'PASS' : 'FAIL',
    textareaPlaceholder ? `placeholder="${textareaPlaceholder.slice(0, 60)}..."` : 'No textarea found');

  // 2c. Input folder path placeholder
  const inputPlaceholder = await page.evaluate(() => {
    const inp = document.querySelector('input[type="text"]');
    return inp ? inp.placeholder : null;
  });
  report('Test 2', 'Input folder path has placeholder',
    inputPlaceholder && inputPlaceholder.length > 0 ? 'PASS' : 'FAIL',
    inputPlaceholder ? `placeholder="${inputPlaceholder}"` : 'No text input found');

  // 2d. 3 model buttons (Sonnet, Opus, Haiku)
  const modelButtons = await page.evaluate(() => {
    const allBtns = Array.from(document.querySelectorAll('button'));
    return allBtns
      .filter(b => b.textContent.includes('Sonnet') || b.textContent.includes('Opus') || b.textContent.includes('Haiku'))
      .map(b => b.textContent.trim().split('\n')[0].trim());
  });
  report('Test 2', '3 model buttons render (Sonnet, Opus, Haiku)',
    modelButtons.length >= 3 ? 'PASS' : 'FAIL',
    `Found ${modelButtons.length} model buttons: ${modelButtons.join(', ')}`);

  // 2e. Team size slider
  const sliderExists = await page.$('input[type="range"]') !== null;
  report('Test 2', 'Team Size slider renders',
    sliderExists ? 'PASS' : 'FAIL',
    sliderExists ? 'input[type=range] found' : 'No range slider found');

  // 2f. Launch button disabled when form empty
  const launchBtnState = await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll('button'));
    const launchBtn = btns.find(b => b.textContent.includes('Launch Mission'));
    if (!launchBtn) return { found: false };
    return {
      found: true,
      disabled: launchBtn.disabled,
      classes: launchBtn.className,
    };
  });

  if (!launchBtnState.found) {
    report('Test 2', 'Launch button disabled when form empty', 'FAIL', 'Launch button not found');
  } else {
    const isDisabled = launchBtnState.disabled ||
      launchBtnState.classes.includes('cursor-not-allowed');
    report('Test 2', 'Launch button disabled when form empty',
      isDisabled ? 'PASS' : 'FAIL',
      `disabled attr=${launchBtnState.disabled}, classes include cursor-not-allowed=${launchBtnState.classes.includes('cursor-not-allowed')}`);
  }

  // ──────────────────────────────────────────────────────────────────────────
  // TEST 3: MissionHistoryPanel
  // ──────────────────────────────────────────────────────────────────────────
  console.log('\n── TEST 3: MissionHistoryPanel ─────────────────────────────');

  // Scroll to bottom of mission page to see if history panel renders
  await page.evaluate(() => {
    const main = document.querySelector('main');
    if (main) main.scrollTop = main.scrollHeight;
    window.scrollTo(0, document.body.scrollHeight);
  });
  await sleep(800);

  // Panel returns null if no history — so it may legitimately not render.
  // We check its container structure instead.
  const historyPanelInfo = await page.evaluate(() => {
    const allElements = Array.from(document.querySelectorAll('*'));
    const clockEl = allElements.find(el =>
      el.textContent && el.textContent.trim().toLowerCase().includes('mission history')
    );
    if (clockEl) {
      return { found: true, text: clockEl.textContent.trim().slice(0, 80) };
    }
    // Check if border-t element exists (the panel's outer div)
    const borderTEls = allElements.filter(el =>
      el.className && typeof el.className === 'string' && el.className.includes('border-t') && el.className.includes('border-vs-border')
    );
    return { found: false, borderTCount: borderTEls.length };
  });

  if (historyPanelInfo.found) {
    report('Test 3', 'MissionHistoryPanel renders', 'PASS',
      `Panel text: "${historyPanelInfo.text}"`);
  } else {
    report('Test 3', 'MissionHistoryPanel renders', 'INFO',
      'Panel not visible — expected when no mission history exists (component returns null when empty)');
  }

  // ──────────────────────────────────────────────────────────────────────────
  // TEST 4: Playground Page
  // ──────────────────────────────────────────────────────────────────────────
  console.log('\n── TEST 4: Playground Page ─────────────────────────────────');

  // Navigate to playground
  await page.goto(BASE_URL, { waitUntil: 'domcontentloaded', timeout: 10000 });
  await sleep(400);
  const playBtns = await page.$$('aside button');
  let playNavigated = false;
  for (const btn of playBtns) {
    const t = await btn.evaluate(el => el.textContent);
    if (t.includes('Playground')) {
      await btn.click();
      await sleep(1200);
      playNavigated = true;
      break;
    }
  }

  if (!playNavigated) {
    report('Test 4', 'Navigate to /playground', 'FAIL', 'Playground nav button not found');
  } else {
    report('Test 4', 'Navigate to /playground', 'PASS', 'Clicked Playground in sidebar');
  }

  // 4a. Template cards render
  const templateCards = await page.evaluate(() => {
    // Templates are buttons with specific structure: icon emoji + label + desc + agents
    const btns = Array.from(document.querySelectorAll('button'));
    const cards = btns.filter(b => {
      const text = b.textContent;
      return (text.includes('agents') && (
        text.includes('Code Review') ||
        text.includes('Tính năng mới') ||
        text.includes('Debug Bug') ||
        text.includes('Research') ||
        text.includes('Deploy') ||
        text.includes('Refactor') ||
        text.includes('Migration')
      ));
    });
    return cards.map(c => c.textContent.trim().slice(0, 50));
  });
  report('Test 4', 'Template cards render',
    templateCards.length > 0 ? 'PASS' : 'FAIL',
    `Found ${templateCards.length} template cards: ${templateCards.slice(0, 3).map(t => t.split('\n')[0]).join(', ')}`);

  // 4b. Click first template and check fields appear
  let fieldsAppeared = false;
  let clickedTemplate = '';
  if (templateCards.length > 0) {
    try {
      // Click the first template card
      const tplBtns = await page.evaluate(() => {
        const btns = Array.from(document.querySelectorAll('button'));
        const cards = btns.filter(b => {
          const text = b.textContent;
          return (text.includes('agents') && (
            text.includes('Code Review') ||
            text.includes('Tính năng mới') ||
            text.includes('Debug Bug') ||
            text.includes('Research')
          ));
        });
        return cards.length > 0 ? cards[0].textContent.trim().slice(0, 30) : null;
      });
      clickedTemplate = tplBtns || 'first template';

      const tplBtnHandles = await page.$$('button');
      for (const btn of tplBtnHandles) {
        const text = await btn.evaluate(el => el.textContent);
        if (text.includes('agents') && (
          text.includes('Code Review') ||
          text.includes('Tính năng mới') ||
          text.includes('Debug Bug')
        )) {
          await btn.click();
          await sleep(800);
          break;
        }
      }

      // Check if input fields appeared
      const inputCount = await page.$$eval('input[type="text"], input[type="number"]', els => els.length);
      fieldsAppeared = inputCount > 0;
      report('Test 4', `Click template → fields appear`,
        fieldsAppeared ? 'PASS' : 'FAIL',
        `After clicking template, found ${inputCount} input fields`);
    } catch (e) {
      report('Test 4', 'Click template → fields appear', 'FAIL', e.message);
    }
  } else {
    report('Test 4', 'Click template → fields appear', 'FAIL', 'No template cards to click');
  }

  // 4c. Launch button disabled when form empty
  const playLaunchState = await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll('button'));
    // Look for Launch / Generate button
    const launchBtn = btns.find(b =>
      b.textContent.includes('Launch') ||
      b.textContent.includes('Generate') ||
      b.textContent.includes('Tạo Prompt')
    );
    if (!launchBtn) return { found: false, allBtnTexts: btns.map(b => b.textContent.trim().slice(0, 20)) };
    return {
      found: true,
      text: launchBtn.textContent.trim().slice(0, 40),
      disabled: launchBtn.disabled,
      classes: launchBtn.className,
    };
  });

  if (!playLaunchState.found) {
    report('Test 4', 'Launch/Generate button disabled when form empty', 'FAIL',
      'Launch button not found. Available buttons: ' + (playLaunchState.allBtnTexts || []).slice(0, 5).join(' | '));
  } else {
    const isDisabled = playLaunchState.disabled ||
      playLaunchState.classes.includes('cursor-not-allowed') ||
      playLaunchState.classes.includes('opacity-50');
    report('Test 4', `"${playLaunchState.text}" button disabled when form empty`,
      isDisabled ? 'PASS' : 'FAIL',
      `disabled=${playLaunchState.disabled}, has cursor-not-allowed=${playLaunchState.classes.includes('cursor-not-allowed')}`);
  }

  // ──────────────────────────────────────────────────────────────────────────
  // TEST 5: Console errors
  // ──────────────────────────────────────────────────────────────────────────
  console.log('\n── TEST 5: Console errors ──────────────────────────────────');

  // Visit all pages to gather any console errors
  const pagesToVisit = ['/', '/mission', '/playground', '/dashboard'];
  for (const p of pagesToVisit) {
    await page.goto(BASE_URL + p, { waitUntil: 'domcontentloaded', timeout: 8000 }).catch(() => {});
    await sleep(600);
  }

  // Filter out known/expected Tauri-specific errors (invoke calls fail in browser)
  const tauriIgnorePatterns = [
    'invoke',
    'tauri',
    '__TAURI__',
    'ipc',
    'window.__TAURI_INTERNALS__',
  ];
  const realErrors = consoleErrors.filter(e =>
    !tauriIgnorePatterns.some(pat => e.toLowerCase().includes(pat.toLowerCase()))
  );
  const tauriErrors = consoleErrors.filter(e =>
    tauriIgnorePatterns.some(pat => e.toLowerCase().includes(pat.toLowerCase()))
  );

  if (realErrors.length === 0) {
    report('Test 5', 'No real console.error (non-Tauri)', 'PASS',
      `0 real errors, ${tauriErrors.length} expected Tauri IPC errors`);
  } else {
    report('Test 5', 'Console errors found', 'FAIL',
      `${realErrors.length} real error(s) detected`);
    realErrors.forEach((e, i) => {
      report('Test 5', `  Error #${i+1}`, 'FAIL', e.slice(0, 200));
    });
  }

  if (tauriErrors.length > 0) {
    report('Test 5', 'Tauri IPC errors (expected in browser)', 'INFO',
      `${tauriErrors.length} Tauri invoke errors (normal — not a real Tauri window)`);
  }

  // ── close browser ────────────────────────────────────────────────────────
  await browser.close();

  // ── final report ─────────────────────────────────────────────────────────
  console.log('\n============================================================');
  console.log('  FINAL REPORT');
  console.log('============================================================');

  const passed  = results.filter(r => r.status === 'PASS').length;
  const failed  = results.filter(r => r.status === 'FAIL').length;
  const info    = results.filter(r => r.status === 'INFO').length;
  const total   = passed + failed;

  console.log(`\n  Total checks : ${total + info}`);
  console.log(`  PASS         : ${passed}`);
  console.log(`  FAIL         : ${failed}`);
  console.log(`  INFO         : ${info}`);
  console.log(`  Pass rate    : ${total > 0 ? Math.round((passed/total)*100) : 0}%`);

  if (failed > 0) {
    console.log('\n  ── FAILURES ────────────────────────────────────────────');
    results.filter(r => r.status === 'FAIL').forEach(r => {
      console.log(`  ✘ [${r.testName}] ${r.subTest}`);
      if (r.detail) console.log(`    → ${r.detail}`);
    });
  }

  console.log('\n  All console errors captured during test:\n');
  if (consoleErrors.length === 0) {
    console.log('  (none)');
  } else {
    consoleErrors.forEach((e, i) => console.log(`  [${i+1}] ${e.slice(0, 300)}`));
  }

  console.log('\n============================================================\n');

  process.exit(failed > 0 ? 1 : 0);
})();
