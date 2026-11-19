# MockPay — выжимка из документации провайдера

Базовый адрес API: `{STAND_URL}/s/{STAND_CODE}/mockpay` (значения — в `.env.local` после `npm run connect`). Тела запросов и ответов — JSON. Суммы — строки в сумах с двумя знаками после точки, валюта — `UZS`.

## Создание платежа

`POST /payments`

```json
{ "merchant_reference": "pay_3f9a1c0b7d2e", "amount": "150000.00", "currency": "UZS" }
```

- `merchant_reference` — идентификатор платежа на нашей стороне, возвращается в вебхуках.
- `amount` — сумма к оплате.

Ответ `201`:

```json
{ "id": "mp_8c1d2e3f4a5b6c7d", "status": "pending" }
```

`id` — идентификатор платежа в MockPay. Результат оплаты приходит вебхуком.

## Получение платежа

`GET /payments/{id}`

Ответ `200`:

```json
{
  "id": "mp_8c1d2e3f4a5b6c7d",
  "merchant_reference": "pay_3f9a1c0b7d2e",
  "amount": "150000.00",
  "currency": "UZS",
  "status": "succeeded"
}
```

`404` — платёж не найден.

## Создание возврата

`POST /refunds`

```json
{ "payment_id": "mp_8c1d2e3f4a5b6c7d", "amount": "50000.00", "idempotency_key": "ref_0a1b2c3d4e5f" }
```

- `payment_id` — идентификатор платежа в MockPay.
- `amount` — сумма возврата.
- `idempotency_key` — идентификатор возврата на нашей стороне, возвращается в вебхуке.

Ответ `201`:

```json
{ "id": "rf_1a2b3c4d5e6f7a8b", "status": "processing" }
```

Итог возврата приходит вебхуком. `404` — платёж не найден, `422` — некорректная сумма.

## Вебхуки

MockPay отправляет события методом `POST` с телом JSON. Каждое событие имеет `event_id` и `type`.

### Платёж

Типы: `payment.succeeded`, `payment.failed`.

```json
{
  "event_id": "evt_5e6f7a8b9c0d1e2f",
  "type": "payment.succeeded",
  "payment": { "id": "mp_8c1d2e3f4a5b6c7d", "merchant_reference": "pay_3f9a1c0b7d2e" },
  "amount": "150000.00",
  "currency": "UZS"
}
```

`amount` — фактически оплаченная сумма.

### Возврат

Типы: `refund.succeeded`, `refund.failed`.

```json
{
  "event_id": "evt_9a8b7c6d5e4f3a2b",
  "type": "refund.succeeded",
  "payment": { "id": "mp_8c1d2e3f4a5b6c7d", "merchant_reference": "pay_3f9a1c0b7d2e" },
  "amount": "-50000.00",
  "currency": "UZS",
  "refund": { "id": "rf_1a2b3c4d5e6f7a8b", "idempotency_key": "ref_0a1b2c3d4e5f" }
}
```

`amount` у возврата отрицательный. `refund.idempotency_key` — ключ, переданный при создании возврата.

### Подпись

Заголовок `X-Signature` — HMAC-SHA256 от сырого тела запроса (байты как пришли, до разбора JSON) с секретом вебхуков, в шестнадцатеричном виде. Секрет — `WEBHOOK_SECRET` в `.env.local`.

### Доставка

MockPay ждёт ответа 2 секунды и повторяет доставку, пока не получит 200.

Событие может прийти более одного раза.
