import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { investigationFixture } from '../../test/fixture';
import { ConversationPanel } from './ConversationPanel';

afterEach(cleanup);

const noop = () => undefined;

it('opens the thread with the research run and distinguishes follow-up analysis', () => {
  const investigation = investigationFixture({
    messages: [
      {
        id: 'message-1',
        role: 'USER',
        kind: 'FOLLOW_UP',
        content: 'Which three sources are the most reliable?',
        createdAt: '2026-08-29T02:20:00.000Z',
        citedSourceIds: [],
        limitations: [],
        failed: false,
      },
      {
        id: 'message-2',
        role: 'ASSISTANT',
        kind: 'FOLLOW_UP',
        content: 'The audited filing is the only primary source on the record.',
        createdAt: '2026-08-29T02:20:04.000Z',
        citedSourceIds: ['src-filing'],
        limitations: [],
        failed: false,
      },
    ],
  });

  render(
    <ConversationPanel
      investigation={investigation}
      pending={false}
      onAsk={noop}
      onOpenSource={noop}
    />,
  );

  expect(screen.getByText(/NEW RESEARCH/)).toBeInTheDocument();
  expect(screen.getAllByText(/FOLLOW-UP ANALYSIS/)).toHaveLength(1);
  expect(screen.getByText(/only primary source on the record/i)).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Corporate Registry' })).toBeInTheDocument();
});

it('sends a follow-up without repeating the original question', () => {
  const onAsk = vi.fn();
  render(
    <ConversationPanel
      investigation={investigationFixture()}
      pending={false}
      onAsk={onAsk}
      onOpenSource={noop}
    />,
  );

  fireEvent.change(screen.getByLabelText(/Follow-up question/i), {
    target: { value: 'Only use primary sources.' },
  });
  fireEvent.click(screen.getByRole('button', { name: /Send follow-up/i }));

  expect(onAsk).toHaveBeenCalledWith('Only use primary sources.');
});

it('locks the composer while the investigation is still running', () => {
  render(
    <ConversationPanel
      investigation={investigationFixture({ status: 'RESEARCHING' })}
      pending={false}
      onAsk={noop}
      onOpenSource={noop}
    />,
  );

  expect(screen.getByLabelText(/Follow-up question/i)).toBeDisabled();
});
