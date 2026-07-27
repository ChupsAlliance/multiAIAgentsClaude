// tests/pages/RecordingsPage.ts
//
// Page Object for the /recordings route (RecordingsPage.jsx) and the
// Record toggle + Save dialog that live inside MissionLauncher on
// /mission (they are part of the same "recording" user journey).
//
// Locator strategy: getByTestId first, per docs/qc guide/AI_Playwright_Testing_Rules.md
// §3.1. data-testid names below match the checklist sent to
// frontend-recording-ui (see team message) — keep in sync with their
// actual attribute names once landed.
import { type Page, type Locator, expect } from '@playwright/test';

export class RecordingsPage {
  readonly page: Page;

  // Mission Control (record toggle + save dialog)
  readonly toggleRecordButton: Locator;
  readonly saveDialog: Locator;
  readonly saveDialogNameInput: Locator;
  readonly saveDialogSaveButton: Locator;
  readonly saveDialogDiscardButton: Locator;

  // /recordings list page
  readonly refreshButton: Locator;
  readonly emptyState: Locator;
  readonly recordingList: Locator;

  // Sidebar nav (used for real in-app navigation instead of raw hash URLs,
  // which are unreliable against the packaged file:// index.html).
  readonly sidebarRecordingsLink: Locator;
  readonly sidebarMissionLink: Locator;

  constructor(page: Page) {
    this.page = page;

    this.toggleRecordButton = page.getByTestId('btn-toggle-record');
    this.saveDialog = page.getByTestId('dialog-save-recording');
    this.saveDialogNameInput = page.getByTestId('input-recording-name');
    this.saveDialogSaveButton = page.getByTestId('btn-save-recording');
    this.saveDialogDiscardButton = page.getByTestId('btn-discard-recording');

    this.refreshButton = page.getByTestId('btn-refresh-recordings');
    this.emptyState = page.getByTestId('empty-state-recordings');
    this.recordingList = page.getByTestId('list-recordings');

    this.sidebarRecordingsLink = page.getByRole('button', { name: 'Bản ghi' });
    this.sidebarMissionLink = page.getByRole('button', { name: 'Mission Control' });
  }

  /** Navigate to /recordings via the sidebar (real user interaction, not a raw hash goto). */
  async goto() {
    await this.sidebarRecordingsLink.click();
    await expect(this.page.getByRole('heading', { name: 'Bản ghi' })).toBeVisible();
  }

  /** Navigate to /mission via the sidebar. */
  async gotoMission() {
    await this.sidebarMissionLink.click();
  }

  // ── Mission Control record toggle ──────────────────────────────
  async enableRecording() {
    await expect(this.toggleRecordButton).toBeVisible();
    const pressed = await this.toggleRecordButton.getAttribute('aria-pressed');
    if (pressed !== 'true') {
      await this.toggleRecordButton.click();
    }
    await expect(this.toggleRecordButton).toHaveAttribute('aria-pressed', 'true');
  }

  async isRecordingEnabled(): Promise<boolean> {
    return (await this.toggleRecordButton.getAttribute('aria-pressed')) === 'true';
  }

  // ── Save dialog (shown after a mission completes while recording) ──
  async waitForSaveDialog() {
    await expect(this.saveDialog).toBeVisible();
  }

  async saveRecordingAs(name: string) {
    await expect(this.saveDialog).toBeVisible();
    await this.saveDialogNameInput.fill(name);
    await this.saveDialogSaveButton.click();
    await expect(this.saveDialog).toBeHidden();
  }

  async discardRecording() {
    await expect(this.saveDialog).toBeVisible();
    await this.saveDialogDiscardButton.click();
    await expect(this.saveDialog).toBeHidden();
  }

  // ── /recordings list ─────────────────────────────────────────
  async refresh() {
    await this.refreshButton.click();
  }

  async expectEmptyState() {
    await expect(this.emptyState).toBeVisible();
    await expect(this.emptyState).toContainText('Chưa có bản ghi nào');
  }

  recordingCard(recordingId: string): Locator {
    return this.page.getByTestId(`recording-card-${recordingId}`);
  }

  /** Find a recording card by its visible name (used when the id isn't known ahead of time). */
  recordingCardByName(name: string): Locator {
    return this.page.locator('[data-testid^="recording-card-"]').filter({ hasText: name });
  }

  async expectRecordingVisibleWithName(name: string) {
    const card = this.recordingCardByName(name);
    await expect(card).toBeVisible();
  }

  async playOnRealUi(recordingId: string) {
    await this.page.getByTestId(`btn-play-real-ui-${recordingId}`).click();
  }

  async present(recordingId: string) {
    await this.page.getByTestId(`btn-present-${recordingId}`).click();
  }

  async deleteRecording(recordingId: string) {
    await this.page.getByTestId(`btn-delete-${recordingId}`).click();
    await this.page.getByTestId(`btn-confirm-delete-${recordingId}`).click();
  }

  async renameRecording(recordingId: string, newName: string) {
    await this.page.getByTestId(`btn-edit-name-${recordingId}`).click();
    const input = this.page.getByTestId(`input-rename-${recordingId}`);
    await expect(input).toBeVisible();
    await input.fill(newName);
    await input.press('Enter');
  }

  recordingName(recordingId: string): Locator {
    return this.page.getByTestId(`recording-name-${recordingId}`);
  }

  async getRecordingDurationText(recordingId: string): Promise<string> {
    const card = this.recordingCard(recordingId);
    return (await card.innerText());
  }
}
