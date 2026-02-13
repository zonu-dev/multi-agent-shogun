import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AlertIssueItem } from './parsers';
import { AlertSection } from './AlertSection';

afterEach(() => {
  cleanup();
});

const buildIssue = (heading: string): AlertIssueItem => ({
  key: 'issue-1',
  heading,
  detailLines: [
    {
      kind: 'text',
      text: '詳細',
      alert: true,
    },
  ],
});

describe('AlertSection', () => {
  it('renders the section and empty state when no visible alerts exist', () => {
    render(
      <AlertSection
        hasVisibleAlerts={false}
        displayAlertCount={0}
        alertIssueItems={[]}
        alertOpen
        setAlertOpen={vi.fn()}
        openAlertIssues={{}}
        setOpenAlertIssues={vi.fn()}
      />
    );

    expect(screen.getByText('要対応 (0件)')).not.toBeNull();
    expect(screen.getByText('要対応なし')).not.toBeNull();
  });

  it('sets the full issue heading as a title attribute', () => {
    const longHeading = 'これは長い要対応タイトルでござる。全文表示を確認するための文言';
    render(
      <AlertSection
        hasVisibleAlerts
        displayAlertCount={1}
        alertIssueItems={[buildIssue(longHeading)]}
        alertOpen
        setAlertOpen={vi.fn()}
        openAlertIssues={{ 'issue-1': false }}
        setOpenAlertIssues={vi.fn()}
      />
    );

    const heading = screen.getByText(longHeading);
    expect(heading.getAttribute('title')).toBe(longHeading);
  });
});
