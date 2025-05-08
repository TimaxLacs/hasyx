# Hasyx контрибьюшн

Этот проект создан для обеспечения готовой инфраструктуры для различных веб-приложений. Мы приглашаем всех желающих вносить свой вклад в развитие проекта через issue, pull request, или предложения по улучшению. Данный файл дублируется в ваш проект при инициализации.

## Практика разработки проектов на базе Hasyx и самого Hasyx проекта

### Структура проекта

Hasyx следует определенной структуре директорий, которая помогает организовать код эффективно и поддерживать чистую кодовую базу:

- **lib**: Эта директория предназначена для кода, который может быть импортирован как из проекта, так и из npm-пакета, если он будет опубликован. Вся бизнес-логика, утилиты и общий код должны размещаться здесь. GitHub Actions для автоматической публикации пакета при изменении версии в package.json уже настроены.

- **components**: Содержит готовые компоненты пользовательского интерфейса, включая все компоненты shadcn/ui.

- **hooks**: Содержит пользовательские React-хуки, которые можно повторно использовать в приложении.

- **app**: Соответствует структуре Next.js App Router, где находятся компоненты страниц и маршрутизация.

- **migrations**: Содержит скрипты миграции для настройки базы данных Hasura.

### Компоненты shadcn/ui

В проекте Hasyx уже интегрированы все компоненты библиотеки shadcn/ui, доступные через импорт из `components/ui`. Вот полный список доступных компонентов:

- Accordion (`accordion.tsx`)
- Alert (`alert.tsx`)
- AlertDialog (`alert-dialog.tsx`)
- AspectRatio (`aspect-ratio.tsx`)
- Avatar (`avatar.tsx`)
- Badge (`badge.tsx`)
- Breadcrumb (`breadcrumb.tsx`)
- Button (`button.tsx`)
- Calendar (`calendar.tsx`)
- Card (`card.tsx`)
- Carousel (`carousel.tsx`)
- Checkbox (`checkbox.tsx`)
- Chart (`chart.tsx`)
- Collapsible (`collapsible.tsx`)
- Command (`command.tsx`)
- ContextMenu (`context-menu.tsx`)
- Dialog (`dialog.tsx`)
- Drawer (`drawer.tsx`)
- DropdownMenu (`dropdown-menu.tsx`)
- Form (`form.tsx`)
- HoverCard (`hover-card.tsx`)
- Input (`input.tsx`)
- InputOTP (`input-otp.tsx`)
- Label (`label.tsx`)
- Menubar (`menubar.tsx`)
- NavigationMenu (`navigation-menu.tsx`)
- Pagination (`pagination.tsx`)
- Popover (`popover.tsx`)
- Progress (`progress.tsx`)
- RadioGroup (`radio-group.tsx`)
- Resizable (`resizable.tsx`)
- ScrollArea (`scroll-area.tsx`)
- Select (`select.tsx`)
- Separator (`separator.tsx`)
- Sheet (`sheet.tsx`)
- Sidebar (`sidebar.tsx`)
- Skeleton (`skeleton.tsx`)
- Slider (`slider.tsx`)
- Sonner (`sonner.tsx`)
- Switch (`switch.tsx`)
- Table (`table.tsx`)
- Tabs (`tabs.tsx`)
- Textarea (`textarea.tsx`)
- ToggleGroup (`toggle-group.tsx`)
- Toggle (`toggle.tsx`)
- Tooltip (`tooltip.tsx`)

Для поддержки тем используйте классы, предоставляемые Tailwind CSS, такие как `text-muted-foreground`, `bg-muted`, `hovered` и т.п.

### Важные особенности

1. **Зависимости**: Проект на базе Hasyx уже включает в себя все необходимые зависимости, такие как:
   - Next.js (для фронтенда и API-маршрутов)
   - Tailwind CSS (для стилизации)
   - Apollo Client (для GraphQL запросов)
   - Hasura (как графический интерфейс для PostgreSQL)
   - NextAuth.js (для аутентификации)
   - shadcn/ui (для компонентов UI)
   - и другие важные библиотеки

2. **GraphQL запросы**: Используйте генератор запросов Hasyx и клиент Hasyx вместо прямых GraphQL запросов для более типобезопасного и удобного API.

3. **Аутентификация**: Используйте интегрированную систему аутентификации на базе NextAuth.js с поддержкой JWT и различных провайдеров (Google, Yandex, Email и др.).

4. **Разработка и деплоймент**: Используйте CLI команды `hasyx dev`, `hasyx build`, `hasyx start` для разработки и деплоймента. Для переключения между локальной разработкой и Vercel используйте команды `hasyx local` и `hasyx vercel`.

5. **CI/CD**: В проекте уже настроены GitHub Actions для тестирования, сборки, деплоя и публикации пакета.

## Лучшие практики для ИИ-ассистентов при работе с проектами на базе Hasyx

