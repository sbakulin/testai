import { Link, Route, Routes } from 'react-router';
import { AccountPage } from './pages/AccountPage';
import { AccountsPage } from './pages/AccountsPage';

export default function App() {
  return (
    <>
      <nav className="topbar">
        <Link to="/">Платежи</Link>
        <span className="muted">кабинет оператора</span>
      </nav>
      <main className="content">
        <Routes>
          <Route path="/" element={<AccountsPage />} />
          <Route path="/accounts/:id" element={<AccountPage />} />
          <Route path="*" element={<p className="muted">Страница не найдена</p>} />
        </Routes>
      </main>
    </>
  );
}
