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

export async function runSync({ forceToken, forceUserId, forceTeamId, fullSync = false } = {}) {
  const syncStartTime = Date.now();
  const nowIso = new Date(syncStartTime).toISOString();
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

  // Exact timestamp of last sync for incremental fetching
  let dateUpdatedGt = null;
  if (!fullSync && settings.last_sync_timestamp) {
    const lastTs = parseInt(settings.last_sync_timestamp, 10);
    if (!isNaN(lastTs) && lastTs > 0) {
      dateUpdatedGt = lastTs;
    }
  }

  // 1 & 2. Fetch assigned tasks and watched tasks concurrently strictly from exact last sync timestamp
  const [assignedTasks, watchedTasks] = await Promise.all([
    client.getTasksAssignedToUser({ teamId, userId, dateUpdatedGt }),
    client.getTasksWatchedByUser({ teamId, userId, dateUpdatedGt }).catch((err) => {
      console.log(`⚠️ Note: Could not fetch watched tasks: ${err.message}`);
      return [];
    }),
  ]);

  // 3. Check for optional backfill tasks in "past-tasks.txt"
  const pastTasksFile = path.resolve(__dirname, '../../../past-tasks.txt');
  const backfillTaskIds = [];
  if (fs.existsSync(pastTasksFile)) {
    const content = fs.readFileSync(pastTasksFile, 'utf8');
    const lines = content.split(/\r?\n/).map(l => l.trim()).filter(l => l && !l.startsWith('#'));
    for (const line of lines) {
      const id = extractTaskId(line);
      if (id) backfillTaskIds.push(id);
    }
  }

  // Aggregate candidate tasks by ID
  const candidateTasksMap = new Map();
  for (const t of assignedTasks) {
    candidateTasksMap.set(t.id, t);
  }
  for (const t of watchedTasks) {
    if (!candidateTasksMap.has(t.id)) {
      candidateTasksMap.set(t.id, t);
    }
  }
  if (backfillTaskIds.length > 0) {
    await Promise.all(
      backfillTaskIds.map(async (id) => {
        if (!candidateTasksMap.has(id)) {
          try {
            const taskData = await client.getTaskById(id);
            if (taskData && taskData.id) {
              candidateTasksMap.set(taskData.id, taskData);
            }
          } catch (err) {
            console.log(`⚠️ Note: Could not fetch backfill task ${id}: ${err.message}`);
          }
        }
      })
    );
  }

  // 4. Batch load existing DB tasks and history for instant in-memory lookup
  const existingTasksMap = new Map(db.prepare('SELECT id, current_assignee_is_me FROM tasks').all().map(t => [t.id, t]));
  const existingHistoryMap = new Map(db.prepare('SELECT task_id, assigned_month, assigned_date FROM task_assignment_history').all().map(h => [h.task_id, h]));

  const tasksToProcess = [];

  for (const [taskId, task] of candidateTasksMap.entries()) {
    const isCurrentlyAssigned = task.assignees && task.assignees.some(a => String(a.id) === String(userId));
    const isCreator = task.creator && String(task.creator.id) === String(userId);
    const isWatcher = task.watchers && task.watchers.some(w => String(w.id) === String(userId));

    const existingTask = existingTasksMap.get(taskId);
    let wasUserAssigned = isCurrentlyAssigned || !!existingTask || isCreator;
    let assignmentDate = null;
    let assignmentMonth = null;

    if (existingTask) {
      wasUserAssigned = true;
      const historyRecord = existingHistoryMap.get(taskId);
      if (historyRecord) {
        assignmentDate = historyRecord.assigned_date;
        assignmentMonth = historyRecord.assigned_month;
      }
    } else if (isCurrentlyAssigned) {
      wasUserAssigned = true;
      assignmentDate = currentDate;
      assignmentMonth = currentMonth;
    } else if (isWatcher || isCreator) {
      wasUserAssigned = true;
      const taskCreatedIso = msToIso(task.date_created);
      const taskUpdatedIso = msToIso(task.date_updated);
      assignmentDate = taskCreatedIso ? taskCreatedIso.substring(0, 10) : (taskUpdatedIso ? taskUpdatedIso.substring(0, 10) : currentDate);
      assignmentMonth = assignmentDate ? assignmentDate.substring(0, 7) : currentMonth;
    }

    if (wasUserAssigned) {
      tasksToProcess.push({
        task,
        isCurrentlyMe: isCurrentlyAssigned ? 1 : 0,
        assignmentDate: assignmentDate || currentDate,
        assignmentMonth: assignmentMonth || currentMonth,
        isExisting: !!existingTask,
      });
    }
  }

  // 5. Store that assignment event/date in SQLite (tasks & task_assignment_history)
  let tasksAdded = 0;
  let tasksUpdated = 0;
  const currentAssignedTaskIds = new Set(assignedTasks.map(t => t.id));

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
      last_seen_assigned = CASE WHEN ? = 1 THEN ? ELSE last_seen_assigned END,
      current_assignee_is_me = ?
    WHERE id = ?
  `);

  const insertHistoryStmt = db.prepare(`
    INSERT OR IGNORE INTO task_assignment_history (task_id, assigned_month, assigned_date)
    VALUES (?, ?, ?)
  `);

  const transaction = db.transaction((processedList) => {
    for (const item of processedList) {
      const { task, isCurrentlyMe, assignmentDate, assignmentMonth, isExisting } = item;

      const statusName = task.status ? (typeof task.status === 'object' ? task.status.status : task.status) : 'unknown';
      const statusColor = task.status && typeof task.status === 'object' ? task.status.color : '#888888';
      const dateCreatedIso = msToIso(task.date_created) || nowIso;
      const dateUpdatedIso = msToIso(task.date_updated) || nowIso;
      const dateClosedIso = msToIso(task.date_closed || task.date_done);

      if (isExisting) {
        updateTaskStmt.run(
          task.name,
          task.url,
          statusName,
          statusColor,
          dateUpdatedIso,
          dateClosedIso,
          isCurrentlyMe,
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
          assignmentDate ? `${assignmentDate}T00:00:00.000Z` : nowIso,
          isCurrentlyMe ? nowIso : (assignmentDate ? `${assignmentDate}T00:00:00.000Z` : nowIso),
          isCurrentlyMe
        );
        tasksAdded++;
      }

      insertHistoryStmt.run(task.id, assignmentMonth, assignmentDate);

      if (isCurrentlyMe) {
        insertHistoryStmt.run(task.id, currentMonth, currentDate);
      }
    }

    // 6. Never delete historical records.
    // For any task in DB that was marked current_assignee_is_me = 1 but is no longer in currentAssignedTaskIds,
    // mark current_assignee_is_me = 0 (handed over to tester/QA)
    const markHandedOverStmt = db.prepare('UPDATE tasks SET current_assignee_is_me = 0 WHERE id = ?');
    for (const [id, dbTask] of existingTasksMap.entries()) {
      if (dbTask.current_assignee_is_me === 1 && !currentAssignedTaskIds.has(id)) {
        markHandedOverStmt.run(id);
      }
    }
  });

  transaction(tasksToProcess);

  // Log sync result and save last sync timestamp for incremental syncing
  const logStmt = db.prepare(`
    INSERT INTO sync_logs (synced_at, tasks_found, tasks_added, tasks_updated, status)
    VALUES (?, ?, ?, ?, 'SUCCESS')
  `);
  logStmt.run(nowIso, tasksToProcess.length, tasksAdded, tasksUpdated);

  saveSetting('last_sync_timestamp', String(syncStartTime));
  saveSetting('last_sync_date', nowIso);

  return {
    success: true,
    syncedAt: nowIso,
    tasksFound: tasksToProcess.length,
    tasksAdded,
    tasksUpdated,
    totalManagedTasks: db.prepare('SELECT COUNT(*) as count FROM tasks').get().count,
  };
}
