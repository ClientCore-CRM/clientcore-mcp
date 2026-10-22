# calculator-mcp

MCP-сервер калькулятора коммерческих предложений (КП) для Claude Desktop, Cursor, Claude Code и других MCP-клиентов. Раньше назывался `clientcore-mcp`.

**Установка определяется ключом.** Ключ из портала ClientCore подключает калькулятор ClientCore, ключ из портала Retail Rocket — калькулятор Retail Rocket. Подключений два, по одному на установку: КП двух компаний не смешиваются. При старте сервер спрашивает `GET /api/v1/catalog`, по полю `engine` выбирает набор инструментов и пишет в `instructions`, какой калькулятор подключён («Калькулятор КП ClientCore» / «Калькулятор КП Retail Rocket»).

## 1. Получи ключ

Настройки своего портала → ключи (показывается один раз):

| Установка | Портал | Префикс ключа |
|---|---|---|
| ClientCore | https://offer.clientcore.ru | `cck_` |
| Retail Rocket | https://rrsales.clientcore.ru | `rrk_` |

Адрес API выбирается по префиксу. Старый ключ Retail Rocket с префиксом `cck_` пойдёт не на тот портал: перевыпусти его (получишь `rrk_`) или задай `CALCULATOR_BASE_URL`.

## 2. Подключи

### Claude Code

ClientCore:

```bash
claude mcp add calculator-cc \
  --env CALCULATOR_API_TOKEN=cck_ваш_ключ \
  -- npx -y github:ClientCore-CRM/calculator-mcp
```

Retail Rocket:

```bash
claude mcp add calculator-rr \
  --env CALCULATOR_API_TOKEN=rrk_ваш_ключ \
  -- npx -y github:ClientCore-CRM/calculator-mcp
```

### Claude Desktop / Cursor

`~/Library/Application Support/Claude/claude_desktop_config.json` (macOS) или `~/.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "calculator-rr": {
      "command": "npx",
      "args": ["-y", "github:ClientCore-CRM/calculator-mcp"],
      "env": { "CALCULATOR_API_TOKEN": "rrk_ваш_ключ" }
    }
  }
}
```

Перезапусти клиент после изменения конфига.

## Инструменты

### ClientCore (`cc-services`)

| Tool | Что делает |
|---|---|
| `get_catalog` | Пакеты, услуги (ключи для кастома), addons, типы оплаты |
| `create_package_kp` | КП на пакете (+ опц. `channels`, `kpiMode`, `kpiBaseline`, `addOns`, `contract12Months`, `discount`, `termMonths`) |
| `create_custom_kp` | Кастомное КП по `selections` калькулятора |
| `set_kp_logo` | Сменить логотип существующего КП по `slug` |
| `create_share_link` | Ссылка для клиента (с токеном — открытия логируются) |

Имена и параметры не менялись с `clientcore-mcp` 0.3.0: скиллы с `mcp__clientcore__create_package_kp` и т. п. работают без правок. Сделка — Bitrix24 (`bitrixDealId`).

### Retail Rocket (`rr-cdp`)

| Tool | Что делает |
|---|---|
| `kp_catalog` | Каталог движка цены установки: вкладки, ступени, модули, оплата |
| `quote_kp` | Расчёт без сохранения: услуги, итоги, НДС, интеграционный период `integration` и год с ним `year` — те же числа, что покажет КП |
| `create_kp` | Создать (или перезаписать) КП для сделки amoCRM (`dealId`); `forceNew=true` — ещё одно КП по той же сделке |
| `set_kp_logo` | Сменить логотип существующего КП по `slug` |
| `create_share_link` | Ссылка для клиента |

Интеграционный период — поле `integration` в `engineInput`: `{ months: 1-3, discountPct: 5-100 кратно 5 }`.

### Ключ не работает

Ключ отозван или портал недоступен — сервер поднимается с одним инструментом `calculator_status`, который возвращает текст ошибки портала («Токен недействителен или отозван.», «нет связи с …»).

## Переменные окружения

| Переменная | По умолчанию | |
|---|---|---|
| `CALCULATOR_API_TOKEN` | — | **обязательно**; если нет, читается прежняя `CLIENTCORE_API_TOKEN` |
| `CALCULATOR_BASE_URL` | по префиксу ключа | адрес портала: стенд, локальная разработка, старый ключ РР с `cck_` |

## Совместимость

- Репозиторий переименован из `ClientCore-CRM/clientcore-mcp`; GitHub редиректит старое имя, поэтому `npx -y github:ClientCore-CRM/clientcore-mcp` у уже подключённых продолжает работать.
- Пакет отдаёт два bin: `calculator-mcp` и `clientcore-mcp`.
- `CLIENTCORE_API_TOKEN` читается, если `CALCULATOR_API_TOKEN` не задана. Прежняя `CLIENTCORE_BASE_URL` тоже читается, если `CALCULATOR_BASE_URL` не задана.
- Имена и параметры инструментов ClientCore не изменились.

## Локальная разработка

```bash
npm install
npm test
npm run build
CALCULATOR_API_TOKEN=rrk_... CALCULATOR_BASE_URL=http://localhost:3000 npm run dev
```

## Безопасность

- Ключ даёт право создавать КП от твоего имени. Не коммить его и не передавай.
- Скомпрометирован — отзови в Настройках портала и создай новый.
