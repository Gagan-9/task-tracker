import axios from 'axios';
import https from 'https';

const CLICKUP_BASE_URL = 'https://api.clickup.com/api/v2';
const httpsAgent = new https.Agent({ keepAlive: true, maxSockets: 10, timeout: 30000 });

/**
 * Creates an Axios client configured with ClickUp API token
 */
export function createClickUpClient(apiToken) {
  if (!apiToken) {
    throw new Error('ClickUp API token is required.');
  }

  const cleanToken = apiToken.trim();

  const client = axios.create({
    baseURL: CLICKUP_BASE_URL,
    headers: {
      Authorization: cleanToken,
      'Content-Type': 'application/json',
      'Accept-Encoding': 'gzip, deflate, br',
    },
    httpsAgent,
    timeout: 30000,
  });

  return {
    /**
     * Get authorized user details
     */
    async getCurrentUser() {
      const response = await client.get('/user');
      return response.data.user;
    },

    /**
     * Get user's workspaces/teams
     */
    async getTeams() {
      const response = await client.get('/team');
      return response.data.teams;
    },

    /**
     * Fetch all tasks assigned to user across a workspace/team
     * Ordered by updated date descending. Supports incremental sync via dateUpdatedGt.
     */
    async getTasksAssignedToUser({ teamId, userId, includeClosed = true, dateUpdatedGt = null }) {
      if (!teamId) throw new Error('Team/Workspace ID is required.');
      if (!userId) throw new Error('User ID is required.');

      let allTasks = [];
      let page = 0;
      let hasMore = true;

      while (hasMore) {
        const params = {
          'assignees[]': userId,
          include_closed: includeClosed,
          subtasks: true,
          order_by: 'updated',
          page: page,
        };

        if (dateUpdatedGt) {
          params.date_updated_gt = dateUpdatedGt;
        }

        const response = await client.get(`/team/${teamId}/task`, { params });
        const tasks = response.data.tasks || [];

        allTasks = allTasks.concat(tasks);

        // ClickUp default page size is 100; limit to 5 pages max (500 tasks)
        if (tasks.length < 100 || page >= 5) {
          hasMore = false;
        } else {
          page++;
        }
      }

      return allTasks;
    },

    /**
     * Fetch all tasks watched by user across a workspace/team
     * In ClickUp, users assigned to tasks become watchers and remain watchers even if reassigned.
     * Supports incremental sync via dateUpdatedGt.
     */
    async getTasksWatchedByUser({ teamId, userId, includeClosed = true, dateUpdatedGt = null }) {
      if (!teamId) throw new Error('Team/Workspace ID is required.');
      if (!userId) throw new Error('User ID is required.');

      let allTasks = [];
      let page = 0;
      let hasMore = true;

      while (hasMore) {
        const params = {
          'watchers[]': userId,
          include_closed: includeClosed,
          subtasks: true,
          order_by: 'updated',
          page: page,
        };

        if (dateUpdatedGt) {
          params.date_updated_gt = dateUpdatedGt;
        }

        const response = await client.get(`/team/${teamId}/task`, { params });
        const tasks = response.data.tasks || [];

        allTasks = allTasks.concat(tasks);

        // ClickUp default page size is 100; limit to 3 pages max (300 tasks)
        if (tasks.length < 100 || page >= 3) {
          hasMore = false;
        } else {
          page++;
        }
      }

      return allTasks;
    },

    /**
     * Fetch single task details by ID
     */
    async getTaskById(taskId) {
      const response = await client.get(`/task/${taskId}`);
      return response.data;
    },

    /**
     * Fetch task comments by task ID
     */
    async getTaskComments(taskId) {
      try {
        const response = await client.get(`/task/${taskId}/comment`);
        return response.data?.comments || [];
      } catch (err) {
        return [];
      }
    },
  };
}
