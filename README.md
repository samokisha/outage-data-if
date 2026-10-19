# outage-data-if

Графіки погодинних відключень електроенергії для Івано-Франківської області (АТ «Прикарпаттяобленерго») у машиночитному JSON та у PNG-зображеннях.

Формат даних сумісний зі схемою [Baskerville42/outage-data-ua](https://github.com/Baskerville42/outage-data-ua). Клієнти, які вже читають `data/<region>.json` з того репозиторію, можуть читати `data/ivano-frankivsk.json` без змін.

Дані оновлює GitHub Actions кожні 10 хвилин.

---

## Джерело

Публічне API, яке використовує сайт обленерго:

```
GET https://be-svitlo.oe.if.ua/schedule-by-queue?queue=<черга>
```

Черги: `1.1`, `1.2`, `2.1`, `2.2`, `3.1`, `3.2`, `4.1`, `4.2`, `5.1`, `5.2`, `6.1`, `6.2`. Запиту для всіх черг одразу немає, тому скрипт робить 12 запитів.

Приклад відповіді:

```json
[{"eventDate":"17.10.2026","queues":{"1.1":[{"shutdownHours":"10:00-12:00","from":"10:00","to":"12:00","status":1}]},"createdAt":"17.10.2026 09:48","scheduleApprovedSince":"17.10.2026 18:54"}]
```

Правила перетворення:

- `status: 1` — відключення. Інші значення скрипт ігнорує і пише попередження в лог.
- Кожна година ділиться на два слоти по 30 хв. Слот вважається «без світла», якщо відключення перекриває його щонайменше на 15 хв.
- Стан години: обидва слоти без світла — `no`; лише перший — `first`; лише другий — `second`; інакше — `yes`.
- `to` = `24:00` або `00:00` означає кінець доби (`00:00-00:00` — уся доба). Якщо `from > to`, відключення переходить через північ; скрипт обрізає його кінцем цієї доби.
- Якщо `from`/`to` відсутні, скрипт читає `shutdownHours`.
- Якщо черга відповіла успішно, але не має запису на дату, яка є в інших черг, ця черга має світло весь день.
- Порожня відповідь `[]` означає, що графік для черги не опубліковано.

---

## Формат даних

Файл: `data/ivano-frankivsk.json`. Скорочений приклад:

```json
{
  "regionId": "ivano-frankivsk",
  "regionAffiliation": "Івано-Франківська область",
  "lastUpdated": "2026-10-17T16:09:40.712Z",
  "fact": {
    "data": {
      "1792184400": {
        "GPV1.1": { "1": "yes", "2": "yes", "...": "...", "11": "no", "12": "no", "...": "...", "24": "yes" },
        "GPV1.2": { "1": "yes", "...": "..." }
      }
    },
    "update": "17.10.2026 18:54",
    "today": 1792184400
  },
  "preset": {
    "days": { "1": "Понеділок", "...": "..." },
    "days_mini": { "1": "Пн", "...": "..." },
    "sch_names": { "GPV1.1": "Черга 1.1", "...": "...", "GPV6.2": "Черга 6.2" },
    "time_zone": { "1": ["00-01", "00:00", "01:00"], "...": "..." },
    "time_type": { "yes": "Світло є", "no": "Світла немає", "first": "Світла не буде перші 30 хв.", "second": "Світла не буде другі 30 хв", "...": "..." },
    "data": {},
    "updateFact": "17.10.2026 18:54"
  },
  "lastUpdateStatus": { "status": "parsed", "ok": true, "code": 200, "message": null, "at": "2026-10-17T16:09:40.712Z", "attempt": 1 },
  "meta": { "schemaVersion": "1.0.0", "contentHash": "6f8258b9..." }
}
```

Поля:

- `fact.data` — ключ дня — Unix-час (секунди) початку доби 00:00 за `Europe/Kyiv`, з урахуванням літнього часу. Наприклад, `1792184400` — це 17.10.2026. У дні — 12 груп `GPV1.1` … `GPV6.2`, у групі — години `"1"` (00–01) … `"24"` (23–24) зі станами `yes` / `no` / `first` / `second`.
- `fact.data` містить сьогодні і, якщо обленерго вже опублікувало, завтра. Минулі дні скрипт видаляє.
- `fact.update` — `scheduleApprovedSince` (або `createdAt`, якщо його немає), найпізніший серед усіх відповідей, у форматі `DD.MM.YYYY HH:mm`.
- `fact.today` — ключ поточного дня за Києвом на момент оновлення.
- `preset` — довідники в тому ж форматі, що в outage-data-ua (`days`, `days_mini`, `sch_names`, `time_zone`, `time_type`). **Прикарпаттяобленерго не публікує тижневого шаблону, тому `preset.data` завжди `{}`.** `preset.updateFact` дорівнює `fact.update`.
- `lastUpdateStatus` — результат останнього запису: `status` (`parsed` або `error`), `ok`, `code` (HTTP-код або 503 — мережа, 504 — тайм-аут, 422 — неправильна відповідь), `message`, `at`, `attempt` (лічильник записів файлу).
- `meta.contentHash` — SHA-256 від `fact` + `preset`.

### Коли файл змінюється

Скрипт не переписує файл на кожному запуску, щоб не створювати коміт кожні 10 хвилин:

1. Усі 12 черг відповіли, хеш вмісту не змінився, попередній статус — успішний: файл не змінюється. Тому `lastUpdated` — це час останньої **зміни даних**, а не останньої перевірки.
2. Усі 12 черг відповіли, вміст змінився (або попередній статус був помилкою): файл записується повністю.
3. Хоча б одна черга не відповіла: частковий день не публікується. Скрипт зберігає попередні `fact`/`preset` і оновлює лише `lastUpdateStatus` (`status: "error"`, `ok: false`). Запис відбувається лише тоді, коли статус змінився з успішного на помилку або змінилося повідомлення. Повідомлення стабільне між запусками (кількість і список черг, що не відповіли); деталі помилок є лише в лозі. Графік не змінюється, тому зображення не перемальовуються.

Сирі відповіді API зберігаються в `raw/ivano-frankivsk.json` (поза `data/`, щоб клієнти, які перебирають `data/*.json`, не бачили зайвого файлу). Файл записується лише тоді, коли відповіді змінилися.

---

## Зображення

Зображення зберігаються не в `main`, а в окремій гілці [`images`](https://github.com/samokisha/outage-data-if/tree/images/images/ivano-frankivsk). Гілка має рівно один коміт без історії. У `main` директорія `images/` є в `.gitignore`.

### Поточні файли

Адреси постійні:

| Що показує | Файл |
|---|---|
| Група 1.1: сьогодні й завтра | [`gpv-1-1.png`](https://raw.githubusercontent.com/samokisha/outage-data-if/images/images/ivano-frankivsk/gpv-1-1.png) |
| Група 1.2: сьогодні й завтра | [`gpv-1-2.png`](https://raw.githubusercontent.com/samokisha/outage-data-if/images/images/ivano-frankivsk/gpv-1-2.png) |
| Група 2.1: сьогодні й завтра | [`gpv-2-1.png`](https://raw.githubusercontent.com/samokisha/outage-data-if/images/images/ivano-frankivsk/gpv-2-1.png) |
| Група 2.2: сьогодні й завтра | [`gpv-2-2.png`](https://raw.githubusercontent.com/samokisha/outage-data-if/images/images/ivano-frankivsk/gpv-2-2.png) |
| Група 3.1: сьогодні й завтра | [`gpv-3-1.png`](https://raw.githubusercontent.com/samokisha/outage-data-if/images/images/ivano-frankivsk/gpv-3-1.png) |
| Група 3.2: сьогодні й завтра | [`gpv-3-2.png`](https://raw.githubusercontent.com/samokisha/outage-data-if/images/images/ivano-frankivsk/gpv-3-2.png) |
| Група 4.1: сьогодні й завтра | [`gpv-4-1.png`](https://raw.githubusercontent.com/samokisha/outage-data-if/images/images/ivano-frankivsk/gpv-4-1.png) |
| Група 4.2: сьогодні й завтра | [`gpv-4-2.png`](https://raw.githubusercontent.com/samokisha/outage-data-if/images/images/ivano-frankivsk/gpv-4-2.png) |
| Група 5.1: сьогодні й завтра | [`gpv-5-1.png`](https://raw.githubusercontent.com/samokisha/outage-data-if/images/images/ivano-frankivsk/gpv-5-1.png) |
| Група 5.2: сьогодні й завтра | [`gpv-5-2.png`](https://raw.githubusercontent.com/samokisha/outage-data-if/images/images/ivano-frankivsk/gpv-5-2.png) |
| Група 6.1: сьогодні й завтра | [`gpv-6-1.png`](https://raw.githubusercontent.com/samokisha/outage-data-if/images/images/ivano-frankivsk/gpv-6-1.png) |
| Група 6.2: сьогодні й завтра | [`gpv-6-2.png`](https://raw.githubusercontent.com/samokisha/outage-data-if/images/images/ivano-frankivsk/gpv-6-2.png) |
| Усі 12 груп на сьогодні | [`gpv-all-today.png`](https://raw.githubusercontent.com/samokisha/outage-data-if/images/images/ivano-frankivsk/gpv-all-today.png) |
| Усі 12 груп на завтра. Якщо графіка ще немає, на зображенні напис «Графік на завтра ще не опубліковано» | [`gpv-all-tomorrow.png`](https://raw.githubusercontent.com/samokisha/outage-data-if/images/images/ivano-frankivsk/gpv-all-tomorrow.png) |
| Опис поточної версії зображень | [`meta.json`](https://raw.githubusercontent.com/samokisha/outage-data-if/images/images/ivano-frankivsk/meta.json) |

Дані JSON лежать у `main`:

```
https://raw.githubusercontent.com/samokisha/outage-data-if/main/data/ivano-frankivsk.json
```

### Коли зображення оновлюються

Workflow перемальовує зображення, коли змінюється видимий на них графік або шаблон. Для цього він порівнює `renderKey` поточного запуску з `renderKey` у `meta.json` гілки `images`.

- `renderKey` — SHA-256 від канонічного JSON (ключі відсортовані) таких даних: графіки з `fact.data`, які видно на зображеннях (дні від поточної доби за `Europe/Kyiv`; кожен день — як зсув від сьогодні: 0 — сьогодні, 1 — завтра), без самих дат; вміст `templates/html/*` і `scripts/lib/views.mjs`; slug репозиторію.
- Опівночі зображення перемальовуються лише тоді, коли видимий графік змінився. Приклад: графік на завтра став графіком на сьогодні, або графік на сьогодні зник. Якщо графіка немає ні до, ні після півночі, зображення лишаються з попередньою датою.
- Workflow також перемальовує зображення, коли гілки `images`, `meta.json` або `renderKey` немає, або коли задано `force_render`.
- `fact.update`, `lastUpdated` і `lastUpdateStatus` на `renderKey` не впливають. Якщо обленерго змінило лише час затвердження, зображення не перемальовуються. Рядок «Оновлено: …» на зображенні показує `fact.update` на момент останнього рендеру.

### Архів попередніх версій

1. Перед публікацією нової версії workflow копіює поточний коміт `images` у гілку `images-YYYYMMDD-HHMM`. Час — дата коміту за `Europe/Kyiv`. Якщо така назва вже є, workflow додає `-2`, `-3` і так далі.
2. Потім workflow замінює `images` новим orphan-комітом (`--force-with-lease`).
3. Гілки `images-YYYYMMDD-HHMM` старші за 30 днів workflow видаляє. Інших гілок він не торкається.

Список архівних версій: [гілки репозиторію](https://github.com/samokisha/outage-data-if/branches/all?query=images-).

### meta.json

```json
{
  "regionId": "ivano-frankivsk",
  "renderedAt": "2026-10-17T16:42:48.870Z",
  "scheduleUpdate": "17.10.2026 18:54",
  "scheduleHash": "fe4917b2...",
  "renderKey": "481f0613...",
  "sourceRepo": "https://github.com/samokisha/outage-data-if",
  "files": { "gpv-1-1.png": { "sha256": "9f3c605d...", "bytes": 92882 } }
}
```

- `renderedAt` — час рендеру (ISO 8601, UTC).
- `scheduleUpdate` — `fact.update` на момент рендеру.
- `scheduleHash` — SHA-256 від канонічного JSON лише `fact.data`. Він змінюється тільки тоді, коли змінився сам графік.
- `renderKey` — ключ рендеру (див. вище). Workflow порівнює саме його.
- `files` — SHA-256 і розмір кожного PNG після стиснення.

### Як дізнатися про оновлення

- Читайте `meta.json` і порівнюйте `renderKey` (або `renderedAt`) з попереднім значенням. Завантажуйте PNG лише тоді, коли значення змінилося. Якщо вас цікавить лише зміна графіка, порівнюйте `scheduleHash`.
- Або надсилайте запит з `If-None-Match` і порівнюйте `ETag`. Відповідь `304` означає, що файл не змінився.
- `raw.githubusercontent.com` не повертає `Last-Modified` і кешує файли приблизно на 5 хвилин. Нова версія може зʼявитися із затримкою до 5 хвилин.

### Як рендеряться

Зображення рендерить Chromium (Playwright) з шаблону `templates/html/schedule.html`, масштаб 2×. Шрифти: `Arimo, "Liberation Sans", Arial, sans-serif`, без завантаження з мережі (на Ubuntu-раннерах є Liberation Sans, метрично ідентичний Arimo). Іконки — вбудований SVG. Після рендеру PNG стискає `pngquant`. Внизу кожного зображення є рядок джерела: «Дані: АТ «Прикарпаттяобленерго» · github.com/samokisha/outage-data-if». Slug репозиторію береться з `GITHUB_REPOSITORY`; без цієї змінної — `samokisha/outage-data-if`.

---

## Як працює конвеєр

Workflow `.github/workflows/update.yml`:

1. Запуск за розкладом `*/10 * * * *` або вручну (`workflow_dispatch`, параметр `force_render` — перемалювати зображення навіть без зміни графіка).
2. `npm ci`.
3. `node scripts/fetch_if.mjs` — 12 запитів (тайм-аут, 3 повтори з наростаючою паузою, браузерний User-Agent), побудова JSON, правило змін. Вихід кроку `changed` означає, що є що комітити в `main`.
4. Workflow читає `images/ivano-frankivsk/meta.json` з гілки `images` (`git fetch --depth=1 origin images`).
5. `node scripts/need_render.mjs` порівнює `renderKey` і пише в лог причину рішення. Він також фіксує момент рендеру (`now_ms`), який далі отримують `render.mjs` і `write_meta.mjs`.
6. Якщо треба рендерити: встановлення Chromium, `node scripts/render.mjs`, стиснення `pngquant`, `node scripts/write_meta.mjs`.
7. Коміт `chore: update Ivano-Frankivsk schedule` (лише `data/` і `raw/`) від `github-actions[bot]` у `main` і push з повторами та rebase.
8. `scripts/publish_images.sh origin` архівує попередню версію, публікує новий orphan-коміт `images: schedule <fact.update>` у гілку `images` і видаляє архіви старші за 30 днів. Помилка видалення архівів дає лише попередження. Публікація йде після коміту даних, тому її помилка не блокує оновлення `data/`.

Обмеження:

- GitHub не гарантує точний час запуску за cron. Під навантаженням запуски затримуються на 5–20 хв або пропускаються.
- API може блокувати IP-адреси не з України (зокрема адреси GitHub-раннерів). Перший запуск у GitHub Actions це покаже: у такому разі в `lastUpdateStatus` буде `status: "error"`, а попередні дані залишаться без змін.
- Якщо API недоступне довго, дані й зображення не оновлюються, зокрема після півночі.

---

## Локальний запуск

Потрібен Node.js 22 або новіший (CI використовує Node.js 24).

```bash
npm install
npx playwright install chromium
npm test          # юніт-тести (node:test)
npm run fetch     # оновити data/ і raw/
npm run render    # оновити images/ivano-frankivsk/ (локально, у git не потрапляє)
node scripts/write_meta.mjs                # записати meta.json для зображень
scripts/publish_images.sh <remote>         # опублікувати гілку images у будь-який git remote
```

Структура:

- `scripts/lib/convert.mjs` — чиста логіка перетворення (інтервали → години, ключі днів, `fact`, `preset`, хеш).
- `scripts/lib/state.mjs` — правило, коли записувати файл.
- `scripts/lib/views.mjs` — дані для кожного зображення.
- `scripts/lib/images_meta.mjs` — `scheduleHash`, `renderKey`, рішення про рендер, `meta.json`, slug репозиторію.
- `scripts/lib/cli.mjs` — спільні хелпери точок входу (аргументи, `GITHUB_OUTPUT`, файли шаблону).
- `scripts/lib/renderer.mjs` — статичний сервер і знімок через Playwright.
- `scripts/fetch_if.mjs`, `scripts/render.mjs`, `scripts/need_render.mjs`, `scripts/write_meta.mjs` — точки входу.
- `scripts/publish_images.sh` — публікація й ротація гілки `images`.
- `templates/html/` — шаблон, стилі та скрипт сторінки для рендеру.
- `tests/*.test.mjs` — тести.

---

## Участь у проєкті

- Як долучитися: [CONTRIBUTING.md](CONTRIBUTING.md).
- Розбіжність з графіком обленерго: [створіть issue](https://github.com/samokisha/outage-data-if/issues/new/choose).
- Вразливість: [SECURITY.md](SECURITY.md).
- [Кодекс поведінки](CODE_OF_CONDUCT.md).

## Подяки

Ідея, схема JSON і підхід до рендеру взяті з [Baskerville42/outage-data-ua](https://github.com/Baskerville42/outage-data-ua) (MIT). Цей репозиторій — окремий проєкт, не форк.

## Ліцензія

[MIT](LICENSE) © 2026 Anatoly Samokisha.

Дані належать АТ «Прикарпаттяобленерго» і беруться з публічного джерела. Репозиторій не претендує на право власності на первинні дані. Офіційну інформацію перевіряйте на сайті обленерго.
