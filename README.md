# Personal Local ClickUp Task Tracker

A 100% local task tracker and reporting tool built for developers to track tasks assigned to them in ClickUp, maintain permanent historical attribution even after tasks are reassigned to testers/QA, and generate monthly Excel (`.xlsx`) reports with clickable links.

---

## 🚀 How to Use (1-Click Desktop Automation)

### Step 1: Add Your ClickUp API Token (One-time Setup)
1. Open ClickUp in your browser.
2. Click your **Profile Avatar** (bottom-left or top-right) → **Apps** → **Generate** under **Personal API Key**.
3. Open the [`.env`](file:///c:/Users/gagan/OneDrive/Desktop/Task%20Tracker/.env) file in this folder and paste your token:
   ```env
   CLICKUP_API_TOKEN=pk_12345678_ABCDEF...
   ```

### Step 2: Double-Click to Sync & Generate Report
Simply double-click the **`ClickUp Sync & Report`** shortcut on your **Windows Desktop** (or [Sync & Report.bat](file:///c:/Users/gagan/OneDrive/Desktop/Task%20Tracker/Sync%20&%20Report.bat)):
1. It connects to ClickUp and fetches all tasks assigned to you.
2. It updates your local SQLite database (`server/data/tracker.db`), preserving any tasks you worked on that were subsequently reassigned to QA/testers.
3. It generates the monthly Excel report in the `Reports/` folder (e.g. `Reports/ClickUp_Tasks_September_2026.xlsx`).
4. It **automatically opens Microsoft Excel** with your report and displays a Windows desktop notification!

---

## 📂 Project Structure

```
Task Tracker/
├── .env                       # ClickUp API Token configuration
├── Sync & Report.bat          # 1-Click launcher script
├── Create Desktop Shortcut.bat # Utility to reinstall desktop shortcut
├── Reports/                   # Generated monthly Excel reports (.xlsx)
├── server/
│   ├── sync-and-report.js     # CLI runner & Excel auto-launch engine
│   ├── src/
│   │   ├── config/database.js # SQLite connection & migrations
│   │   ├── services/
│   │   │   ├── clickup.js     # ClickUp API client
│   │   │   ├── syncService.js # Task deduplication & historical snapshotting
│   │   │   └── excelService.js# ExcelJS report generator with hyperlinks
│   │   └── index.js           # REST API (optional for web)
│   └── data/
│       └── tracker.db         # Local SQLite database
└── client/                    # React + Vite web dashboard (optional)
```

---

## 🛡️ How Historical Developer Attribution Works

When you reassign a task in ClickUp to a tester, ClickUp changes the assignee field. If you relied on ClickUp's current state, your past tasks would vanish from your monthly work history.

This tracker prevents that:
* Every time you sync, tasks assigned to you are stamped into the `task_assignment_history` table for that month.
* If a future sync detects that a task has been moved to a tester, its status is updated and `current_assignee_is_me` is set to `0`, **without deleting the task or its monthly record**.
* The monthly Excel report includes all tasks you touched during that month, clearly marked with their status and whether they were handed over to QA.
