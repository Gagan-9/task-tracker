import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { exec } from 'child_process';
import dotenv from 'dotenv';
import db, { initDatabase } from './src/config/database.js';
import { runSync, saveSetting } from './src/services/syncService.js';
import { generateMonthlyExcelReport } from './src/services/excelService.js';
import { notifyUser } from './src/utils/notifier.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.resolve(__dirname, '../.env') });

const reportsDir = path.resolve(__dirname, '../Reports');
if (!fs.existsSync(reportsDir)) {
  fs.mkdirSync(reportsDir, { recursive: true });
}

function openExcelFile(filePath) {
  const command = `start "" "${filePath}"`;
  exec(command, { shell: 'cmd.exe' });
}

async function main() {
  initDatabase();

  let token = process.env.CLICKUP_API_TOKEN;
  if (!token) {
    const row = db.prepare("SELECT value FROM settings WHERE key = 'clickup_api_token'").get();
    if (row && row.value) token = row.value;
  }

  if (!token || token.startsWith('pk_replace_')) {
    console.log('⚠️  Please add your ClickUp API token in .env');
    notifyUser('ClickUp Tracker', 'Please add your ClickUp API token in .env', 'warning', 5);
    process.exit(1);
  }

  saveSetting('clickup_api_token', token.trim());

  process.stdout.write('⚡ Syncing ClickUp tasks...');

  try {
    const syncResult = await runSync({ forceToken: token });

    const now = new Date();
    const currentMonth = now.toISOString().substring(0, 7);
    const monthNames = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
    const currentMonthName = monthNames[now.getMonth()];
    const reportFileName = `ClickUp_Tasks_${currentMonthName}_${now.getFullYear()}.xlsx`;
    const reportFilePath = path.join(reportsDir, reportFileName);

    const buffer = await generateMonthlyExcelReport(currentMonth);
    fs.writeFileSync(reportFilePath, Buffer.from(buffer));

    // Stats for notification
    const monthStats = db.prepare(`
      SELECT 
        COUNT(*) as total,
        SUM(CASE WHEN current_assignee_is_me = 0 THEN 1 ELSE 0 END) as handed_to_tester,
        SUM(CASE WHEN date_closed IS NOT NULL OR LOWER(status) IN ('closed', 'done', 'complete') THEN 1 ELSE 0 END) as completed
      FROM tasks t
      INNER JOIN task_assignment_history h ON t.id = h.task_id
      WHERE h.assigned_month = ?
    `).get(currentMonth);

    const total = monthStats.total || 0;
    const handedToTester = monthStats.handed_to_tester || 0;
    const completed = monthStats.completed || 0;

    openExcelFile(reportFilePath);

    console.log(` Done! (${total} tasks recorded)`);

    const alertMessage = `✅ Sync Complete!\n\n• ${total} tasks for ${currentMonthName}\n• ${handedToTester} passed to QA\n• ${completed} completed\n\nExcel report opened.`;
    notifyUser('ClickUp Task Tracker', alertMessage, 'info', 4);
  } catch (err) {
    const errMsg = err.response?.data?.err || err.response?.data?.message || err.message;
    console.log(`\n❌ Error: ${errMsg}`);
    notifyUser('Sync Failed', errMsg, 'error', 5);
    process.exit(1);
  }
}

main();
