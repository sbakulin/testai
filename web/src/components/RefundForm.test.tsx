import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RefundForm } from './RefundForm';
import { ApiError } from '../lib/api';

describe('RefundForm', () => {
  test('RefundForm submits amount in tiyin and disables submit while pending', async () => {
    const user = userEvent.setup();
    let finish!: () => void;
    const onSubmit = vi.fn(() => new Promise<void>((r) => (finish = r)));
    render(<RefundForm maxMinor={100000} onSubmit={onSubmit} onCancel={() => {}} />);

    await user.type(screen.getByTestId('refund-amount'), '12,5');
    await user.click(screen.getByTestId('refund-submit'));

    expect(onSubmit).toHaveBeenCalledWith(1250);
    expect((screen.getByTestId('refund-submit') as HTMLButtonElement).disabled).toBe(true);
    finish();
    await waitFor(() =>
      expect((screen.getByTestId('refund-submit') as HTMLButtonElement).disabled).toBe(false),
    );
  });

  test('shows validation message and does not submit invalid amounts', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn(async () => {});
    render(<RefundForm maxMinor={1000} onSubmit={onSubmit} onCancel={() => {}} />);

    await user.type(screen.getByTestId('refund-amount'), '11');
    await user.click(screen.getByTestId('refund-submit'));
    expect(screen.getByRole('alert').textContent).toContain('Сумма не должна превышать 10,00');
    expect(onSubmit).not.toHaveBeenCalled();
  });

  test('maps a rejected submit to a Russian message and stays open', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn(async () => {
      throw new ApiError(422, 'refund_exceeds_payment');
    });
    render(<RefundForm maxMinor={100000} onSubmit={onSubmit} onCancel={() => {}} />);
    await user.type(screen.getByTestId('refund-amount'), '5');
    await user.click(screen.getByTestId('refund-submit'));
    expect((await screen.findByRole('alert')).textContent).toContain(
      'Сумма возврата больше остатка по платежу',
    );
    expect(screen.queryByTestId('refund-amount')).not.toBeNull();
  });

  test('cancel calls onCancel', async () => {
    const user = userEvent.setup();
    const onCancel = vi.fn();
    render(<RefundForm maxMinor={100} onSubmit={async () => {}} onCancel={onCancel} />);
    await user.click(screen.getByTestId('refund-cancel'));
    expect(onCancel).toHaveBeenCalled();
  });
});
