import ExcelJS from 'exceljs';
import db from '../config/database.js';

/**
 * Generates an Excel report (.xlsx buffer) for a specific month (e.g. '2026-09') or all tasks
 */
export async function generateMonthlyExcelReport(month) {
  let tasks = [];

  if (month && month !== 'ALL') {
    tasks = db.prepare(`
      SELECT 
        t.id,
        t.name,
        t.url,
        t.status,
        t.status_color,
        t.date_created,
        t.date_closed,
        t.first_seen_assigned,
        t.current_assignee_is_me,
        h.assigned_date,
        h.assigned_month
      FROM tasks t
      INNER JOIN task_assignment_history h ON t.id = h.task_id
      WHERE h.assigned_month = ?
      ORDER BY h.assigned_date DESC, t.name ASC
    `).all(month);
  } else {
    tasks = db.prepare(`
      SELECT 
        t.id,
        t.name,
        t.url,
        t.status,
        t.status_color,
        t.date_created,
        t.date_closed,
        t.first_seen_assigned,
        t.current_assignee_is_me,
        h.assigned_date,
        h.assigned_month
      FROM task_assignment_history h
      INNER JOIN tasks t ON t.id = h.task_id
      ORDER BY h.assigned_date DESC, t.name ASC
    `).all();
  }

  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Personal ClickUp Task Tracker';
  workbook.created = new Date();

  const sheetName = month && month !== 'ALL' ? `Tasks - ${month}` : 'All My Tasks';
  const worksheet = workbook.addWorksheet(sheetName, {
    views: [{ showGridLines: true }],
  });

  // Calculate stats
  const totalTasks = tasks.length;
  const completedTasks = tasks.filter(t => !!t.date_closed || (t.status && t.status.toLowerCase().includes('done')) || (t.status && t.status.toLowerCase().includes('closed')) || (t.status && t.status.toLowerCase().includes('complete'))).length;
  const passedToTester = tasks.filter(t => !t.current_assignee_is_me).length;
  const inProgressTasks = totalTasks - completedTasks;

  // Title Banner
  worksheet.mergeCells('A1:G1');
  const titleCell = worksheet.getCell('A1');
  titleCell.value = `ClickUp Developer Task Report - ${month && month !== 'ALL' ? month : 'All Time'}`;
  titleCell.font = { name: 'Calibri', size: 16, bold: true, color: { argb: 'FFFFFFFF' } };
  titleCell.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
  titleCell.fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FF1E293B' }, // Slate 800
  };
  worksheet.getRow(1).height = 35;

  // Summary Stat Bar
  worksheet.mergeCells('A2:G2');
  const summaryCell = worksheet.getCell('A2');
  summaryCell.value = `Total Tasks: ${totalTasks}  |  Completed: ${completedTasks}  |  In Progress/Dev: ${inProgressTasks}  |  Handed Over to Testing: ${passedToTester}  |  Generated on: ${new Date().toLocaleString()}`;
  summaryCell.font = { name: 'Calibri', size: 10, italic: true, color: { argb: 'FF475569' } };
  summaryCell.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
  worksheet.getRow(2).height = 22;

  // Empty row
  worksheet.getRow(3).height = 10;

  // Table Headers
  const headerRow = worksheet.getRow(4);
  headerRow.values = [
    '#',
    'Task Name',
    'ClickUp Link',
    'Assigned Date',
    'Status',
    'Completion Date',
    'Assignee Note'
  ];
  headerRow.height = 26;

  headerRow.eachCell((cell) => {
    cell.font = { name: 'Calibri', size: 11, bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FF3B82F6' }, // Blue 500
    };
    cell.alignment = { vertical: 'middle', horizontal: 'center' };
    cell.border = {
      top: { style: 'thin', color: { argb: 'FFCBD5E1' } },
      bottom: { style: 'medium', color: { argb: 'FF1D4ED8' } },
      left: { style: 'thin', color: { argb: 'FFCBD5E1' } },
      right: { style: 'thin', color: { argb: 'FFCBD5E1' } },
    };
  });

  // Table Data Rows
  tasks.forEach((task, index) => {
    const rowIndex = index + 5;
    const row = worksheet.getRow(rowIndex);

    const isClosed = !!task.date_closed || (task.status && ['closed', 'done', 'complete'].some(s => task.status.toLowerCase().includes(s)));
    const completionDisplay = isClosed 
      ? (task.date_closed ? task.date_closed.substring(0, 10) : 'Completed') 
      : 'In Progress';
    
    const assigneeStatus = task.current_assignee_is_me 
      ? 'Currently Assigned to Me' 
      : 'Passed to Tester / Reassigned';

    row.values = [
      index + 1,
      task.name,
      {
        text: 'View in ClickUp',
        hyperlink: task.url,
        tooltip: task.url
      },
      task.assigned_date || (task.first_seen_assigned ? task.first_seen_assigned.substring(0, 10) : 'N/A'),
      task.status ? task.status.toUpperCase() : 'UNKNOWN',
      completionDisplay,
      assigneeStatus
    ];

    row.height = 22;

    const isEven = index % 2 === 0;
    const bgArgb = isEven ? 'FFFFFFFF' : 'FFF8FAFC'; // Light zebra tint

    row.eachCell((cell, colNumber) => {
      cell.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: bgArgb },
      };
      cell.border = {
        top: { style: 'thin', color: { argb: 'FFE2E8F0' } },
        bottom: { style: 'thin', color: { argb: 'FFE2E8F0' } },
        left: { style: 'thin', color: { argb: 'FFE2E8F0' } },
        right: { style: 'thin', color: { argb: 'FFE2E8F0' } },
      };

      if (colNumber === 1) {
        cell.alignment = { vertical: 'middle', horizontal: 'center' };
        cell.font = { name: 'Calibri', size: 10, color: { argb: 'FF64748B' } };
      } else if (colNumber === 2) {
        cell.alignment = { vertical: 'middle', horizontal: 'left' };
        cell.font = { name: 'Calibri', size: 11, bold: true, color: { argb: 'FF1E293B' } };
      } else if (colNumber === 3) {
        // Hyperlink cell
        cell.alignment = { vertical: 'middle', horizontal: 'center' };
        cell.font = { name: 'Calibri', size: 10, underline: true, color: { argb: 'FF2563EB' } };
      } else if (colNumber === 5) {
        // Status column
        cell.alignment = { vertical: 'middle', horizontal: 'center' };
        cell.font = { name: 'Calibri', size: 10, bold: true, color: isClosed ? { argb: 'FF166534' } : { argb: 'FF854D0E' } };
      } else {
        cell.alignment = { vertical: 'middle', horizontal: 'center' };
        cell.font = { name: 'Calibri', size: 10, color: { argb: 'FF334155' } };
      }
    });
  });

  // Set explicit column widths
  worksheet.columns = [
    { key: 'index', width: 6 },
    { key: 'name', width: 45 },
    { key: 'link', width: 18 },
    { key: 'assigned_date', width: 16 },
    { key: 'status', width: 18 },
    { key: 'completed_date', width: 18 },
    { key: 'assignee_note', width: 28 },
  ];

  return workbook.xlsx.writeBuffer();
}
