export function NotConnected() {
  return (
    <div className="notice" data-testid="not-connected">
      <h2>Сервис не подключён</h2>
      <p>
        Введите код: <code>npm run connect -- КОД</code>
      </p>
    </div>
  );
}
