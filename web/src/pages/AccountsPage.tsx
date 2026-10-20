import { Link } from 'react-router';
import { NotConnected } from '../components/NotConnected';
import { isNotConnected, listAccounts } from '../lib/api';
import { formatSums } from '../lib/money';
import { useResource } from '../lib/useResource';

export function AccountsPage() {
  const { data, error } = useResource('accounts', listAccounts);

  if (isNotConnected(error)) return <NotConnected />;
  if (error && !data) return <p className="form-error">Не удалось загрузить счета</p>;
  if (!data) return <p className="muted">Загрузка…</p>;

  return (
    <>
      <h1>Счета</h1>
      <table className="accounts">
        <thead>
          <tr>
            <th>Владелец</th>
            <th className="num">Остаток</th>
            <th className="num">Платежей</th>
          </tr>
        </thead>
        <tbody>
          {data.map((a) => (
            <tr key={a.id} data-testid={`account-row-${a.id}`}>
              <td>
                <Link to={`/accounts/${a.id}`}>{a.owner_name}</Link>
              </td>
              <td className="num">{formatSums(a.balance_minor)}</td>
              <td className="num">{a.payments_count}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}