Если вы ИИ-ассистент, работающий с проектом на базе Hasyx, обратите внимание на следующие моменты:

1. **Импорты UI компонентов**: Всегда импортируйте компоненты UI из `components/ui`, например: `import { Button } from "components/ui/button"`.

2. **Отсутствующие зависимости**: Не беспокойтесь, если в package.json проекта не видны некоторые зависимости, такие как tailwind, next и другие - они наследуются из базового пакета hasyx.

3. **Структура API**: Используйте Next.js App Router для API маршрутов в `/app/api/...`.

4. **hasyx/lib**: Используйте готовые функции и классы из `hasyx/lib` для работы с аутентификацией, GraphQL запросами и т.д.

5. **Авторизация в Hasura**: При создании запросов используйте роли (`role: 'user'`, `role: 'me'`, `role: 'admin'`) для правильной работы с разрешениями.

6. **WebSocket поддержка**: WebSocket поддержка уже настроена для GraphQL подписок, но может быть отключена в среде Vercel с помощью настройки `NEXT_PUBLIC_WS=0`.

7. **Стили и темы**: Используйте классы Tailwind CSS и темные/светлые варианты (с помощью next-themes).

## Развертывание и конфигурация

1. **Начальная настройка**: Используйте `npx hasyx init` для начальной настройки проекта, `npx hasyx assist` для настройки GitHub, Hasura и Vercel интеграций.

2. **Миграции**: Для создания и применения миграций базы данных используйте `npx hasyx migrate` и `npx hasyx unmigrate`.

3. **Переменные окружения**: Настройте необходимые переменные окружения в файле `.env` (Hasura, NextAuth, OAuth провайдеры, Vercel URL и т.д.).

4. **URL переключение**: Для быстрого переключения между локальной разработкой и Vercel используйте `npx hasyx local` и `npx hasyx vercel`.

## Вклад в проект

Мы приветствуем любой вклад в проект, будь то исправление ошибок, добавление новых функций или улучшение документации:

1. Форкните репозиторий
2. Создайте ветку для вашей фичи или исправления (`git checkout -b feature/amazing-feature`)
3. Внесите изменения и зафиксируйте их (`git commit -m 'Add amazing feature'`)
4. Отправьте изменения в ваш форк (`git push origin feature/amazing-feature`)
5. Создайте Pull Request

## Отчеты об ошибках и предложения

Если вы нашли ошибку или у вас есть предложения по улучшению, пожалуйста, создайте issue в репозитории проекта.

## Работа с Hasyx клиентом (hasyx.ts)

Одним из главных преимуществ Hasyx является простой и типобезопасный способ взаимодействия с Hasura GraphQL API через специальный клиент, описанный в `hasyx.ts`.

### Философия "что пишешь, то и получаешь"

Основной принцип работы Hasyx клиента: вы описываете структуру запроса и получаете именно те данные, которые запросили, без необходимости извлекать их из сложных вложенных объектов результата.

Вместо того, чтобы писать сложные GraphQL запросы вручную и затем извлекать данные из результата по имени таблицы, Hasyx предоставляет интуитивный API, который:

1. Автоматически генерирует правильный GraphQL запрос из вашего описания
2. Выполняет этот запрос через Apollo Client
3. Извлекает данные из ответа и возвращает их напрямую

### Основные функции

Клиент Hasyx предоставляет следующие основные методы:

```typescript
// Получение экземпляра клиента
const client = useClient();

// Выборка данных
const userData = await client.select({
  table: 'users',
  returning: ['id', 'name', 'email'],
  where: { id: { _eq: userId } }
});

// Добавление данных
const newUser = await client.insert({
  table: 'users',
  object: { name: 'New User', email: 'new@example.com' },
  returning: ['id']
});

// Обновление данных
const updatedUser = await client.update({
  table: 'users',
  where: { id: { _eq: userId } },
  _set: { name: 'Updated Name' },
  returning: ['id', 'name']
});

// Удаление данных
const deletedUser = await client.delete({
  table: 'users',
  where: { id: { _eq: userId } },
  returning: ['id']
});

// Подписка на изменения
const subscription = client.subscribe({
  table: 'users',
  returning: ['id', 'name', 'updated_at'],
  where: { id: { _eq: userId } }
});
```

### React-хуки

Для использования в React-компонентах Hasyx предоставляет удобные хуки:

```typescript
// Для запросов
const { data, loading, error } = useQuery({
  table: 'users',
  returning: ['id', 'name', 'email'],
  where: { active: { _eq: true } },
  limit: 10
});

// Для подписок (реального времени)
const { data, loading, error } = useSubscription({
  table: 'todos',
  returning: ['id', 'title', 'completed'],
  where: { user_id: { _eq: currentUserId } },
  order_by: { created_at: 'desc' }
});
```

### Преимущества использования Hasyx клиента

