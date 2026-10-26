# Запуск и публикация

Сайт на Vite плюс одна серверная функция `api/data.js`. Заявки, телефоны и аккаунты хранятся
в общей базе Upstash Redis, поэтому телефон и компьютер видят одни и те же данные.

## Vercel

1. **Storage → Create Database → Upstash (Redis)** → создать и подключить к этому проекту.
   Vercel сам добавит переменные `KV_REST_API_URL` и `KV_REST_API_TOKEN`.
2. **Settings → Environment Variables:** `ADMIN_PASSWORD` — пароль первого администратора.
3. **Deployments → Redeploy.** Вход: `admin` и этот пароль.

Root Directory — `./`, Framework — Vite (указан в `vercel.json`).
Каждый push в `main` публикуется автоматически.

Данные из старой версии, где всё хранилось в браузере: войдите админом в том браузере,
где они остались, и согласитесь на перенос. Другой браузер: «База → Резервная копия → Импорт».

## Локально

```sh
npm install
npm run dev      # http://localhost:5173, вход admin / admin
npm test
```

Без переменных Redis данные живут в памяти до перезапуска `npm run dev`.
Чтобы работать с настоящей базой, положите `KV_REST_API_URL` и `KV_REST_API_TOKEN` в `.env`.
