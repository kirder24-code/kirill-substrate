#!/usr/bin/env node
/**
 * send-cortex-self-description.mjs
 * Sends two Telegram posts:
 * Post 1 - PURPOSE: для чего построена CORTEX
 * Post 2 - Architecture + uniqueness, with reference to full file
 */

import { tgSendToKirill } from "./orchestrator.mjs";

const MAX = 4096;

const POST1 = `<b>CORTEX: ДЛЯ ЧЕГО ОНА ПОСТРОЕНА</b>

CORTEX построена для одного: закрывать сделки.

Не для автоматизации ради автоматизации. Не для демонстрации архитектуры. Не для того, чтобы выглядеть умной.

Конкретная задача: продать 7 AI-сервисных пакетов ($1,500-$10,000 CAD) соло-фаундерам в Канаде, которые строят свои первые 10 клиентов и задыхаются от ручной операционки.

Справочная точка провала: апрель 17-19, 2026 - 27 ботов, $0 выручки, 0 закрытых сделок. CORTEX была занята строительством систем, которые строят системы. Это - эталон того, что НЕ должно происходить.

Единственный измеритель успеха: закрытая сделка. Не цикл оркестратора. Не число модулей. Не красота архитектуры.

Сейчас: 73,000+ лидов в БД. 0 конверсий. Один приоритет - превратить лиды в первый разговор.`.trim();

const POST2 = `<b>CORTEX: КАК РАБОТАЕТ + ЗА СЧЕТ ЧЕГО УНИКАЛЬНА</b>

58 модулей, 8 слоев, петля каждые 5 минут, 24/7.

<b>Слои:</b>
- 0: Восприятие (state-bus, чат-сервер)
- 1: Память (SQLite, 4 типа, нарративные дуги)
- 2: Мышление (Deep Think: Планировщик-Критик-Резольвер)
- 3: Самосознание (Identity, Introspection, Conscious Doctor)
- 4: Опыт (Emotions, Intuition, Dissonance, Dreams)
- 5: Автономия (Attention, Initiative, Strategy Enforcer)
- 6: Исполнение (HANDS - Claude CLI subprocess, реальный код)
- 7: Мета-улучшение (Self-Healing, Evolution Engine, Night Cycle)

<b>Что отличает от других:</b>

1. Живая петля - не по расписанию. Читает себя, сравнивает с целью, корректирует.
2. HANDS - реальное исполнение. Меняет файлы и код без человека в петле.
3. Память через сессии - 27 файлов состояния + SQLite. Не начинает с нуля.
4. Двойная роль - launchsoloai.com это и бизнес, и живое доказательство что система продаётся.

HANDS за 24ч: 50 запусков, 48 успешных (96%).
Выручка: $0. Это и есть задача.

<i>Полная версия: sandbox-review/cortex-self-description.md</i>`.trim();

async function sendPost(label, text) {
  if (text.length > MAX) {
    await tgSendToKirill(text.slice(0, MAX));
    console.log(`${label} sent (truncated to ${MAX})`);
  } else {
    await tgSendToKirill(text);
    console.log(`${label} sent (${text.length} chars)`);
  }
}

async function main() {
  await sendPost("POST1 (PURPOSE)", POST1);
  // small delay between messages
  await new Promise(r => setTimeout(r, 1000));
  await sendPost("POST2 (ARCHITECTURE)", POST2);
  console.log("Done.");
}

main().catch(e => { console.error(e); process.exit(1); });