1. **Простота**: Нет необходимости писать и поддерживать сложные GraphQL запросы.
2. **Типобезопасность**: Автоматически выведенные типы без необходимости явного указания генериков.
3. **Прямой доступ к данным**: Результаты возвращаются напрямую, без необходимости извлекать их из вложенных объектов.
4. **Автоматизированное управление JWT**: Корректная передача JWT токенов и ролей пользователей.
5. **Поддержка WebSocket**: Автоматическое использование WebSocket для подписок с полноценным резервным механизмом.

Подробная документация о возможностях Hasyx клиента доступна в файле `HASYX.md`.

## Работа с миграциями

При разработке проекта на базе Hasyx часто возникает необходимость управлять структурой базы данных и ее изменениями. Для этого используется система миграций.

### Создание новой миграции

Рекомендуемый формат организации миграций:

```
migrations/
  ├── 1746660891582-hasyx-users/   <-- Timestamp + название миграции
  │   ├── up.ts                    <-- Скрипт для применения миграции
  │   └── down.ts                  <-- Скрипт для отката миграции
  ├── 1746660892123-add-posts/
  │   ├── up.ts
  │   └── down.ts
  └── ...
```

Где:
- Timestamp (например, `1746660891582`) - метка времени создания миграции, обеспечивающая правильный порядок выполнения
- Название миграции (например, `hasyx-users` или `add-posts`) - краткое описание цели миграции

### Создание файлов up.ts и down.ts

В каждой папке миграции должны быть два файла:

1. **up.ts** - содержит код для применения миграции (создание таблиц, добавление столбцов и т.д.)
2. **down.ts** - содержит код для отката миграции (удаление таблиц, удаление столбцов и т.д.)

Пример содержимого файла `up.ts`:

```typescript
import { Hasura } from 'hasyx/lib/hasura';

export async function up(customHasura?: Hasura) {
  console.log('🚀 Starting migration UP...');
  
  // Использовать предоставленный экземпляр Hasura или создать новый
  const hasura = customHasura || new Hasura({
    url: process.env.NEXT_PUBLIC_HASURA_GRAPHQL_URL!, 
    secret: process.env.HASURA_ADMIN_SECRET!,
  });
  
  try {
    // SQL для создания таблиц
    await hasura.sql(`
      CREATE TABLE IF NOT EXISTS public.posts (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        title TEXT NOT NULL,
        content TEXT,
        user_id UUID REFERENCES public.users(id),
        created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
    `);
    
    // Отслеживание таблиц в Hasura
    await hasura.v1({
      type: 'pg_track_table',
      args: {
        source: 'default',
        schema: 'public',
        name: 'posts'
      }
    });
    
    // Создание отношений
    await hasura.v1({
      type: 'pg_create_object_relationship',
      args: {
        source: 'default',
        table: { schema: 'public', name: 'posts' },
        name: 'user',
        using: {
          foreign_key_constraint_on: 'user_id'
        }
      }
    });
    
    // Настройка разрешений
    await hasura.v1({
      type: 'pg_create_select_permission',
      args: {
        source: 'default',
        table: { schema: 'public', name: 'posts' },
        role: 'user',
        permission: {
          columns: ['id', 'title', 'content', 'created_at', 'updated_at'],
          filter: {}
        }
      }
    });
    
    console.log('✨ Migration UP completed successfully!');
    return true;
  } catch (error) {
    console.error('❗ Critical error during UP migration:', error);
    return false;
  }
}
```

Пример содержимого файла `down.ts`:

```typescript
import { Hasura } from 'hasyx/lib/hasura';

export async function down(customHasura?: Hasura) {
  console.log('🚀 Starting migration DOWN...');
  
  const hasura = customHasura || new Hasura({
    url: process.env.NEXT_PUBLIC_HASURA_GRAPHQL_URL!, 
    secret: process.env.HASURA_ADMIN_SECRET!,
  });
  
  try {
    // Удаление таблицы
    await hasura.sql('DROP TABLE IF EXISTS public.posts CASCADE;');
    
    console.log('✨ Migration DOWN completed successfully!');
    return true;
  } catch (error) {
    console.error('❗ Critical error during DOWN migration:', error);
    return false;
  }
}
```

### Применение и откат миграций

Для применения всех миграций в алфавитном порядке:

```bash
npx hasyx migrate
```

Для отката всех миграций в обратном алфавитном порядке:

```bash
npx hasyx unmigrate
```

Важно: миграции выполняются последовательно, поэтому рекомендуется следить за согласованностью структуры базы данных между миграциями.

### Event Triggers

При работе с миграциями нет необходимости настраивать Event Triggers (триггеры событий) внутри кода миграций. Event Triggers управляются отдельно через систему `events` директории.

После создания или изменения файлов определений триггеров в директории `events/<event-name>.json` просто выполните:

```bash
npx hasyx events
```

Это команда синхронизирует все триггеры с Hasura, добавляя необходимые заголовки безопасности и настраивая их в соответствии с определениями. 