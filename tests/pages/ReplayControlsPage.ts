// tests/pages/ReplayControlsPage.ts
//
// Page Object for the shared <ReplayControls /> component, used both
// on MissionControlPage (replay-on-real-ui mode) and PresentationModePage.
// Also covers the PresentationModePage-specific chrome (timeline,
// typewriter text) since that page is just ReplayControls + extra UI.
//
// Locator strategy: getByTestId first, per docs/qc guide/AI_Playwright_Testing_Rules.md.
import { type Page, type Locator, expect } from '@playwright/test';

export type ReplaySpeed = 1 | 2 | 5 | 'instant';

export class ReplayControlsPage {
  readonly page: Page;

  readonly root: Locator;
  readonly playPauseButton: Locator;
  readonly seekTrack: Locator;
  readonly exitButton: Locator;

  // Presentation-mode-only chrome
  readonly presentationModePage: Locator;
  readonly presentationTimeline: Locator;
  readonly typewriterText: Locator;

  // MissionControlPage replay-mode indicator
  readonly missionDashboardReplayMode: Locator;

  constructor(page: Page) {
    this.page = page;

    this.root = page.getByTestId('replay-controls');
    this.playPauseButton = page.getByTestId('btn-replay-play-pause');
    this.seekTrack = page.getByTestId('replay-seek-track');
    this.exitButton = page.getByTestId('btn-replay-exit');

    this.presentationModePage = page.getByTestId('presentation-mode-page');
    this.presentationTimeline = page.getByTestId('presentation-timeline');
    this.typewriterText = page.getByTestId('typewriter-text');

    this.missionDashboardReplayMode = page.getByTestId('mission-dashboard-replay-mode');
  }

  speedButton(speed: ReplaySpeed): Locator {
    return this.page.getByTestId(`btn-replay-speed-${speed}`);
  }

  async expectVisible() {
    await expect(this.root).toBeVisible();
  }

  async play() {
    // Only click if currently paused (icon carries the state; we rely on
    // the button's accessible title text set by ReplayControls.jsx).
    await this.playPauseButton.click();
  }

  async pause() {
    await this.playPauseButton.click();
  }

  async setSpeed(speed: ReplaySpeed) {
    await this.speedButton(speed).click();
  }

  async exit() {
    await this.exitButton.click();
  }

  /** Click a point on the seek track proportional to the given ratio (0..1) of totalMs. */
  async seekToRatio(ratio: number) {
    const box = await this.seekTrack.boundingBox();
    if (!box) throw new Error('seek track not visible/attached — cannot compute click position');
    const x = box.x + box.width * Math.min(1, Math.max(0, ratio));
    const y = box.y + box.height / 2;
    await this.page.mouse.click(x, y);
  }

  /** Click at the very end of the seek track (used for "tua tới cuối timeline"). */
  async seekToEnd() {
    await this.seekToRatio(1);
  }

  async expectFinishedAtEnd() {
    // Playhead pinned at 100% and play/pause button shows "play" (not playing) state.
    await expect(this.playPauseButton).toHaveAttribute('title', 'Phát');
  }

  async expectPresentationModeVisible() {
    await expect(this.presentationModePage).toBeVisible();
  }

  async expectTypewriterTextVisible() {
    await expect(this.typewriterText).toBeVisible();
  }

  async expectMissionDashboardInReplayMode() {
    await expect(this.missionDashboardReplayMode).toBeVisible();
  }
}
