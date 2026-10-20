import { useState } from 'react';
import { Link, useParams } from 'react-router';
import { NotConnected } from '../components/NotConnected';
import { PaymentPanel } from '../components/PaymentPanel';
import { PaymentsTable } from '../components/PaymentsTable';
import { getBalance, isNotConnected, listAccounts, listPayments } from '../lib/api';
import { formatSums } from '../lib/money';
import { useResource } from '../lib/useResource';

export function AccountPage() {
  const { id = '' } = useParams();
  return <AccountView key={id} id={id} />;
}

function AccountView({ id }: { id: string }) {
  const [q, setQ] = useState('');
  const [selectedId, setSelectedId] = useState<string>();
  const accounts = useResource('accounts', listAccounts);
  const balance = useResource(`balance:${id}`, () => getBalance(id));
  const payments = useResource(`payments:${id}:${q}`, () => listPayments(id, q));

  const error = balance.error ?? payments.error ?? accounts.error;
  if (isNotConnected(error)) return <NotConnected />;

  const rows = payments.data;
  const selected = rows?.find((p) => p.id === selectedId);

  return (
    <>
      <p>
        <Link to="/">← Все счета</Link>
      </p>
      <header className="account-header">
        <h1>{accounts.data?.find((a) => a.id === id)?.owner_name ?? id}</h1>
        <div className="balance">
          Остаток: <strong>{balance.data ? formatSums(balance.data.balance_minor) : '…'}</strong>
        </div>
      </header>
      {error && !rows && <p className="form-error">Не удалось загрузить данные счёта</p>}

      <div className="toolbar">
        <input
          type="search"
          data-testid="payments-search"
          placeholder="Поиск по номеру платежа"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <span className="muted">
          Платежей: <span data-testid="payments-count">{rows ? rows.length : '…'}</span>
        </span>
      </div>

      <div className="layout">
        <div className="layout-main">
          {rows && (
            <PaymentsTable payments={rows} selectedId={selected?.id} onSelect={(p) => setSelectedId(p.id)} />
          )}
        </div>
        {selected && (
          <div className="layout-side">
            <PaymentPanel payment={selected} onChanged={balance.reload} />
          </div>
        )}
      </div>
    </>
  );
}
