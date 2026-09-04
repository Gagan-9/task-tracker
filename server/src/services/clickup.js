import axios from 'axios';

const CLICKUP_BASE_URL = 'https://api.clickup.com/api/v2';

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
    },
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
     * Supports pagination across pages.
     */
    async getTasksAssignedToUser({ teamId, userId, includeClosed = true }) {
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
          page: page,
        };

        const response = await client.get(`/team/${teamId}/task`, { params });
        const tasks = response.data.tasks || [];

        allTasks = allTasks.concat(tasks);

        // ClickUp default page size is 100
        if (tasks.length < 100 || page > 50) {
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
  };
}
