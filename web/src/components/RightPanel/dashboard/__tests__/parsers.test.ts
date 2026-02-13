import { describe, expect, it } from 'vitest';
import {
  buildSegments,
  extractInProgressAssigneeIds,
  isAshigaruPlacementHeading,
  parseAlertIssueItems,
  parseDashboardLines,
  parseInProgressGroups,
  parseMarkdownTable,
  stripInlineMarkdown,
  type ParsedLine,
} from '../parsers';

const tableLine = (text: string): ParsedLine => ({
  kind: 'table',
  text,
  alert: false,
});

describe('parseMarkdownTable', () => {
  it('returns header/body rows and ignores markdown separator rows', () => {
    const parsed = parseMarkdownTable([
      tableLine('| 足軽 | 任務 | 状態 |'),
      tableLine('| --- | --- | --- |'),
      tableLine('| ashigaru8 | parser test | 完了 |'),
      tableLine('| ashigaru9 | store test | 進行中 |'),
    ]);

    expect(parsed).toEqual({
      headerRow: ['足軽', '任務', '状態'],
      bodyRows: [
        ['ashigaru8', 'parser test', '完了'],
        ['ashigaru9', 'store test', '進行中'],
      ],
    });
  });

  it('returns null when there are no valid table rows', () => {
    expect(parseMarkdownTable([])).toBeNull();
  });
});

describe('parseInProgressGroups', () => {
  it('derives mission and status labels from markdown table rows', () => {
    const content = [
      '### cmd_186: Phase 1',
      '| 足軽 | 任務 | ファイル | 進捗 |',
      '| --- | --- | --- | --- |',
      '| ashigaru8 | なし | queue/reports/report_5_testing.md | なし |',
    ].join('\n');

    const groups = parseInProgressGroups(parseDashboardLines(content));

    expect(groups).toEqual([
      {
        cmdId: 'cmd_186',
        summary: 'Phase 1',
        rows: [
          {
            assignee: 'ashigaru8',
            mission: '観点5: テスト',
            status: '進行中',
          },
        ],
      },
    ]);
  });

  it('fills an empty cmd group with a fallback row', () => {
    const lines = parseDashboardLines(['### cmd_187: 空グループ', 'なし'].join('\n'));
    const groups = parseInProgressGroups(lines);

    expect(groups).toEqual([
      {
        cmdId: 'cmd_187',
        summary: '空グループ',
        rows: [{ assignee: '—', mission: '空グループ', status: '進行中' }],
      },
    ]);
  });

  it('does not ingest markdown bullets after a table as in-progress table rows', () => {
    const lines = parseDashboardLines(
      [
        '### cmd_186: Phase 1',
        '| 足軽 | 任務 | ステータス |',
        '| --- | --- | --- |',
        '| 足軽8 | テスト基盤+単体テスト | 作業中 |',
        '- GameDesign#1: タスクカテゴリ | 建物マッピング統一',
        '- Testing#2: 統合テスト',
      ].join('\n')
    );

    const groups = parseInProgressGroups(lines);

    expect(groups).toEqual([
      {
        cmdId: 'cmd_186',
        summary: 'Phase 1',
        rows: [{ assignee: '足軽8', mission: 'テスト基盤+単体テスト', status: '作業中' }],
      },
    ]);
  });
});

describe('dashboard alert parsing', () => {
  it('ignores placeholder issues and injects fallback detail when detail is missing', () => {
    const lines = parseDashboardLines(
      [
        '# 日次ダッシュボード',
        '## 要対応',
        '### 件1. ビルド失敗',
        '- API が再起動を繰り返す',
        '### なし',
        '- なし',
        '### 2: 認証エラー',
        '',
        '## 進行中',
      ].join('\n')
    );

    const issues = parseAlertIssueItems(lines);

    expect(issues).toHaveLength(2);
    expect(issues[0]?.heading).toBe('件1: ビルド失敗');
    expect(issues[0]?.detailLines[0]?.text).toBe('API が再起動を繰り返す');
    expect(issues[1]?.heading).toBe('件2: 認証エラー');
    expect(issues[1]?.detailLines[0]?.text).toBe('詳細を確認されよ。');
  });
});

describe('parseDashboardLines', () => {
  it('classifies line kinds and toggles alert flags by section', () => {
    const content = [
      '# 本日の戦況',
      '最終更新: 2026-02-08T23:00:00',
      '## 要対応',
      '- 至急確認',
      '## 進行中',
      '| 足軽 | 任務 |',
    ].join('\n');

    const parsed = parseDashboardLines(content);
    const parsedAgain = parseDashboardLines(content);

    expect(parsedAgain).toBe(parsed);
    expect(parsed.map((line) => line.kind)).toEqual([
      'h1',
      'timestamp',
      'h2',
      'bullet',
      'h2',
      'table',
    ]);
    expect(parsed.map((line) => line.alert)).toEqual([false, false, true, true, false, false]);
  });
});

describe('buildSegments', () => {
  it('treats ashigaru placement heading as top-level accordion section', () => {
    const lines = parseDashboardLines(
      [
        '## 足軽配置状況',
        '| 足軽 | 状態 |',
        '| --- | --- |',
        '| 足軽1 | 作業中 |',
      ].join('\n')
    );

    const segments = buildSegments(lines, { includeDailyResultsH2: true });
    expect(segments).toHaveLength(1);
    expect(segments[0]?.type).toBe('accordion');

    const firstSegment = segments[0];
    if (!firstSegment || firstSegment.type !== 'accordion') {
      throw new Error('expected accordion segment');
    }

    expect(isAshigaruPlacementHeading(firstSegment.heading)).toBe(true);
  });
});

describe('stripInlineMarkdown', () => {
  it('removes strikethrough tokens in addition to other inline markdown', () => {
    expect(stripInlineMarkdown('~~C2: ミッション総報酬超過~~ **urgent** `cmd_231`')).toBe(
      'C2: ミッション総報酬超過 urgent cmd_231'
    );
  });
});

describe('extractInProgressAssigneeIds', () => {
  it('collects assignee ids from plain and strikethrough text', () => {
    const lines = parseDashboardLines(
      [
        '### cmd_231: dashboard',
        '- 担当: ~~ashigaru4~~',
        '| 足軽 | 任務 | 進捗 |',
        '| --- | --- | --- |',
        '| 足軽2 | parser fix | 進行中 |',
      ].join('\n')
    );

    expect(extractInProgressAssigneeIds(lines)).toEqual(['ashigaru2', 'ashigaru4']);
  });
});
