/**
 * One-shot: notify Kirill that the revenue kit is ready.
 * Run once, then delete this file.
 */
import { tgSendToKirill } from "./orchestrator.mjs";

const msg = `<b>Revenue Kit готов - апрель 19</b>

Ниша: Vibe-coded SaaS founders (Cursor/Lovable/Bolt) с реальными юзерами и реальными багами
Оффер: Vibe Code Audit - $1,500-2,500 CAD

<b>Лид #1 ГОТОВ К ОТПРАВКЕ ПРЯМО СЕЙЧАС:</b>
Joe - breezepdf.com
Email: joe@breezepdf.com
Баг подтвержден в HN треде: redaction tool не удаляет контент из файла, только накладывает прямоугольник сверху - в продукте чья основная фишка "privacy". Письмо с готовым текстом в sandbox-review/outreach-joe-breezepdf.md

<b>Leads 2-10:</b> 30-минутный мануальный хант с готовыми ссылками и шаблонами - в sandbox-review/revenue-kit-apr19.md

Один файл открываешь - сразу понятно что делать.`;

await tgSendToKirill(msg);
console.log("Sent.");
process.exit(0);
