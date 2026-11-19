# Платежи — заметки для агента

Сервис пополнения счетов через провайдера MockPay: API на Fastify + node:sqlite (`api/`), кабинет оператора на React + Vite (`web/`), служебные скрипты (`scripts/`). Подробности — в `README.md`, API провайдера — в `PROVIDER.md`.

## Текущие задачи

Рабочие задачи лежат в `task/TASK.md`. Файл появляется после `npm run connect`; если его нет — попросите человека подключиться к стенду.

## Команды

- `npm install` — зависимости.
- `npm run dev` — API (http://localhost:3000), кабинет (http://localhost:5173) и слушатель вебхуков.
- `npm run dev -w api`, `npm run dev -w web`, `npm run listen` — по отдельности.
- `npm test` — все тесты; `npm test -w api`, `npm test -w web` — по пакету.
- `npm run build -w web` — проверка типов и сборка кабинета.
- `npm run reset` — вернуть локальную базу к исходным данным.

`npm run connect` и `npm run submit` запускает человек, не агент.

## Устройство

- `api/src/routes/` — HTTP-маршруты: счета, платежи, возвраты, вебхуки MockPay.
- `api/src/ledger.ts` — проводки и остатки; `api/src/mockpay.ts` — клиент провайдера; `api/src/receipts.ts` — клиент сервиса чеков.
- `api/src/schema.sql` — схема базы; локальная база — `api/data/app.db`.
- `web/src/pages/`, `web/src/components/`, `web/src/lib/` — страницы, компоненты, клиент API и хуки кабинета.
- `scripts/` — подключение к стенду, слушатель вебхуков, сброс данных, сдача работы.

## Соглашения

- Деньги — целые числа в тийинах (`*_minor`); строки провайдера (`"150000.00"`) переводятся только через `api/src/money.ts`.
- SQL пишется руками через `node:sqlite`, без ORM.
- Тесты лежат рядом с кодом: `api/test/`, `web/src/**/*.test.tsx`, `scripts/test/`. Новое поведение — с тестом.
- `data-testid` используются автотестами команды — не переименовывайте.
- Сообщения коммитов — по-русски, в формате `тип: что сделано` (`feat`, `fix`, `refactor`, `perf`, `docs`).
