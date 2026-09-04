import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import db from '../config/database.js';
import { createClickUpClient } from './clickup.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function msToIso(msString) {
  if (!msString) return null;
  const num = parseInt(msString, 10);
  if (isNaN(num)) return null;
  return new Date(num).toISOString();
}

function getSettingsMap() {
  const rows = db.prepare('SELECT key, value FROM settings').all();
  const map = {};
  for (const row of rows) {
    map[row.key] = row.value;
  }
  return map;
}

export function saveSetting(key, value) {
  const stmt = db.prepare(`
    INSERT INTO settings (key, value)
    VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `);
  stmt.run(key, value);
}

function extractTaskId(text) {
  if (!text) return null;
  const clean = text.trim();
  // Handle full URL like https://app.clickup.com/t/86d3vccau
  const match = clean.match(/\/t\/([a-zA-Z0-9]+)/);
  if (match) return match[1];
  // Handle plain ID
  if (/^[a-zA-Z0-9_-]+$/.test(clean)) return clean;
  return null;
}

export async function runSync({ forceToken, forceUserId, forceTeamId } = {}) {
  const nowIso = new Date().toISOString();
  const currentMonth = nowIso.substring(0, 7); // 'YYYY-MM'
  const currentDate = nowIso.substring(0, 10); // 'YYYY-MM-DD'

  const settings = getSettingsMap();
  const token = forceToken || settings.clickup_api_token;
  let userId = forceUserId || settings.clickup_user_id;
  let teamId = forceTeamId || settings.clickup_team_id;

  if (!token) {
    throw new Error('ClickUp API Token is not configured. Please add your token to the .env file.');
  }

  const client = createClickUpClient(token);

  // Auto-detect User ID and Team ID if not saved yet
  if (!userId) {
    const user = await client.getCurrentUser();
    userId = String(user.id);
    saveSetting('clickup_user_id', userId);
    saveSetting('clickup_user_name', user.username || user.email);
  }

  if (!teamId) {
    const teams = await client.getTeams();
    if (teams && teams.length > 0) {
      teamId = String(teams[0].id);
      saveSetting('clickup_team_id', teamId);
      saveSetting('clickup_team_name', teams[0].name);
    } else {
      throw new Error('No ClickUp Workspace/Team found for this API token.');
    }
  }

  // 1. Fetch all tasks CURRENTLY assigned to me from ClickUp
  const remoteTasks = await client.getTasksAssignedToUser({ teamId, userId });

  // 2. Check for optional backfill tasks in "past-tasks.txt"
  const pastTasksFile = path.resolve(__dirname, '../../../past-tasks.txt');
  let backfilledTasks = [];
  if (fs.existsSync(pastTasksFile)) {
    const content = fs.readFileSync(pastTasksFile, 'utf8');
    const lines = content.split(/\r?\n/).map(l => l.trim()).filter(l => l && !l.startsWith('#'));
    
    for (const line of lines) {
      const id = extractTaskId(line);
      if (id) {
        try {
          const taskData = await client.getTaskById(id);
          if (taskData && taskData.id) {
            // Check if current assignees still include me
            const isCurrentlyMe = taskData.assignees && taskData.assignees.some(a => String(a.id) === String(userId));
            taskData._isCurrentlyMe = isCurrentlyMe;
            taskData._isBackfill = true;
            backfilledTasks.push(taskData);
          }
        } catch (err) {
          console.log(`⚠️ Note: Could not backfill task ${id}: ${err.message}`);
        }
      }
    }
  }

  let tasksAdded = 0;
  let tasksUpdated = 0;
  const remoteTaskIds = new Set();

  const insertTaskStmt = db.prepare(`
    INSERT INTO tasks (
      id, name, url, status, status_color,
      date_created, date_updated, date_closed,
      first_seen_assigned, last_seen_assigned, current_assignee_is_me
    ) VALUES (
      ?, ?, ?, ?, ?,
      ?, ?, ?,
      ?, ?, ?
    )
  `);

  const updateTaskStmt = db.prepare(`
    UPDATE tasks SET
      name = ?,
      url = ?,
      status = ?,
      status_color = ?,
      date_updated = ?,
      date_closed = ?,
      last_seen_assigned = ?,
      current_assignee_is_me = ?
    WHERE id = ?
  `);

  const checkTaskStmt = db.prepare('SELECT id FROM tasks WHERE id = ?');

  const insertHistoryStmt = db.prepare(`
    INSERT OR IGNORE INTO task_assignment_history (task_id, assigned_month, assigned_date)
    VALUES (?, ?, ?)
  `);

  const transaction = db.transaction((tasks, backfills) => {
    // Process currently assigned tasks
    for (const task of tasks) {
      remoteTaskIds.add(task.id);

      const statusName = task.status ? (typeof task.status === 'object' ? task.status.status : task.status) : 'unknown';
      const statusColor = task.status && typeof task.status === 'object' ? task.status.color : '#888888';
      const dateCreatedIso = msToIso(task.date_created) || nowIso;
      const dateUpdatedIso = msToIso(task.date_updated) || nowIso;
      const dateClosedIso = msToIso(task.date_closed || task.date_done);

      const existing = checkTaskStmt.get(task.id);

      if (existing) {
        updateTaskStmt.run(
          task.name,
          task.url,
          statusName,
          statusColor,
          dateUpdatedIso,
          dateClosedIso,
          nowIso,
          1,
          task.id
        );
        tasksUpdated++;
      } else {
        insertTaskStmt.run(
          task.id,
          task.name,
          task.url,
          statusName,
          statusColor,
          dateCreatedIso,
          dateUpdatedIso,
          dateClosedIso,
          nowIso,
          nowIso,
          1
        );
        tasksAdded++;
      }

      // Record in immutable history ledger for this month
      insertHistoryStmt.run(task.id, currentMonth, currentDate);
    }

    // Process backfilled tasks (tasks already handed over to tester before this tracker was created)
    for (const task of backfills) {
      const isCurrentlyMe = task._isCurrentlyMe ? 1 : 0;
      const statusName = task.status ? (typeof task.status === 'object' ? task.status.status : task.status) : 'unknown';
      const statusColor = task.status && typeof task.status === 'object' ? task.status.color : '#888888';
      const dateCreatedIso = msToIso(task.date_created) || nowIso;
      const dateUpdatedIso = msToIso(task.date_updated) || nowIso;
      const dateClosedIso = msToIso(task.date_closed || task.date_done);
      const taskMonth = dateCreatedIso ? dateCreatedIso.substring(0, 7) : currentMonth;
      const taskDate = dateCreatedIso ? dateCreatedIso.substring(0, 10) : currentDate;

      const existing = checkTaskStmt.get(task.id);

      if (existing) {
        updateTaskStmt.run(
          task.name,
          task.url,
          statusName,
          statusColor,
          dateUpdatedIso,
          dateClosedIso,
          nowIso,
          isCurrentlyMe,
          task.id
        );
        tasksUpdated++;
      } else {
        insertTaskStmt.run(
          task.id,
          task.name,
          task.url,
          statusName,
          statusColor,
          dateCreatedIso,
          dateUpdatedIso,
          dateClosedIso,
          dateCreatedIso,
          nowIso,
          isCurrentlyMe
        );
        tasksAdded++;
      }

      insertHistoryStmt.run(task.id, taskMonth, taskDate);
    }

    // For any task in DB that was NOT returned in currently assigned list,
    // mark current_assignee_is_me = 0 (handed over to tester/QA/etc.),
    // BUT DO NOT delete the task or history!
    const allDbTasks = db.prepare('SELECT id FROM tasks WHERE current_assignee_is_me = 1').all();
    const markHandedOverStmt = db.prepare('UPDATE tasks SET current_assignee_is_me = 0 WHERE id = ?');

    for (const dbTask of allDbTasks) {
      if (!remoteTaskIds.has(dbTask.id)) {
        markHandedOverStmt.run(dbTask.id);
      }
    }
  });

  transaction(remoteTasks, backfilledTasks);

  // Log sync result
  const logStmt = db.prepare(`
    INSERT INTO sync_logs (synced_at, tasks_found, tasks_added, tasks_updated, status)
    VALUES (?, ?, ?, ?, 'SUCCESS')
  `);
  logStmt.run(nowIso, remoteTasks.length + backfilledTasks.length, tasksAdded, tasksUpdated);

  return {
    success: true,
    syncedAt: nowIso,
    tasksFound: remoteTasks.length + backfilledTasks.length,
    tasksAdded,
    tasksUpdated,
    totalManagedTasks: db.prepare('SELECT COUNT(*) as count FROM tasks').get().count,
  };
}
